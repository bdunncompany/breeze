// GET /devices/software/distinct — fleet-wide distinct software names.
//
// Returns one row per (lowercased) software name across every org the caller
// can see. Used by the device filter UI's software multi-select so users can
// pick from the full fleet inventory, not just one org.
//
// Why this lives under /devices instead of /software-inventory:
// /software-inventory requires an `orgId` (single-org scope). The filter
// picker needs a partner/system caller to get a union across all accessible
// orgs in one call. Same auth pattern as filter-preview.
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../../db';
import { authMiddleware, requirePermission, requireScope, type AuthContext } from '../../middleware/auth';
import { PERMISSIONS } from '../../services/permissions';
import { softwareInventory, devices } from '../../db/schema';

export const softwareDistinctRoutes = new Hono();

softwareDistinctRoutes.use('*', authMiddleware);

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 500;

function orgIdsForAuth(auth: Pick<AuthContext, 'scope' | 'orgId' | 'accessibleOrgIds'>): string[] | null {
  if (auth.scope === 'system') return null;
  if (auth.scope === 'organization') return auth.orgId ? [auth.orgId] : [];
  return auth.accessibleOrgIds ?? [];
}

softwareDistinctRoutes.get(
  '/software/distinct',
  requireScope('organization', 'partner', 'system'),
  requirePermission(PERMISSIONS.DEVICES_READ.resource, PERMISSIONS.DEVICES_READ.action),
  async (c) => {
    const auth = c.get('auth');
    const rawLimit = Number(c.req.query('limit') ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;
    const search = (c.req.query('search') ?? '').trim();

    const orgIds = orgIdsForAuth(auth);
    if (orgIds && orgIds.length === 0) {
      return c.json({ data: [] });
    }

    const orgFilter = orgIds === null
      ? sql`TRUE`
      : sql`${softwareInventory.orgId} IN (${sql.join(orgIds.map(id => sql`${id}`), sql`, `)})`;

    const searchFilter = search
      ? sql`AND LOWER(${softwareInventory.name}) LIKE ${'%' + search.toLowerCase().replace(/[%_\\]/g, '\\$&') + '%'}`
      : sql``;

    const rows = await db.execute(sql`
      SELECT
        MIN(${softwareInventory.name}) AS name,
        COUNT(DISTINCT ${softwareInventory.deviceId}) AS device_count
      FROM ${softwareInventory}
      INNER JOIN ${devices} ON ${softwareInventory.deviceId} = ${devices.id}
      WHERE ${orgFilter} ${searchFilter}
      GROUP BY LOWER(${softwareInventory.name})
      ORDER BY MIN(${softwareInventory.name}) ASC
      LIMIT ${limit}
    `);

    const data = (rows as unknown as Array<{ name: string; device_count: string | number }>)
      .map(r => ({ name: r.name, deviceCount: Number(r.device_count) }));

    return c.json({ data });
  }
);
