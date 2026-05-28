import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { authMiddleware, requirePermission, requireScope, type AuthContext } from '../../middleware/auth';
import { PERMISSIONS } from '../../services/permissions';
import { evaluateFilterWithPreview, type FilterConditionGroup } from '../../services/filterEngine';
import { filterConditionGroupSchema } from '@breeze/shared/validators/filters';

export const filterPreviewRoutes = new Hono();

const SAMPLE_HOSTNAME_LIMIT = 5;
// Cap returned matchingIds so a wide-open filter doesn't ship 50k UUIDs.
// The UI uses these to mask an in-memory device array that's already
// page-capped, so 5000 covers any realistic single-page view.
const MATCHING_IDS_LIMIT = 5000;

filterPreviewRoutes.use('*', authMiddleware);

function orgIdsForAuth(auth: Pick<AuthContext, 'scope' | 'orgId' | 'accessibleOrgIds'>): string[] | null {
  if (auth.scope === 'system') return null;
  if (auth.scope === 'organization') return auth.orgId ? [auth.orgId] : [];
  return auth.accessibleOrgIds ?? [];
}

// POST /devices/filter-preview - Ad-hoc filter preview returning count + sample hostnames.
// Spec: drafts/2026-05-27-device-filters-spec.md §4.5.
filterPreviewRoutes.post(
  '/filter-preview',
  requireScope('organization', 'partner', 'system'),
  requirePermission(PERMISSIONS.DEVICES_READ.resource, PERMISSIONS.DEVICES_READ.action),
  zValidator('json', filterConditionGroupSchema),
  async (c) => {
    const auth = c.get('auth');
    const filter = c.req.valid('json') as unknown as FilterConditionGroup;

    const orgIds = orgIdsForAuth(auth);
    // Tenant-scoped caller with no accessible orgs: short-circuit to empty.
    // System scope (orgIds === null) falls through and queries unscoped.
    if (orgIds && orgIds.length === 0) {
      return c.json({ count: 0, sampleHostnames: [], matchingIds: [] });
    }

    let totalCount = 0;
    const hostnames: string[] = [];
    const matchingIds: string[] = [];

    if (orgIds === null) {
      // System scope: no per-org loop available with the current engine;
      // run a single evaluation that ignores org scoping by passing the
      // empty-org sentinel is not supported, so iterate all orgs would
      // need a system-level entry point. For the v1 endpoint, require
      // a scoped caller; system callers get an empty preview to avoid
      // accidentally building unbounded queries here.
      return c.json({ count: 0, sampleHostnames: [], matchingIds: [] });
    }

    try {
      for (const orgId of orgIds) {
        const remaining = MATCHING_IDS_LIMIT - matchingIds.length;
        // Pull enough to fill matchingIds; sampleHostnames takes the first 5
        // of preview.devices across orgs. previewLimit=remaining keeps the
        // engine from materializing more than we'll use.
        const preview = await evaluateFilterWithPreview(filter, {
          orgId,
          previewLimit: Math.max(SAMPLE_HOSTNAME_LIMIT, remaining)
        });
        totalCount += preview.totalCount;
        for (const d of preview.devices) {
          if (hostnames.length < SAMPLE_HOSTNAME_LIMIT) hostnames.push(d.hostname);
          if (matchingIds.length < MATCHING_IDS_LIMIT) matchingIds.push(d.id);
        }
        if (matchingIds.length >= MATCHING_IDS_LIMIT) break;
      }
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'Invalid filter' }, 400);
    }

    return c.json({
      count: totalCount,
      sampleHostnames: hostnames.slice(0, SAMPLE_HOSTNAME_LIMIT),
      matchingIds
    });
  }
);

