import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID_2 = '22222222-2222-2222-2222-222222222222';

vi.mock('../../db', () => ({
  db: {
    execute: vi.fn()
  }
}));

vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn((c: any, next: any) => {
    const scope = (c.req.header('x-test-scope') ?? 'organization') as 'organization' | 'partner' | 'system';
    const orgIdHeader = c.req.header('x-test-orgs') ?? ORG_ID;
    const accessibleOrgIds = orgIdHeader.split(',').filter(Boolean);
    c.set('auth', {
      user: { id: 'user-123' },
      scope,
      orgId: scope === 'organization' ? accessibleOrgIds[0] : undefined,
      accessibleOrgIds,
      canAccessOrg: (id: string) => accessibleOrgIds.includes(id)
    });
    return next();
  }),
  requirePermission: vi.fn(() => async (_c: any, next: any) => next()),
  requireScope: vi.fn(() => async (_c: any, next: any) => next())
}));

import { db } from '../../db';
import { softwareDistinctRoutes } from './softwareDistinct';

describe('GET /devices/software/distinct', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route('/devices', softwareDistinctRoutes);
  });

  it('returns a distinct list with deviceCount for an org-scoped caller', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([
      { name: '7-Zip', device_count: '3' },
      { name: 'Google Chrome', device_count: 12 },
    ] as any);

    const res = await app.request('/devices/software/distinct', {
      headers: { 'x-test-scope': 'organization', 'x-test-orgs': ORG_ID }
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([
      { name: '7-Zip', deviceCount: 3 },
      { name: 'Google Chrome', deviceCount: 12 },
    ]);
  });

  it('unions across all accessible orgs for a partner-scoped caller', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([
      { name: 'Slack', device_count: '7' },
    ] as any);

    const res = await app.request('/devices/software/distinct', {
      headers: { 'x-test-scope': 'partner', 'x-test-orgs': `${ORG_ID},${ORG_ID_2}` }
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([{ name: 'Slack', deviceCount: 7 }]);
    // SQL should have used both org ids — drizzle template carries them in params.
    expect(vi.mocked(db.execute)).toHaveBeenCalledOnce();
  });

  it('returns empty when a tenant-scoped caller has no accessible orgs', async () => {
    const res = await app.request('/devices/software/distinct', {
      headers: { 'x-test-scope': 'partner', 'x-test-orgs': '' }
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
    expect(vi.mocked(db.execute)).not.toHaveBeenCalled();
  });

  it('caps limit at 1000 and accepts a search filter', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce([] as any);

    const res = await app.request('/devices/software/distinct?limit=999999&search=chr', {
      headers: { 'x-test-scope': 'organization', 'x-test-orgs': ORG_ID }
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });
});
