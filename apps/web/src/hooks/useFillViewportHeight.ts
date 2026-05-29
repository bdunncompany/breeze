import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Sizes a scrollable element to fill the space between its own top and the
 * bottom of the viewport, leaving `gap` px and never going below `min`.
 *
 * Returns a ref to attach to the scrollable element and a `maxHeight` (px) to
 * apply via inline style. The value recomputes on mount, window resize, and
 * scroll, so the box grows with the browser window and never runs off the
 * bottom edge regardless of where the trigger sits on the page.
 *
 * Use instead of a fixed `max-h-NN` Tailwind class on dropdown/picker lists.
 */
export function useFillViewportHeight<T extends HTMLElement = HTMLDivElement>(
  enabled = true,
  { gap = 16, min = 160 }: { gap?: number; min?: number } = {}
) {
  const ref = useRef<T | null>(null);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    const recompute = () => {
      const top = el.getBoundingClientRect().top;
      setMaxHeight(Math.max(min, Math.round(window.innerHeight - top - gap)));
    };

    recompute();
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true); // capture: catches scrolls in any ancestor
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [enabled, gap, min]);

  return { ref, maxHeight };
}
