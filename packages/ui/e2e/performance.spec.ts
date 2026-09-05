import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';

const require = createRequire(import.meta.url);
/**
 * uPlot's IIFE build, injected from disk rather than imported.
 *
 * The production bundle inlines uPlot, so there is no URL to import in a
 * preview server. Injecting the same library the app ships measures the same
 * rendering path with the same config, without adding a test-only asset to the
 * app bundle or a test hook to production code.
 *
 * The caveat is honest: this measures uPlot drawing the app's series with the
 * app's options, not `<NetWorthChart>` mounted end to end.
 */
const UPLOT_PATH = require.resolve('uplot/dist/uPlot.iife.min.js');

/** The global the IIFE build defines, typed for use inside `page.evaluate`. */
declare const uPlot: typeof import('uplot');

/**
 * The performance pass — BUILD-PLAN prompt 18.
 *
 * A 1,560-point net worth series has to draw and pan on a mid-range Android,
 * which is why the chart is uPlot on canvas rather than an SVG library. This
 * runs under 4x CPU throttling so a fast development machine cannot flatter it.
 */
const CPU_THROTTLE = 4;
const SERIES_WEEKS = 1_560;

test.describe('the dashboard chart under CPU throttling', () => {
  test('renders a full 30-year series in under 100ms', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CPU throttling needs CDP');

    await page.goto('/');
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

    // Draw the full series directly, rather than playing 1,560 weeks first.
    await page.addScriptTag({ path: UPLOT_PATH });

    const drawMs = await page.evaluate((weeks) => {
      // `uPlot` is the global the IIFE build defines, and its own types
      // declare it, so no cast is needed.
      const host = document.createElement('div');
      host.style.width = '390px';
      document.body.append(host);

      const xs = Array.from({ length: weeks }, (_, i) => i);
      // A plausible net-worth shape: compounding with weekly noise.
      let value = 2_000;
      const ys = xs.map((i) => {
        value = value * 1.0012 + Math.sin(i / 9) * 40;
        return value;
      });

      const started = performance.now();
      const plot = new uPlot(
        {
          width: 390,
          height: 180,
          legend: { show: false },
          scales: { x: { time: false } },
          series: [{}, { stroke: 'black', width: 2, points: { show: false } }],
        },
        [xs, ys] as never,
        host,
      );
      const elapsed = performance.now() - started;
      plot.destroy();
      host.remove();
      return elapsed;
    }, SERIES_WEEKS);

    console.log(`chart render at ${CPU_THROTTLE}x throttle: ${drawMs.toFixed(1)}ms`);
    expect(drawMs).toBeLessThan(100);

    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  });

  test('re-draws a pan frame inside a 60fps budget', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'CPU throttling needs CDP');

    await page.goto('/');
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });

    // A pan is a sequence of `setScale` calls, one per touchmove. 60fps means
    // each has to finish inside 16.7ms — that is the number that decides
    // whether dragging the chart feels smooth or sticky.
    await page.addScriptTag({ path: UPLOT_PATH });

    const frames = await page.evaluate(async (weeks) => {
      // `uPlot` is the global the IIFE build defines, and its own types
      // declare it, so no cast is needed.
      const host = document.createElement('div');
      host.style.width = '390px';
      document.body.append(host);

      const xs = Array.from({ length: weeks }, (_, i) => i);
      let value = 2_000;
      const ys = xs.map((i) => {
        value = value * 1.0012 + Math.sin(i / 9) * 40;
        return value;
      });

      const plot = new uPlot(
        {
          width: 390,
          height: 180,
          legend: { show: false },
          scales: { x: { time: false } },
          series: [{}, { stroke: 'black', width: 2, points: { show: false } }],
        },
        [xs, ys] as never,
        host,
      );

      // Measured across real animation frames, not around the `setScale` call.
      // uPlot batches its redraw, so timing the call synchronously reports ~0ms
      // and proves nothing — the cost lands in the frame that follows.
      const timings: number[] = [];
      await new Promise<void>((resolve) => {
        let frame = 0;
        let last = performance.now();
        const step = (): void => {
          const now = performance.now();
          if (frame > 0) timings.push(now - last);
          last = now;

          if (frame >= 30) {
            resolve();
            return;
          }
          // A drag across a 300-week window, ten weeks per frame.
          plot.setScale('x', { min: frame * 10, max: frame * 10 + 300 });
          frame++;
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });

      plot.destroy();
      host.remove();
      return timings;
    }, SERIES_WEEKS);

    const sorted = [...frames].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const worst = sorted[sorted.length - 1];

    console.log(
      `pan frames at ${CPU_THROTTLE}x throttle: median ${median.toFixed(1)}ms, worst ${worst.toFixed(1)}ms`,
    );

    /*
     * Frame-to-frame time is bounded below by vsync, so a chart that keeps up
     * measures ~16.7ms however fast it actually is — asserting `< 16.7` would
     * sit exactly on that floor and flake. What matters is whether frames are
     * being *dropped*: a redraw that overruns its budget shows up as 33ms (two
     * intervals) or worse. 25ms sits between the two and cannot be reached
     * without missing a frame.
     */
    const DROPPED_FRAME_MS = 25;
    expect(frames.length).toBeGreaterThan(20);
    expect(median, 'the chart is dropping frames during a pan').toBeLessThan(DROPPED_FRAME_MS);
    // And it is genuinely rendering, not silently doing nothing.
    expect(median).toBeGreaterThan(1);

    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  });
});
