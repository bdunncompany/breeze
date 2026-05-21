import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchWithAuth } from '../../stores/auth';

// Stub the heavy deps so the test only exercises the Current-org / All-orgs
// toggle wiring on AlertsPage (state, hash sync, summary count semantics).
vi.mock('../../stores/auth', () => ({ fetchWithAuth: vi.fn() }));

const useOrgStoreMock = vi.fn();
vi.mock('../../stores/orgStore', () => ({ useOrgStore: () => useOrgStoreMock() }));

vi.mock('../shared/Toast', () => ({ showToast: vi.fn() }));
vi.mock('@/lib/navigation', () => ({ navigateTo: vi.fn() }));

// AlertList rendering would pull in localStorage / FilterBuilder / charts.
// The toggle test only cares that the right list+count gets through, so
// render a thin probe that exposes both.
vi.mock('./AlertList', () => ({
  __esModule: true,
  default: (props: { alerts: Array<{ id: string }> }) => (
    <div
      data-testid="alert-list-stub"
      data-alert-count={props.alerts.length}
      data-alert-ids={props.alerts.map((a) => a.id).join(',')}
    />
  ),
}));

vi.mock('./AlertDetails', () => ({ __esModule: true, default: () => null }));

vi.mock('./AlertsSummary', () => ({
  __esModule: true,
  default: (props: { alerts: Array<{ severity: string; count: number }> }) => {
    const total = props.alerts.reduce((sum, a) => sum + a.count, 0);
    return <div data-testid="alerts-summary-stub" data-summary-total={total} />;
  },
}));

vi.mock('./AlertsTabStrip', () => ({ __esModule: true, default: () => null }));

vi.mock('../filters/DeviceFilterBar', () => ({
  __esModule: true,
  DeviceFilterBar: () => null,
  default: () => null,
}));

import AlertsPage from './AlertsPage';

const fetchWithAuthMock = vi.mocked(fetchWithAuth);

function jsonResponse(payload: unknown, ok = true, status = ok ? 200 : 500): Response {
  return ({
    ok,
    status,
    json: vi.fn().mockResolvedValue(payload),
  }) as unknown as Response;
}

function mockApis(alerts: Array<Record<string, unknown>>, devices: Array<Record<string, unknown>>) {
  fetchWithAuthMock.mockImplementation((url: string) => {
    if (url.startsWith('/alerts')) return Promise.resolve(jsonResponse({ data: alerts }));
    if (url.startsWith('/devices')) return Promise.resolve(jsonResponse({ data: devices }));
    return Promise.resolve(jsonResponse({}));
  });
}

describe('AlertsPage — Current-org / All-orgs scope toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useOrgStoreMock.mockReturnValue({
      currentOrgId: 'org-a',
      organizations: [
        { id: 'org-a', name: 'Acme Inc' },
        { id: 'org-b', name: 'Beta LLC' },
      ],
    });
    window.history.replaceState(null, '', '/alerts');
  });

  it('defaults to Current-org scope and filters alerts down to currentOrgId', async () => {
    mockApis(
      [
        { id: 'a1', orgId: 'org-a', title: 'A-1', message: 'm', severity: 'high', status: 'active', deviceId: 'd1', deviceName: 'pc-a', triggeredAt: '2026-05-21T00:00:00Z' },
        { id: 'a2', orgId: 'org-b', title: 'B-1', message: 'm', severity: 'high', status: 'active', deviceId: 'd2', deviceName: 'pc-b', triggeredAt: '2026-05-21T00:00:00Z' },
      ],
      [{ id: 'd1', displayName: 'pc-a' }, { id: 'd2', displayName: 'pc-b' }]
    );

    render(<AlertsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-list-stub')).toBeInTheDocument();
    });

    const currentBtn = screen.getByTestId('org-scope-current');
    const allBtn = screen.getByTestId('org-scope-all');
    expect(currentBtn).toHaveAttribute('aria-pressed', 'true');
    expect(allBtn).toHaveAttribute('aria-pressed', 'false');

    // Only the org-a alert should be visible, and the summary tile count
    // should reflect only that one alert too.
    expect(screen.getByTestId('alert-list-stub')).toHaveAttribute('data-alert-count', '1');
    expect(screen.getByTestId('alert-list-stub')).toHaveAttribute('data-alert-ids', 'a1');
    expect(screen.getByTestId('alerts-summary-stub')).toHaveAttribute('data-summary-total', '1');
  });

  it('switches to All-orgs, shows alerts from every org, and writes #scope=all to the URL hash', async () => {
    mockApis(
      [
        { id: 'a1', orgId: 'org-a', title: 'A-1', message: 'm', severity: 'high', status: 'active', deviceId: 'd1', deviceName: 'pc-a', triggeredAt: '2026-05-21T00:00:00Z' },
        { id: 'a2', orgId: 'org-b', title: 'B-1', message: 'm', severity: 'high', status: 'active', deviceId: 'd2', deviceName: 'pc-b', triggeredAt: '2026-05-21T00:00:00Z' },
      ],
      [{ id: 'd1', displayName: 'pc-a' }, { id: 'd2', displayName: 'pc-b' }]
    );

    render(<AlertsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-list-stub')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('org-scope-all'));

    await waitFor(() => {
      expect(screen.getByTestId('org-scope-all')).toHaveAttribute('aria-pressed', 'true');
    });
    expect(screen.getByTestId('org-scope-current')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('alert-list-stub')).toHaveAttribute('data-alert-count', '2');
    expect(screen.getByTestId('alerts-summary-stub')).toHaveAttribute('data-summary-total', '2');
    expect(window.location.hash).toBe('#scope=all');
  });

  it('clears the hash when toggling back from All-orgs to Current-org', async () => {
    window.history.replaceState(null, '', '/alerts#scope=all');
    mockApis(
      [{ id: 'a1', orgId: 'org-a', title: 'A-1', message: 'm', severity: 'high', status: 'active', deviceId: 'd1', deviceName: 'pc-a', triggeredAt: '2026-05-21T00:00:00Z' }],
      [{ id: 'd1', displayName: 'pc-a' }]
    );

    render(<AlertsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('org-scope-all')).toHaveAttribute('aria-pressed', 'true');
    });

    fireEvent.click(screen.getByTestId('org-scope-current'));

    await waitFor(() => {
      expect(screen.getByTestId('org-scope-current')).toHaveAttribute('aria-pressed', 'true');
    });
    expect(window.location.hash).toBe('');
  });

  it('hydrates the toggle from #scope=all on initial mount (URL deep-link)', async () => {
    window.history.replaceState(null, '', '/alerts#scope=all');
    mockApis(
      [
        { id: 'a1', orgId: 'org-a', title: 'A-1', message: 'm', severity: 'high', status: 'active', deviceId: 'd1', deviceName: 'pc-a', triggeredAt: '2026-05-21T00:00:00Z' },
        { id: 'a2', orgId: 'org-b', title: 'B-1', message: 'm', severity: 'high', status: 'active', deviceId: 'd2', deviceName: 'pc-b', triggeredAt: '2026-05-21T00:00:00Z' },
      ],
      [{ id: 'd1', displayName: 'pc-a' }, { id: 'd2', displayName: 'pc-b' }]
    );

    render(<AlertsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-list-stub')).toBeInTheDocument();
    });
    expect(screen.getByTestId('org-scope-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('alert-list-stub')).toHaveAttribute('data-alert-count', '2');
  });

  it('disables the Current-org button when no currentOrgId is set (forces All-orgs view)', async () => {
    useOrgStoreMock.mockReturnValue({
      currentOrgId: null,
      organizations: [{ id: 'org-a', name: 'Acme Inc' }],
    });
    mockApis(
      [{ id: 'a1', orgId: 'org-a', title: 'A-1', message: 'm', severity: 'high', status: 'active', deviceId: 'd1', deviceName: 'pc-a', triggeredAt: '2026-05-21T00:00:00Z' }],
      [{ id: 'd1', displayName: 'pc-a' }]
    );

    render(<AlertsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('alert-list-stub')).toBeInTheDocument();
    });
    expect(screen.getByTestId('org-scope-current')).toBeDisabled();
    // currentOrgId null + scope='current' → lockedOrgFilter null → no
    // org-level filtering happens, alert is still visible.
    expect(screen.getByTestId('alert-list-stub')).toHaveAttribute('data-alert-count', '1');
  });
});
