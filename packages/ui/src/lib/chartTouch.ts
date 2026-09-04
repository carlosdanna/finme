import type uPlot from 'uplot';

/**
 * Explicit touch handling for uPlot: one-finger drag to pan, two-finger pinch
 * to zoom, and a tap that leaves the crosshair where it was put.
 *
 * uPlot ships mouse drag-to-zoom but no touch gestures at all, so a phone would
 * otherwise be left with a chart it can only look at. **Nothing here depends on
 * hover** — the crosshair is driven by touch position and the inspected value is
 * rendered as text beside the chart (BUILD-PLAN Part 2b).
 */
export function touchGestures(): uPlot.Plugin {
  return {
    hooks: {
      ready: (u: uPlot) => {
        const over = u.over;
        let mode: 'none' | 'pan' | 'pinch' = 'none';
        let startX = 0;
        let startPinch = 0;
        let startMin = 0;
        let startMax = 0;

        const scale = u.scales.x;
        const spanFor = (): { min: number; max: number } => ({
          min: scale.min ?? 0,
          max: scale.max ?? 0,
        });

        const distance = (touches: TouchList): number =>
          Math.abs(touches[0].clientX - touches[1].clientX);

        over.addEventListener(
          'touchstart',
          (event: TouchEvent) => {
            const span = spanFor();
            startMin = span.min;
            startMax = span.max;

            if (event.touches.length === 1) {
              mode = 'pan';
              startX = event.touches[0].clientX;
            } else if (event.touches.length === 2) {
              mode = 'pinch';
              startPinch = distance(event.touches);
            }
          },
          { passive: true },
        );

        over.addEventListener(
          'touchmove',
          (event: TouchEvent) => {
            if (mode === 'none') return;
            const width = u.bbox.width / devicePixelRatio;
            const range = startMax - startMin;

            if (mode === 'pan' && event.touches.length === 1) {
              // Dragging right moves the window left, as a map does.
              const shift = ((startX - event.touches[0].clientX) / width) * range;
              u.setScale('x', { min: startMin + shift, max: startMax + shift });
              event.preventDefault();
              return;
            }

            if (mode === 'pinch' && event.touches.length === 2) {
              const current = distance(event.touches);
              if (startPinch === 0 || current === 0) return;
              const factor = startPinch / current;
              const centre = (startMin + startMax) / 2;
              const half = (range * factor) / 2;
              u.setScale('x', { min: centre - half, max: centre + half });
              event.preventDefault();
            }
          },
          { passive: false },
        );

        const end = (): void => {
          mode = 'none';
        };
        over.addEventListener('touchend', end, { passive: true });
        over.addEventListener('touchcancel', end, { passive: true });
      },
    },
  };
}

/** Axis labels that read as run years rather than week numbers. */
export function weekAxisValues(_u: uPlot, splits: number[]): string[] {
  return splits.map((week) => `Y${Math.floor(week / 52) + 1}`);
}
