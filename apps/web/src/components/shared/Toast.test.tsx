import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ToastContainer, { showToast, _resetToastQueueForTests } from './Toast';

describe('ToastContainer', () => {
  beforeEach(() => {
    _resetToastQueueForTests();
  });

  afterEach(() => {
    _resetToastQueueForTests();
  });

  it('renders an error toast with role=alert and aria-live=assertive so screen readers and Playwright role-selectors find it', () => {
    render(<ToastContainer />);

    act(() => {
      showToast({ type: 'error', message: 'NO_MACS: no MAC on file' });
    });

    const toast = screen.getByTestId('toast');
    expect(toast).toHaveAttribute('role', 'alert');
    expect(toast).toHaveAttribute('aria-live', 'assertive');
    expect(toast).toHaveAttribute('data-toast-type', 'error');
    expect(toast).toHaveTextContent('NO_MACS: no MAC on file');

    expect(screen.getByRole('alert')).toBe(toast);
  });

  it('renders a success toast with role=status and aria-live=polite', () => {
    render(<ToastContainer />);

    act(() => {
      showToast({ type: 'success', message: 'Wake packet sent' });
    });

    const toast = screen.getByTestId('toast');
    expect(toast).toHaveAttribute('role', 'status');
    expect(toast).toHaveAttribute('aria-live', 'polite');
    expect(toast).toHaveAttribute('data-toast-type', 'success');
    expect(toast).toHaveTextContent('Wake packet sent');
  });

  it('renders an undo toast with role=status and exposes the Undo button', () => {
    render(<ToastContainer />);
    const onUndo = vi.fn();

    act(() => {
      showToast({ type: 'undo', message: 'Decommissioning...', onUndo });
    });

    const toast = screen.getByTestId('toast');
    expect(toast).toHaveAttribute('role', 'status');
    expect(toast).toHaveAttribute('data-toast-type', 'undo');

    const undoBtn = screen.getByRole('button', { name: /undo/i });
    expect(undoBtn).toBeInTheDocument();
  });

  it('flushes toasts queued before the container mounts (avoids silent-drop on early showToast calls)', async () => {
    // showToast called before any ToastContainer is mounted — the existing
    // production failure mode was that this silently no-op'd. The queue
    // change must surface the toast as soon as the container appears.
    showToast({ type: 'error', message: 'queued-error-message' });
    showToast({ type: 'success', message: 'queued-success-message' });

    render(<ToastContainer />);

    await waitFor(() => {
      const toasts = screen.getAllByTestId('toast');
      expect(toasts).toHaveLength(2);
    });

    expect(screen.getByText('queued-error-message')).toBeInTheDocument();
    expect(screen.getByText('queued-success-message')).toBeInTheDocument();
  });

  it('survives an unmount/remount cycle without losing toasts emitted in the gap', async () => {
    const { unmount } = render(<ToastContainer />);

    unmount();

    // Emit a toast while no container is mounted (e.g., between Astro view
    // transitions). It must land when the next container mounts.
    showToast({ type: 'error', message: 'between-mounts-message' });

    render(<ToastContainer />);

    await waitFor(() => {
      expect(screen.getByText('between-mounts-message')).toBeInTheDocument();
    });
    expect(screen.getByTestId('toast')).toHaveAttribute('role', 'alert');
  });

  it('auto-dismisses after the default 5000ms', async () => {
    vi.useFakeTimers();
    try {
      render(<ToastContainer />);

      act(() => {
        showToast({ type: 'success', message: 'self-dismissing' });
      });

      expect(screen.getByTestId('toast')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
