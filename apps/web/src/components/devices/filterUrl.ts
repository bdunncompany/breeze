// URL hash encoding/decoding for the v2 chip filter UI.
// Spec section 3.3: `#filtersV2=<base64url(JSON.stringify(FilterConditionGroup))>`.
import type { FilterConditionGroup } from '@breeze/shared';

const HASH_KEY = 'filtersV2';
const LS_FLAG_KEY = 'breeze.filtersV2.enabled';

function toBase64Url(s: string): string {
  if (typeof window === 'undefined') return '';
  // btoa requires latin1; JSON we encode is ASCII for typical filter shapes,
  // but wrap in encodeURIComponent to be safe with non-ASCII tag values etc.
  const bin = unescape(encodeURIComponent(s));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  if (typeof window === 'undefined') return '';
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  return decodeURIComponent(escape(bin));
}

export function encodeFilterToHash(group: FilterConditionGroup | null): string {
  if (!group || group.conditions.length === 0) return '';
  return `${HASH_KEY}=${toBase64Url(JSON.stringify(group))}`;
}

export function decodeFilterFromHash(hash: string): FilterConditionGroup | null {
  if (!hash) return null;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  for (const part of raw.split('&')) {
    const [k, v] = part.split('=');
    if (k === HASH_KEY && v) {
      try {
        return JSON.parse(fromBase64Url(v)) as FilterConditionGroup;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function writeFilterToHash(group: FilterConditionGroup | null): void {
  if (typeof window === 'undefined') return;
  const encoded = encodeFilterToHash(group);
  // Preserve any non-filtersV2 hash fragments untouched (e.g. #add-device).
  const existing = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  const others = existing
    .split('&')
    .filter(p => p && !p.startsWith(`${HASH_KEY}=`));
  const next = encoded ? [encoded, ...others].join('&') : others.join('&');
  const newHash = next ? `#${next}` : '';
  if (newHash !== window.location.hash) {
    // Replace, don't push, so back-button doesn't fill with filter edits.
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}${newHash}`);
  }
}

/**
 * V2 chip filter is now the DEFAULT — returns true unless the user has
 * explicitly opted out via `?filtersV2=0` (which also persists to
 * localStorage as `'0'`). `?filtersV2=1` re-opts in. Anyone with no
 * explicit choice gets the new UI.
 *
 * Returns false during SSR (no window). Returns false if localStorage
 * has `'0'` stored. Returns true in every other case.
 */
export function isFiltersV2Enabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const qp = params.get('filtersV2');
    if (qp !== null) {
      const on = qp === '1' || qp.toLowerCase() === 'true';
      try {
        window.localStorage.setItem(LS_FLAG_KEY, on ? '1' : '0');
      } catch {
        // localStorage may be unavailable (private mode); query param alone
        // still drives this visit.
      }
      return on;
    }
    const stored = window.localStorage.getItem(LS_FLAG_KEY);
    // Only the explicit opt-out value disables; anything else (including
    // absent key) gets the new UI.
    return stored !== '0' && stored !== 'false';
  } catch {
    return true;
  }
}
