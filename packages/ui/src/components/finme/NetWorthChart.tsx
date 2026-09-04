import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { formatCents } from '@/lib/format';

/**
 * The net worth series, drawn with uPlot.
 *
 * Canvas rather than SVG because a 1,560-point series has to pan smoothly on a
 * mid-range Android. **No hover tooltip** — the crosshair follows touch and the
 * inspected value is rendered as text beside the chart, so the reading is
 * available without a pointer (BUILD-PLAN Part 2b).
 *
 * The line is a single neutral colour whatever the value does. A series that
 * turned red below zero would be the chart making a judgement.
 */
export function NetWorthChart({
  values,
  onInspect,
  height = 180,
}: {
  values: readonly number[];
  onInspect?: (index: number | null) => void;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  // The latest-callback ref, updated in an effect rather than during render, so
  // the plot's hook always calls the current handler without re-creating the
  // plot every time the parent re-renders.
  const inspectRef = useRef(onInspect);
  useEffect(() => {
    inspectRef.current = onInspect;
  }, [onInspect]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || values.length === 0) return;

    const data: uPlot.AlignedData = [
      Array.from({ length: values.length }, (_, i) => i),
      Array.from(values, (value) => value / 100),
    ];

    const plot = new uPlot(
      {
        width: container.clientWidth,
        height,
        padding: [8, 8, 0, 0],
        cursor: {
          // Tap-to-inspect with a persistent crosshair, never a hover tooltip.
          x: true,
          y: false,
          points: { show: true, size: 8 },
          drag: { x: true, y: false, uni: 20 },
        },
        legend: { show: false },
        scales: { x: { time: false } },
        axes: [
          { stroke: 'currentColor', grid: { show: false }, ticks: { show: false },
            values: (_u, splits) => splits.map((week) => `Y${Math.floor(week / 52) + 1}`) },
          { stroke: 'currentColor', grid: { stroke: 'currentColor', width: 0.4 },
            ticks: { show: false },
            values: (_u, splits) => splits.map((dollars) => formatCents(dollars * 100, { compact: true })) },
        ],
        series: [
          {},
          { stroke: 'currentColor', width: 2, points: { show: false } },
        ],
        hooks: {
          setCursor: [
            (u) => inspectRef.current?.(u.cursor.idx ?? null),
          ],
        },
      },
      data,
      container,
    );
    plotRef.current = plot;

    const resize = new ResizeObserver(() => plot.setSize({ width: container.clientWidth, height }));
    resize.observe(container);

    return () => {
      resize.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [values, height]);

  if (values.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-muted-foreground"
        style={{ height }}
      >
        No history yet.
      </div>
    );
  }

  return <div ref={containerRef} className="w-full overflow-hidden text-muted-foreground" />;
}
