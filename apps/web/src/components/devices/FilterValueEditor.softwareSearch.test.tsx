import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FilterValueEditor } from './FilterValueEditor';
import { getFieldDef } from './filterFields';

const softwareField = getFieldDef('software.installed')!;

const baseCondition = {
  field: 'software.installed',
  operator: 'hasAny' as const,
  value: [] as string[],
};

describe('FilterValueEditor — software multi-select server-side search wiring', () => {
  it('fires onSoftwareSearchChange with the live query on every keystroke', () => {
    const onSearchChange = vi.fn();
    render(
      <FilterValueEditor
        field={softwareField}
        condition={baseCondition}
        onChange={() => {}}
        softwareOptions={[]}
        onSoftwareSearchChange={onSearchChange}
      />
    );

    const input = screen.getByTestId('filter-software-search') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'f' } });
    fireEvent.change(input, { target: { value: 'fi' } });
    fireEvent.change(input, { target: { value: 'firefox' } });

    expect(onSearchChange).toHaveBeenCalledTimes(3);
    expect(onSearchChange.mock.calls.map((c) => c[0])).toEqual(['f', 'fi', 'firefox']);
  });

  it('renders the parent-provided options as-is (the parent owns the server-side filter)', () => {
    // When the parent does server-side search, the response IS the filtered set
    // for the current query. The local fallback filter is a no-op in that mode
    // because every option contains the query by construction. This test
    // mimics the typical parent-driven scenario.
    const options = [
      'Mozilla Firefox (x64 en-US)',
      'Mozilla Firefox (x64 zh-CN)',
      'Firefox ActiveX Plugin r37',
    ];
    render(
      <FilterValueEditor
        field={softwareField}
        condition={baseCondition}
        onChange={() => {}}
        softwareOptions={options}
        onSoftwareSearchChange={() => {}}
      />
    );

    // With empty query, all options render (sliced to 50).
    for (const name of options) {
      expect(screen.getByTestId(`filter-software-option-${name}`)).toBeInTheDocument();
    }
  });

  it('does not require onSoftwareSearchChange (backwards-compatible: falls back to client-side filter)', () => {
    const options = ['7-Zip 26.00 (x64)', 'Mozilla Firefox (x64 en-US)', 'Google Chrome'];
    render(
      <FilterValueEditor
        field={softwareField}
        condition={baseCondition}
        onChange={() => {}}
        softwareOptions={options}
        // onSoftwareSearchChange intentionally omitted
      />
    );

    const input = screen.getByTestId('filter-software-search') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'firefox' } });

    // Only the Firefox option survives the local filter; the other two are hidden.
    expect(screen.getByTestId('filter-software-option-Mozilla Firefox (x64 en-US)')).toBeInTheDocument();
    expect(screen.queryByTestId('filter-software-option-7-Zip 26.00 (x64)')).not.toBeInTheDocument();
    expect(screen.queryByTestId('filter-software-option-Google Chrome')).not.toBeInTheDocument();
  });
});
