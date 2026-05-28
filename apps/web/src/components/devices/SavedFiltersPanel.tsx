// SavedFiltersPanel - compact "Saved Filters" button that opens a popover with
// the user's saved filters. POC scope: lists all filters visible to the user
// (uses GET /api/v1/filters). Save creates a filter (createdBy = current user,
// orgId or partnerId resolved by the API from auth context).
//
// Renders as a small button so it doesn't consume vertical space when closed.
// Earlier left-column layout pushed the device list below the fold whenever
// the user accumulated more than a few filters.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookmarkIcon, Save, ChevronDown } from 'lucide-react';
import type { FilterConditionGroup, SavedFilter } from '@breeze/shared';
import { fetchWithAuth } from '../../stores/auth';

export interface SavedFiltersPanelProps {
  currentFilter: FilterConditionGroup | null;
  onApply: (filter: FilterConditionGroup) => void;
  // Spec 4.12 — when the parent's `Ctrl+S` handler fires, it bumps this
  // counter to invoke handleSave without needing a ref or imperative API.
  saveTrigger?: number;
}

function countChips(group: FilterConditionGroup | null): number {
  if (!group) return 0;
  return group.conditions.filter(c => !('conditions' in c)).length;
}

export function SavedFiltersPanel({ currentFilter, onApply, saveTrigger }: SavedFiltersPanelProps) {
  const [filters, setFilters] = useState<SavedFilter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/filters');
      if (res.ok) {
        const data = await res.json();
        setFilters(data.data ?? []);
      } else {
        setError(`Failed to load (${res.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Close popover on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSave = useCallback(async () => {
    if (!currentFilter || countChips(currentFilter) === 0) return;
    const name = window.prompt('Name this filter:');
    if (!name) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetchWithAuth('/filters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, conditions: currentFilter })
      });
      if (res.ok) {
        await refresh();
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Save failed (${res.status})`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [currentFilter, refresh]);

  // React to parent's Ctrl+S trigger. Skip the initial mount value (0).
  useEffect(() => {
    if (!saveTrigger) return;
    void handleSave();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveTrigger]);

  const filterCount = filters.length;
  const canSave = countChips(currentFilter) > 0 && !saving;

  return (
    <div ref={wrapperRef} data-testid="saved-filters-panel" className="relative inline-flex items-center gap-2 shrink-0">
      <button
        type="button"
        data-testid="saved-filters-toggle"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 rounded border bg-card px-2.5 py-1.5 text-sm hover:bg-muted"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <BookmarkIcon className="h-4 w-4" />
        <span>Saved</span>
        {filterCount > 0 && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {filterCount}
          </span>
        )}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <button
        type="button"
        data-testid="saved-filter-save-button"
        onClick={handleSave}
        disabled={!canSave}
        className="inline-flex items-center gap-1 rounded border bg-card px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
        title="Save current filter"
      >
        <Save className="h-3 w-3" />
        Save
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-72 rounded-md border bg-card p-2 shadow-lg"
          role="listbox"
        >
          {error && (
            <div className="mb-2 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {error}
            </div>
          )}
          {loading && (
            <div className="px-2 py-1 text-xs text-muted-foreground">Loading…</div>
          )}
          {!loading && filters.length === 0 && (
            <div className="px-2 py-1 text-xs text-muted-foreground">
              No saved filters yet.
            </div>
          )}
          {!loading && filters.length > 0 && (
            <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
              {filters.map(f => {
                const chipCount = countChips(f.conditions as FilterConditionGroup);
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      data-testid={`saved-filter-apply-${f.id}`}
                      onClick={() => {
                        onApply(f.conditions as FilterConditionGroup);
                        setOpen(false);
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted"
                    >
                      <span className="truncate">{f.name}</span>
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {chipCount}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
