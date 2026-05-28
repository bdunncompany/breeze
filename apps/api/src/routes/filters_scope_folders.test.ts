import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const FOLDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FILTER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'user-123';

vi.mock('../services', () => ({}));
vi.mock('../services/auditEvents', () => ({ writeRouteAudit: vi.fn() }));
vi.mock('../services/filterEngine', () => ({
  evaluateFilterWithPreview: vi.fn().mockResolvedValue({
    totalCount: 0,
    devices: [],
    evaluatedAt: new Date()
  })
}));

vi.mock('../db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn()
  },
  runOutsideDbContext: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  withDbAccessContext: vi.fn(async (_ctx: unknown, fn: () => Promise<unknown>) => fn()),
  withSystemDbAccessContext: vi.fn(async (fn: () => Promise<unknown>) => fn())
}));

vi.mock('../db/schema', () => ({
  savedFilters: {
    id: 'id',
    orgId: 'orgId',
    name: 'name',
    description: 'description',
    conditions: 'conditions',
    createdBy: 'createdBy',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    scope: 'scope',
    folderId: 'folderId',
    icon: 'icon',
    color: 'color'
  },
  savedFilterFolders: {
    id: 'id',
    orgId: 'orgId',
    name: 'name',
    parentId: 'parentId',
    sortOrder: 'sortOrder',
    createdBy: 'createdBy',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  },
  savedFilterStars: {
    userId: 'userId',
    filterId: 'filterId',
    starredAt: 'starredAt'
  }
}));

vi.mock('../middleware/auth', () => ({
  authMiddleware: vi.fn((c: any, next: any) => {
    c.set('auth', {
      user: { id: USER_ID, email: 't@example.com', name: 'T' },
      scope: 'organization',
      orgId: ORG_ID,
      partnerId: null,
      accessibleOrgIds: [ORG_ID],
      canAccessOrg: (orgId: string) => orgId === ORG_ID
    });
    return next();
  }),
  requireMfa: vi.fn(() => async (_c: any, next: any) => next()),
  requirePermission: vi.fn(() => async (_c: any, next: any) => next()),
  requireScope: vi.fn(() => async (_c: any, next: any) => next())
}));

import { db } from '../db';
import { filterRoutes } from './filters';

function makeFolder(overrides: Record<string, unknown> = {}) {
  return {
    id: FOLDER_ID,
    orgId: ORG_ID,
    name: 'Onboarding',
    parentId: null,
    sortOrder: 0,
    createdBy: USER_ID,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides
  };
}

function makeFilter(overrides: Record<string, unknown> = {}) {
  return {
    id: FILTER_ID,
    orgId: ORG_ID,
    name: 'Offline > 24h',
    description: null,
    conditions: { operator: 'AND', conditions: [] },
    createdBy: USER_ID,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    scope: 'partner',
    folderId: null,
    lastUsedAt: null,
    useCount: 0,
    icon: null,
    color: null,
    ...overrides
  };
}

describe('filter routes - scope + folders + stars', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    // Drain any queued mockReturnValueOnce so tests don't see stale chains.
    vi.mocked(db.select).mockReset();
    vi.mocked(db.insert).mockReset();
    vi.mocked(db.delete).mockReset();
    vi.mocked(db.update).mockReset();
    app = new Hono();
    app.route('/filters', filterRoutes);
  });

  it('GET /filters?scope=partner filters by scope', async () => {
    const orderByMock = vi.fn().mockResolvedValue([makeFilter()]);
    const whereMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    vi.mocked(db.select).mockReturnValueOnce({ from: fromMock } as any);

    const res = await app.request('/filters?scope=partner', {
      headers: { Authorization: 'Bearer token' }
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].scope).toBe('partner');
    // and() composes; the where mock was called with a single combined arg
    expect(whereMock).toHaveBeenCalled();
  });

  it('POST /filters/folders creates a top-level folder', async () => {
    vi.mocked(db.insert).mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([makeFolder()])
      })
    } as any);

    const res = await app.request('/filters/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      body: JSON.stringify({ name: 'Onboarding' })
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.id).toBe(FOLDER_ID);
    expect(body.data.parentId).toBeNull();
  });

  it('POST /filters/folders rejects nesting beyond one level', async () => {
    const parentWithParent = makeFolder({ id: 'parent-id', parentId: 'grandparent-id' });
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([parentWithParent])
        })
      })
    } as any);

    const res = await app.request('/filters/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
      body: JSON.stringify({ name: 'Too deep', parentId: 'parent-id' })
    });

    expect(res.status).toBe(400);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('GET /filters/folders lists folders for the org', async () => {
    const orderByMock = vi.fn().mockResolvedValue([makeFolder(), makeFolder({ id: 'second', name: 'Audits' })]);
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ orderBy: orderByMock })
      })
    } as any);

    const res = await app.request('/filters/folders', {
      headers: { Authorization: 'Bearer t' }
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
    expect(body.data.map((f: any) => f.name)).toEqual(['Onboarding', 'Audits']);
  });

  it('DELETE /filters/folders/:id removes the folder', async () => {
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([makeFolder()])
        })
      })
    } as any);
    vi.mocked(db.delete).mockReturnValueOnce({
      where: vi.fn().mockResolvedValue(undefined)
    } as any);

    const res = await app.request(`/filters/folders/${FOLDER_ID}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer t' }
    });

    expect(res.status).toBe(200);
    expect(db.delete).toHaveBeenCalled();
  });

  it('POST /filters/:id/star stars the filter for the current user (idempotent)', async () => {
    // getFilterWithAccess select
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([makeFilter()])
        })
      })
    } as any);

    const onConflictMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValueOnce({
      values: vi.fn().mockReturnValue({ onConflictDoNothing: onConflictMock })
    } as any);

    const res = await app.request(`/filters/${FILTER_ID}/star`, {
      method: 'POST',
      headers: { Authorization: 'Bearer t' }
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ userId: USER_ID, filterId: FILTER_ID, starred: true });
    expect(onConflictMock).toHaveBeenCalled();
  });

  it('DELETE /filters/:id/star unstars the filter for the current user', async () => {
    vi.mocked(db.delete).mockReturnValueOnce({
      where: vi.fn().mockResolvedValue(undefined)
    } as any);

    const res = await app.request(`/filters/${FILTER_ID}/star`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer t' }
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ userId: USER_ID, filterId: FILTER_ID, starred: false });
  });
});
