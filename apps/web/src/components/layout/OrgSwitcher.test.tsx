import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import OrgSwitcher, { getOrgSwitchRedirect } from './OrgSwitcher';

const {
  setOrganizationMock,
  setSiteMock,
  setOrgScopeMock,
  fetchOrganizationsMock,
  fetchSitesMock,
  mockStoreRef,
} = vi.hoisted(() => ({
  setOrganizationMock: vi.fn(),
  setSiteMock: vi.fn(),
  setOrgScopeMock: vi.fn(),
  fetchOrganizationsMock: vi.fn(),
  fetchSitesMock: vi.fn(),
  mockStoreRef: { current: null as any },
}));

let mockStoreState: {
  currentOrgId: string | null;
  currentSiteId: string | null;
  orgScope: 'current' | 'all';
  organizations: Array<{ id: string; partnerId: string; name: string; status: string; createdAt: string }>;
  sites: Array<{ id: string; orgId: string; name: string; deviceCount: number; createdAt: string }>;
  isLoading: boolean;
};

vi.mock('@/stores/orgStore', () => {
  const buildStoreSnapshot = () => ({
    ...mockStoreRef.current,
    setOrganization: setOrganizationMock,
    setSite: setSiteMock,
    setOrgScope: setOrgScopeMock,
    fetchOrganizations: fetchOrganizationsMock,
    fetchSites: fetchSitesMock,
  });
  const useOrgStore = vi.fn((selector?: (state: ReturnType<typeof buildStoreSnapshot>) => unknown) => {
    const snap = buildStoreSnapshot();
    return selector ? selector(snap) : snap;
  });
  (useOrgStore as unknown as { getState: () => ReturnType<typeof buildStoreSnapshot> }).getState = () => buildStoreSnapshot();
  return { useOrgStore };
});

describe('getOrgSwitchRedirect', () => {
  it('redirects /devices/:id to /devices', () => {
    expect(getOrgSwitchRedirect('/devices/abc123')).toBe('/devices');
    expect(getOrgSwitchRedirect('/devices/abc123/')).toBe('/devices');
  });

  it('does not redirect from the device list itself', () => {
    expect(getOrgSwitchRedirect('/devices')).toBeNull();
    expect(getOrgSwitchRedirect('/devices/')).toBeNull();
  });

  it('does not redirect sibling device routes that share the prefix', () => {
    expect(getOrgSwitchRedirect('/devices/compare')).toBeNull();
    expect(getOrgSwitchRedirect('/devices/groups')).toBeNull();
  });

  it('does not redirect unrelated routes', () => {
    expect(getOrgSwitchRedirect('/')).toBeNull();
    expect(getOrgSwitchRedirect('/alerts/abc123')).toBeNull();
    expect(getOrgSwitchRedirect('/scripts/abc123')).toBeNull();
    expect(getOrgSwitchRedirect('/settings/organizations/abc123')).toBeNull();
  });
});

describe('OrgSwitcher org change navigation', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    setOrganizationMock.mockReset();
    setSiteMock.mockReset();
    setOrgScopeMock.mockReset();
    fetchOrganizationsMock.mockReset();
    fetchSitesMock.mockReset();

    mockStoreState = {
      currentOrgId: 'org-a',
      currentSiteId: null,
      orgScope: 'current',
      organizations: [
        { id: 'org-a', partnerId: 'p1', name: 'Org A', status: 'active', createdAt: '2024-01-01' },
        { id: 'org-b', partnerId: 'p1', name: 'Org B', status: 'active', createdAt: '2024-01-01' }
      ],
      sites: [],
      isLoading: false
    };
    mockStoreRef.current = mockStoreState;
  });

  function stubLocation(pathname: string) {
    const reloadMock = vi.fn();
    const hrefSetter = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: {
        ...originalLocation,
        pathname,
        reload: reloadMock,
        set href(value: string) {
          hrefSetter(value);
        },
        get href() {
          return `http://localhost${pathname}`;
        }
      }
    });
    return { reloadMock, hrefSetter };
  }

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation
    });
  });

  function openDropdownAndClickOrg(orgName: string) {
    // The OrgScopePill renders two buttons BEFORE the org-picker trigger when
    // multiple orgs are accessible, so target the trigger explicitly by
    // data-testid rather than relying on DOM order.
    const triggerButton = screen.getByTestId('org-switcher-trigger');
    fireEvent.click(triggerButton);
    const orgButtons = screen
      .getAllByRole('button')
      .filter((b) => b !== triggerButton && b.textContent?.includes(orgName));
    if (orgButtons.length === 0) {
      throw new Error(`No menu item for ${orgName} found`);
    }
    fireEvent.click(orgButtons[0]);
  }

  it('redirects to /devices when switching orgs from a device-detail page', () => {
    const { reloadMock, hrefSetter } = stubLocation('/devices/abc123');

    render(<OrgSwitcher />);

    openDropdownAndClickOrg('Org B');

    expect(setOrganizationMock).toHaveBeenCalledWith('org-b');
    expect(hrefSetter).toHaveBeenCalledWith('/devices');
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('reloads in place when switching orgs from a non-detail page', () => {
    const { reloadMock, hrefSetter } = stubLocation('/devices');

    render(<OrgSwitcher />);

    openDropdownAndClickOrg('Org B');

    expect(setOrganizationMock).toHaveBeenCalledWith('org-b');
    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(hrefSetter).not.toHaveBeenCalled();
  });

  it('does nothing when clicking the already-selected organization', () => {
    const { reloadMock, hrefSetter } = stubLocation('/devices/abc123');

    render(<OrgSwitcher />);

    openDropdownAndClickOrg('Org A');

    expect(setOrganizationMock).not.toHaveBeenCalled();
    expect(reloadMock).not.toHaveBeenCalled();
    expect(hrefSetter).not.toHaveBeenCalled();
  });
});
