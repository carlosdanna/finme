import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { EpilogueBand } from '@finme/engine';
import { formatCents } from '@/lib/format';
import { touchGestures } from '@/lib/chartTouch';

/**
 * The epilogue projection: a 10th-to-90th percentile band with the median
 * through it, against the same contributions held entirely in cash.
 *
 * Four series, one neutral colour, differing only in weight and fill. Nothing
 * here is green or red — the chart shows two futures and lets the reader draw
 * the conclusion (TDD §12: "no adjectives whatsoever").
 */
export function EpilogueChart({
  bands,
  onInspect,
  height = 220,
}: {
  bands: readonly EpilogueBand[];
  onInspect?: (index: number | null) => void;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inspectRef = useRef(onInspect);
  useEffect(() => {
    inspectRef.current = onInspect;
  }, [onInspect]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || bands.length === 0) return;

    const data: uPlot.AlignedData = [
      bands.map((band) => band.age),
      bands.map((band) => band.p10Cents / 100),
      bands.map((band) => band.p90Cents / 100),
      bands.map((band) => band.p50Cents / 100),
      bands.map((band) => band.allCashCents / 100),
    ];

    const plot = new uPlot(
      {
        width: container.clientWidth,
        height,
        padding: [8, 8, 0, 0],
        legend: { show: false },
        scales: { x: { time: false } },
        cursor: {
          x: true,
          y: false,
          points: { show: true, size: 8 },
          drag: { x: true, y: false, uni: 20 },
        },
        plugins: [touchGestures()],
        // Fill between the 10th and 90th percentile.
        bands: [{ series: [1, 2], fill: 'currentColor', dir: 1 }],
        axes: [
          {
            stroke: 'currentColor',
            grid: { show: false },
            ticks: { show: false },
            values: (_u, splits) => splits.map((age) => `${age}`),
          },
          {
            stroke: 'currentColor',
            grid: { stroke: 'currentColor', width: 0.4 },
            ticks: { show: false },
            values: (_u, splits) =>
              splits.map((dollars) => formatCents(dollars * 100, { compact: true })),
          },
        ],
        series: [
          {},
          { stroke: 'transparent', width: 0, points: { show: false } },
          { stroke: 'transparent', width: 0, points: { show: false } },
          { stroke: 'currentColor', width: 2, points: { show: false } },
          { stroke: 'currentColor', width: 1, dash: [4, 4], points: { show: false } },
        ],
        hooks: {
          setCursor: [(u) => inspectRef.current?.(u.cursor.idx ?? null)],
        },
      },
      data,
      container,
    );

    const resize = new ResizeObserver(() =>
      plot.setSize({ width: container.clientWidth, height }),
    );
    resize.observe(container);

    return () => {
      resize.disconnect();
      plot.destroy();
    };
  }, [bands, height]);

  if (bands.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
        Nothing left to project.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full overflow-hidden text-muted-foreground opacity-90 [&_.u-over]:touch-none"
    />
  );
}
