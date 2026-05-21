import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Set the avatar storage dir to a per-test-run tmp path BEFORE importing the
// service (the service reads process.env.AVATAR_STORAGE_PATH at module load).
const TMP_AVATAR_DIR = mkdtempSync(join(tmpdir(), 'breeze-avatar-test-'));
process.env.AVATAR_STORAGE_PATH = TMP_AVATAR_DIR;

import { userRoutes } from './users';

const { sendInviteMock } = vi.hoisted(() => ({
  sendInviteMock: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../services/permissions', () => ({
  clearPermissionCache: vi.fn(),
  getUserPermissions: vi.fn().mockResolvedValue({
    permissions: [{ resource: '*', action: '*' }],
    partnerId: 'partner-123',
    orgId: null,
    roleId: 'role-admin',
    scope: 'partner'
  }),
  hasPermission: vi.fn((userPerms: any, resource: string, action: string) =>
    userPerms.permissions.some((p: any) =>
      (p.resource === resource || p.resource === '*') &&
      (p.action === action || p.action === '*')
    )
  ),
  isAssignablePermission: vi.fn((permission: any) =>
    permission.resource !== '*' &&
    permission.action !== '*' &&
    ['users:read', 'users:invite', 'users:write', 'users:delete', 'devices:read', 'devices:write', 'devices:execute']
      .includes(`${permission.resource}:${permission.action}`)
  ),
  PERMISSIONS: {
    USERS_READ: { resource: 'users', action: 'read' },
    USERS_INVITE: { resource: 'users', action: 'invite' },
    USERS_WRITE: { resource: 'users', action: 'write' },
    USERS_DELETE: { resource: 'users', action: 'delete' },
    DEVICES_READ: { resource: 'devices', action: 'read' },
    DEVICES_WRITE: { resource: 'devices', action: 'write' },
    DEVICES_EXECUTE: { resource: 'devices', action: 'execute' },
    ADMIN_ALL: { resource: '*', action: '*' }
  }
}));

vi.mock('../db', () => ({
  runOutsideDbContext: vi.fn((fn) => fn()),
  withDbAccessContext: vi.fn(async (_ctx: unknown, fn: () => Promise<unknown>) => fn()),
  withSystemDbAccessContext: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([]))
        }))
      }))
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([]))
      }))
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([]))
        }))
      }))
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([]))
      }))
    })),
    transaction: vi.fn()
  }
}));

vi.mock('../db/schema', () => ({
  users: {},
  partnerUsers: {},
  organizationUsers: {},
  roles: {},
  permissions: {},
  rolePermissions: {},
  organizations: {},
  patchPolicies: {},
  alertRules: {},
  backupConfigs: {},
  securityPolicies: {},
  automationPolicies: {},
  maintenanceWindows: {},
  softwarePolicies: {},
  sensitiveDataPolicies: {},
  peripheralPolicies: {},
  discoveredAssetTypeEnum: { enumValues: ['workstation', 'server', 'printer', 'unknown'] },
}));

vi.mock('../middleware/auth', () => ({
  authMiddleware: vi.fn((c: any, next: any) => {
    c.set('auth', {
      scope: 'partner',
      partnerId: 'partner-123',
      orgId: null,
      user: { id: 'user-123', email: 'test@example.com' }
    });
    return next();
  }),
  requireScope: vi.fn(() => async (_c: any, next: any) => next()),
  requirePermission: vi.fn(() => (c: any, next: any) => next()),
  requireMfa: vi.fn(() => (_c: any, next: any) => next())
}));

vi.mock('../services/email', () => ({
  getEmailService: vi.fn(() => ({
    sendInvite: sendInviteMock
  }))
}));

import { db } from '../db';
import { clearPermissionCache, getUserPermissions } from '../services/permissions';
import { authMiddleware } from '../middleware/auth';

describe('user routes', () => {
  let app: Hono;

  afterAll(() => {
    if (existsSync(TMP_AVATAR_DIR)) {
      rmSync(TMP_AVATAR_DIR, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authMiddleware).mockImplementation((c: any, next: any) => {
      c.set('auth', {
        scope: 'partner',
        partnerId: 'partner-123',
        orgId: null,
        user: { id: 'user-123', email: 'test@example.com' }
      });
      return next();
    });
    app = new Hono();
    app.route('/users', userRoutes);
  });

  describe('GET /users', () => {
    it('should list partner users', async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                {
                  id: '11111111-1111-1111-1111-111111111111',
                  email: 'user@example.com',
                  name: 'Partner User',
                  status: 'active',
                  roleId: 'role-1',
                  roleName: 'Admin',
                  orgAccess: 'all',
                  orgIds: null
                }
              ])
            })
          })
        })
      } as any);

      const res = await app.request('/users', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer token'
        }
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].email).toBe('user@example.com');
    });

    it('should reject missing partner/org context', async () => {
      vi.mocked(authMiddleware).mockImplementation((c: any, next: any) => {
        c.set('auth', {
          scope: 'system',
          partnerId: null,
          orgId: null,
          user: { id: 'user-123', email: 'test@example.com' }
        });
        return next();
      });

      const res = await app.request('/users', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer token'
        }
      });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /users/invite', () => {
    it('should invite a partner user with selected orgs', async () => {
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: '22222222-2222-2222-2222-222222222222',
                scope: 'partner',
                name: 'Admin',
                description: null,
                isSystem: true,
                partnerId: null,
                orgId: null
              }
            ])
          })
        })
      } as any)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ parentRoleId: null }])
            })
          })
        } as any)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([])
            })
          })
        } as any);

      const txSelect = vi
        .fn()
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([])
            })
          })
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([])
            })
          })
        });

      const txInsert = vi
        .fn()
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                id: '11111111-1111-1111-1111-111111111111',
                email: 'invitee@example.com',
                name: 'Invitee',
                status: 'invited'
              }
            ])
          })
        })
        .mockReturnValueOnce({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'link-1' }])
          })
        });

      vi.mocked(db.transaction).mockImplementation(async (fn) => {
        return fn({ select: txSelect, insert: txInsert } as any);
      });

      const res = await app.request('/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'invitee@example.com',
          name: 'Invitee',
          roleId: '22222222-2222-2222-2222-222222222222',
          orgAccess: 'selected',
          orgIds: ['33333333-3333-3333-3333-333333333333']
        })
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.email).toBe('invitee@example.com');
      expect(body.status).toBe('invited');
      expect(clearPermissionCache).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
    });

    it('should require orgIds when orgAccess is selected', async () => {
      const res = await app.request('/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'invitee@example.com',
          name: 'Invitee',
          roleId: '22222222-2222-2222-2222-222222222222',
          orgAccess: 'selected'
        })
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('orgIds');
    });
  });

  describe('POST /users/resend-invite', () => {
    it('should resend an invite for invited users', async () => {
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  {
                    id: '11111111-1111-1111-1111-111111111111',
                    email: 'invitee@example.com',
                    name: 'Invitee',
                    status: 'invited',
                    roleId: 'role-1',
                    roleName: 'Admin',
                    orgAccess: 'all',
                    orgIds: null
                  }
                ])
              })
            })
          })
        })
      } as any);

      const res = await app.request('/users/resend-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: '11111111-1111-1111-1111-111111111111'
        })
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });
  });

  describe('PATCH /users/me validation', () => {
    beforeEach(() => {
      vi.mocked(authMiddleware).mockImplementation((c: any, next: any) => {
        c.set('auth', {
          scope: 'organization',
          partnerId: null,
          orgId: 'org-1',
          user: { id: 'user-123', email: 'test@example.com' }
        });
        return next();
      });
    });

    it('rejects avatarUrl with javascript: scheme', async () => {
      const res = await app.request('/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ avatarUrl: 'javascript:alert(1)' })
      });
      expect(res.status).toBe(400);
    });

    it('rejects invalid email format', async () => {
      const res = await app.request('/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ email: 'not-an-email' })
      });
      expect(res.status).toBe(400);
    });

    it('rejects unknown top-level fields (strict schema)', async () => {
      const res = await app.request('/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ name: 'ok', role: 'admin' })
      });
      expect(res.status).toBe(400);
    });

    it('rejects huge preferences payload (>64KB)', async () => {
      // build ~70KB blob
      const big = 'x'.repeat(70 * 1024);
      const res = await app.request('/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ preferences: { blob: big } })
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /users/:id (admin update)', () => {
    it('rejects unknown top-level fields including roleId (strict schema)', async () => {
      // The Edit dialog historically sent { email, name, roleId } and roleId was
      // silently dropped because updateUserSchema lacked .strict(). After the
      // hardening, the extra field must surface as 400 instead of a no-op 200.
      const res = await app.request('/users/11111111-1111-1111-1111-111111111111', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ name: 'New Name', roleId: '22222222-2222-2222-2222-222222222222' })
      });
      expect(res.status).toBe(400);
    });

    it('rejects an arbitrary extra field (strict schema, defense in depth)', async () => {
      const res = await app.request('/users/11111111-1111-1111-1111-111111111111', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
        body: JSON.stringify({ name: 'New Name', mysteryField: 'oops' })
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /users/:id/role', () => {
    it('should assign a partner role', async () => {
      vi.mocked(db.select)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: '44444444-4444-4444-4444-444444444444',
                  scope: 'partner',
                  name: 'Operator',
                  description: null,
                  isSystem: false,
                  parentRoleId: null,
                  partnerId: 'partner-123',
                  orgId: null
                }
              ])
            })
          })
        } as any)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ parentRoleId: null }])
            })
          })
        } as any)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([])
            })
          })
        } as any);

      vi.mocked(db.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'link-1' }])
          })
        })
      } as any);

      const res = await app.request('/users/11111111-1111-1111-1111-111111111111/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roleId: '44444444-4444-4444-4444-444444444444'
        })
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(clearPermissionCache).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
    });

    it('rejects self role assignment', async () => {
      const res = await app.request('/users/user-123/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roleId: '44444444-4444-4444-4444-444444444444'
        })
      });

      expect(res.status).toBe(403);
      expect(vi.mocked(db.update)).not.toHaveBeenCalled();
    });

    it('rejects assigning roles broader than the caller', async () => {
      vi.mocked(getUserPermissions).mockResolvedValueOnce({
        permissions: [{ resource: 'users', action: 'write' }],
        partnerId: 'partner-123',
        orgId: null,
        roleId: 'role-user-manager',
        scope: 'partner'
      } as any);
      vi.mocked(db.select)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: '44444444-4444-4444-4444-444444444444',
                  scope: 'partner',
                  name: 'Operator',
                  description: null,
                  isSystem: false,
                  parentRoleId: null,
                  partnerId: 'partner-123',
                  orgId: null
                }
              ])
            })
          })
        } as any)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ parentRoleId: null }])
            })
          })
        } as any)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([{ resource: 'devices', action: 'write' }])
            })
          })
        } as any);

      const res = await app.request('/users/11111111-1111-1111-1111-111111111111/role', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roleId: '44444444-4444-4444-4444-444444444444'
        })
      });

      expect(res.status).toBe(403);
      expect(vi.mocked(db.update)).not.toHaveBeenCalled();
    });
  });

  describe('avatar endpoints', () => {
    const ME_ID = 'user-123';

    // Minimal valid PNG bytes (1x1 transparent PNG)
    const PNG_BYTES = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82,
    ]);

    // JPEG SOI + minimal junk (FF D8 FF E0 ...). Not a real image but the
    // magic-byte check only inspects the first three bytes.
    const JPEG_BYTES = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(64, 0),
    ]);

    // WebP RIFF header (12 bytes is enough for the sniff function).
    const WEBP_BYTES = Buffer.concat([
      Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x10, 0x00, 0x00, 0x00, // size
        0x57, 0x45, 0x42, 0x50, // WEBP
      ]),
      Buffer.alloc(32, 0),
    ]);

    // SVG with a small XML preamble
    const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>', 'utf-8');

    function makeUpdateMock(returning: unknown[]) {
      vi.mocked(db.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(returning)
          })
        })
      } as any);
    }

    function makeMultipart(field: string, bytes: Buffer, mime: string, filename: string): { body: BodyInit; headers: HeadersInit } {
      const formData = new FormData();
      // Buffer's polymorphic ArrayBufferLike confuses the Blob constructor type;
      // copy into a fresh Uint8Array (whose buffer is a plain ArrayBuffer).
      const view = new Uint8Array(bytes.byteLength);
      view.set(bytes);
      const blob = new Blob([view], { type: mime });
      formData.append(field, blob, filename);
      return {
        body: formData,
        // Browser/undici set Content-Type with boundary automatically when we
        // pass a FormData to Request, so do NOT supply Content-Type manually.
        headers: {}
      };
    }

    describe('POST /users/me/avatar', () => {
      it('accepts a PNG upload and writes /api/v1/users/<id>/avatar to users.avatar_url', async () => {
        makeUpdateMock([{ id: ME_ID, avatarUrl: `/api/v1/users/${ME_ID}/avatar`, updatedAt: new Date() }]);

        const { body, headers } = makeMultipart('file', PNG_BYTES, 'image/png', 'a.png');
        const res = await app.request('/users/me/avatar', { method: 'POST', body, headers });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.avatarUrl).toBe(`/api/v1/users/${ME_ID}/avatar`);
        expect(data.mime).toBe('image/png');
        expect(data.size).toBe(PNG_BYTES.length);
      });

      it('accepts a JPEG upload', async () => {
        makeUpdateMock([{ id: ME_ID, avatarUrl: `/api/v1/users/${ME_ID}/avatar`, updatedAt: new Date() }]);
        const { body, headers } = makeMultipart('file', JPEG_BYTES, 'image/jpeg', 'a.jpg');
        const res = await app.request('/users/me/avatar', { method: 'POST', body, headers });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.mime).toBe('image/jpeg');
      });

      it('accepts a WebP upload', async () => {
        makeUpdateMock([{ id: ME_ID, avatarUrl: `/api/v1/users/${ME_ID}/avatar`, updatedAt: new Date() }]);
        const { body, headers } = makeMultipart('file', WEBP_BYTES, 'image/webp', 'a.webp');
        const res = await app.request('/users/me/avatar', { method: 'POST', body, headers });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.mime).toBe('image/webp');
      });

      it('rejects SVG (not in MIME allowlist and fails magic-byte sniff)', async () => {
        const { body, headers } = makeMultipart('file', SVG_BYTES, 'image/svg+xml', 'a.svg');
        const res = await app.request('/users/me/avatar', { method: 'POST', body, headers });
        expect(res.status).toBe(415);
      });

      it('rejects a file claiming image/png but containing JPEG bytes', async () => {
        const { body, headers } = makeMultipart('file', JPEG_BYTES, 'image/png', 'fake.png');
        const res = await app.request('/users/me/avatar', { method: 'POST', body, headers });
        // image/png claimed but JPEG magic → 400 content-type mismatch
        expect(res.status).toBe(400);
      });

      it('rejects empty file', async () => {
        const { body, headers } = makeMultipart('file', Buffer.alloc(0), 'image/png', 'a.png');
        const res = await app.request('/users/me/avatar', { method: 'POST', body, headers });
        expect(res.status).toBe(400);
      });

      it('rejects multipart without a file field', async () => {
        const fd = new FormData();
        fd.append('notfile', new Blob([PNG_BYTES], { type: 'image/png' }), 'a.png');
        const res = await app.request('/users/me/avatar', { method: 'POST', body: fd });
        expect(res.status).toBe(400);
      });
    });

    describe('DELETE /users/me/avatar', () => {
      it('clears avatar_url and returns avatarUrl: null', async () => {
        makeUpdateMock([{ id: ME_ID, avatarUrl: null }]);
        const res = await app.request('/users/me/avatar', { method: 'DELETE' });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.avatarUrl).toBeNull();
      });
    });

    describe('POST then GET roundtrip', () => {
      it('uploads a PNG and serves it back from GET /users/:id/avatar with image/png + cache headers', async () => {
        makeUpdateMock([{ id: ME_ID, avatarUrl: `/api/v1/users/${ME_ID}/avatar`, updatedAt: new Date() }]);

        const { body, headers } = makeMultipart('file', PNG_BYTES, 'image/png', 'a.png');
        const postRes = await app.request('/users/me/avatar', { method: 'POST', body, headers });
        expect(postRes.status).toBe(200);

        const getRes = await app.request(`/users/${ME_ID}/avatar`, { method: 'GET' });
        expect(getRes.status).toBe(200);
        expect(getRes.headers.get('content-type')).toBe('image/png');
        expect(getRes.headers.get('cache-control')).toBe('private, max-age=300');
        expect(getRes.headers.get('etag')).toMatch(/^W\//);
        const body2 = Buffer.from(await getRes.arrayBuffer());
        expect(body2.equals(PNG_BYTES)).toBe(true);
      });
    });
  });
});
