import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID_2 = '22222222-2222-2222-2222-222222222222';
const OTHER_ORG = '99999999-9999-9999-9999-999999999999';

vi.mock('../../services/filterEngine', () => ({
  evaluateFilterWithPreview: vi.fn()
}));

vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn((c: any, next: any) => {
    c.set('auth', {
      user: { id: 'user-123' },
      scope: 'organization',
      orgId: ORG_ID,
      accessibleOrgIds: [ORG_ID],
      canAccessOrg: (id: string) => id === ORG_ID
    });
    return next();
  }),
  requirePermission: vi.fn(() => async (_c: any, next: any) => next()),
  requireScope: vi.fn(() => async (_c: any, next: any) => next())
}));

import { evaluateFilterWithPreview } from '../../services/filterEngine';
import { authMiddleware } from '../../middleware/auth';
import { filterPreviewRoutes } from './filterPreview';

function buildSampleDevices(count: number, prefix = 'host') {
  return Array.from({ length: count }, (_, i) => ({
    id: `dev-${i}`,
    hostname: `${prefix}-${i}`,
    displayName: null,
    osType: 'windows',
    status: 'online',
    lastSeenAt: null
  }));
}

const FILTER = {
  operator: 'AND' as const,
  conditions: [{ field: 'osType', operator: 'equals' as const, value: 'windows' }]
};

describe('POST /devices/filter-preview', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route('/devices', filterPreviewRoutes);
  });

  it('returns count and up to 5 sample hostnames matching the filter', async () => {
    vi.mocked(evaluateFilterWithPreview).mockResolvedValueOnce({
      totalCount: 42,
      devices: buildSampleDevices(5),
      evaluatedAt: new Date('2026-05-27T00:00:00Z')
    });

    const res = await app.request('/devices/filter-preview', {
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: JSON.stringify(FILTER)
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(42);
    expect(body.sampleHostnames).toEqual(['host-0', 'host-1', 'host-2', 'host-3', 'host-4']);
    expect(body.matchingIds).toEqual(['dev-0', 'dev-1', 'dev-2', 'dev-3', 'dev-4']);
    // previewLimit is now sized for matchingIds, not just the hostname sample,
    // so we only assert orgId here and check the limit floor.
    const call = vi.mocked(evaluateFilterWithPreview).mock.calls[0]![1]!;
    expect(call.orgId).toBe(ORG_ID);
    expect(call.previewLimit).toBeGreaterThanOrEqual(5);
  });

  it('caps sampleHostnames at 5 even when the engine returns more', async () => {
    // Engine should respect previewLimit=5, but defensively trim in the route too.
    vi.mocked(evaluateFilterWithPreview).mockResolvedValueOnce({
      totalCount: 1000,
      devices: buildSampleDevices(20),
      evaluatedAt: new Date()
    });

    const res = await app.request('/devices/filter-preview', {
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: JSON.stringify(FILTER)
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sampleHostnames.length).toBeLessThanOrEqual(5);
  });

  it('enforces tenant scoping: caller with no accessible orgs gets 0 count', async () => {
    // Re-mock auth to a tenant-scoped caller with no orgs reachable.
    vi.mocked(authMiddleware).mockImplementation((c: any, next: any) => {
      c.set('auth', {
        user: { id: 'user-xyz' },
        scope: 'partner',
        orgId: null,
        accessibleOrgIds: [],
        canAccessOrg: () => false
      });
      return next();
    });
    app = new Hono();
    app.route('/devices', filterPreviewRoutes);

    const res = await app.request('/devices/filter-preview', {
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: JSON.stringify(FILTER)
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ count: 0, sampleHostnames: [], matchingIds: [] });
    expect(evaluateFilterWithPreview).not.toHaveBeenCalled();
  });

  it('does not query orgs outside the caller’s accessibleOrgIds', async () => {
    // Partner-scoped caller with 2 reachable orgs; should NOT touch OTHER_ORG.
    vi.mocked(authMiddleware).mockImplementation((c: any, next: any) => {
      c.set('auth', {
        user: { id: 'user-partner' },
        scope: 'partner',
        orgId: null,
        accessibleOrgIds: [ORG_ID, ORG_ID_2],
        canAccessOrg: (id: string) => [ORG_ID, ORG_ID_2].includes(id)
      });
      return next();
    });
    app = new Hono();
    app.route('/devices', filterPreviewRoutes);

    vi.mocked(evaluateFilterWithPreview)
      .mockResolvedValueOnce({
        totalCount: 3,
        devices: buildSampleDevices(3, 'orgA'),
        evaluatedAt: new Date()
      })
      .mockResolvedValueOnce({
        totalCount: 2,
        devices: buildSampleDevices(2, 'orgB'),
        evaluatedAt: new Date()
      });

    const res = await app.request('/devices/filter-preview', {
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: JSON.stringify(FILTER)
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(5);
    expect(body.sampleHostnames.length).toBeLessThanOrEqual(5);
    expect(body.matchingIds.length).toBe(5);
    const callArgs = vi.mocked(evaluateFilterWithPreview).mock.calls.map((call) => call[1]?.orgId);
    expect(callArgs.sort()).toEqual([ORG_ID, ORG_ID_2].sort());
    expect(callArgs).not.toContain(OTHER_ORG);
  });
});
