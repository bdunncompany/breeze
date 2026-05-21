import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RoleManager, { PermissionMatrix, RoleFormModal, type PermissionCatalog, type Permission } from './RoleManager';
import { fetchWithAuth } from '../../stores/auth';

vi.mock('../../stores/auth', () => ({
  fetchWithAuth: vi.fn()
}));

const fetchWithAuthMock = vi.mocked(fetchWithAuth);

const makeJsonResponse = (payload: unknown, ok = true, status = ok ? 200 : 500): Response =>
  ({
    ok,
    status,
    statusText: ok ? 'OK' : 'ERROR',
    json: vi.fn().mockResolvedValue(payload)
  }) as unknown as Response;

// A small, representative catalog matching the shape of what the API returns.
// Includes the asymmetric edge cases that issue #801 exposed:
//   - `alerts` has `acknowledge` (unique to that resource)
//   - `remote` has only `access` (single-cell row)
//   - actions vary across resources (sparse matrix)
const sampleCatalog: PermissionCatalog = {
  permissions: [
    { resource: 'devices', action: 'read' },
    { resource: 'devices', action: 'write' },
    { resource: 'devices', action: 'execute' },
    { resource: 'alerts', action: 'read' },
    { resource: 'alerts', action: 'acknowledge' },
    { resource: 'remote', action: 'access' }
  ],
  resourceLabels: {
    devices: 'Devices',
    alerts: 'Alerts',
    remote: 'Remote Access'
  },
  actionLabels: {
    read: 'Read',
    write: 'Write',
    execute: 'Execute',
    acknowledge: 'Acknowledge',
    access: 'Access'
  }
};

describe('RoleManager — catalog-driven matrix (issue #801)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchWithAuthMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/permissions/catalog') {
        return makeJsonResponse(sampleCatalog);
      }
      return makeJsonResponse({ permissions: [] });
    });
  });

  it('fetches the catalog on mount', async () => {
    render(<RoleManager roles={[]} />);
    await waitFor(() => {
      expect(fetchWithAuthMock).toHaveBeenCalledWith('/permissions/catalog');
    });
  });
});

describe('PermissionMatrix — renders sparsely from catalog', () => {
  it('renders only catalog actions in the header (no view/create/update)', () => {
    render(
      <PermissionMatrix
        catalog={sampleCatalog}
        permissions={[]}
        onChange={() => {}}
      />
    );

    // Header should NOT show the legacy UI verbs.
    expect(screen.queryByRole('button', { name: 'View' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull();

    // Header SHOULD show the catalog's actions.
    expect(screen.getByRole('button', { name: 'Read' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Access' })).toBeTruthy();
  });

  it('does not render checkboxes for (resource, action) pairs that are not in the catalog', () => {
    const { container } = render(
      <PermissionMatrix
        catalog={sampleCatalog}
        permissions={[]}
        onChange={() => {}}
      />
    );

    // Catalog has 6 permissions; only 6 cells should have a checkbox.
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(6);
  });

  it('toggling a catalog cell calls onChange with the catalog-valid pair', () => {
    const onChange = vi.fn();
    render(
      <PermissionMatrix
        catalog={sampleCatalog}
        permissions={[]}
        onChange={onChange}
      />
    );

    // Find the row for "Remote Access" — its only action is "Access".
    const rows = screen.getAllByRole('row');
    const remoteRow = rows.find((r) => within(r).queryByRole('button', { name: 'Remote Access' }));
    expect(remoteRow).toBeTruthy();

    const checkbox = within(remoteRow!).getByRole('checkbox');
    fireEvent.click(checkbox);

    expect(onChange).toHaveBeenCalledTimes(1);
    const calledWith = onChange.mock.calls[0][0] as Permission[];
    expect(calledWith).toEqual([{ resource: 'remote', action: 'access' }]);
  });

  it('toggleRow only emits catalog-supported actions for that resource', () => {
    const onChange = vi.fn();
    render(
      <PermissionMatrix
        catalog={sampleCatalog}
        permissions={[]}
        onChange={onChange}
      />
    );

    // Click the "Alerts" row toggle.
    const alertsButton = screen.getByRole('button', { name: 'Alerts' });
    fireEvent.click(alertsButton);

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as Permission[];
    // alerts has read + acknowledge in the catalog. Nothing else.
    const keys = emitted.map((p) => `${p.resource}:${p.action}`).sort();
    expect(keys).toEqual(['alerts:acknowledge', 'alerts:read']);
  });
});

describe('RoleFormModal — submits catalog-valid pairs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchWithAuthMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/permissions/catalog') {
        return makeJsonResponse(sampleCatalog);
      }
      return makeJsonResponse({});
    });
  });

  it('renders the matrix from the fetched catalog and submits only catalog pairs', async () => {
    const onSubmit = vi.fn();

    render(
      <RoleFormModal
        isOpen
        mode="create"
        onSubmit={onSubmit}
        onCancel={() => {}}
      />
    );

    // Wait for catalog fetch and matrix render.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Read' })).toBeTruthy();
    });

    // Tick the (devices, write) cell.
    const rows = screen.getAllByRole('row');
    const devicesRow = rows.find((r) => within(r).queryByRole('button', { name: 'Devices' }));
    expect(devicesRow).toBeTruthy();
    const checkboxes = within(devicesRow!).getAllByRole('checkbox');
    // devices supports read, write, execute → 3 checkboxes. Pick the middle (write).
    expect(checkboxes.length).toBe(3);
    fireEvent.click(checkboxes[1]);

    // Fill name and submit.
    const nameInput = screen.getByLabelText('Name');
    fireEvent.change(nameInput, { target: { value: 'Test Role' } });

    const submitButton = screen.getByRole('button', { name: 'Create Role' });
    fireEvent.click(submitButton);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0][0] as { permissions: Permission[] };
    expect(submitted.permissions).toEqual([{ resource: 'devices', action: 'write' }]);
  });
});
