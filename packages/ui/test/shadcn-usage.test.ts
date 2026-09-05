import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/**
 * The repo vendors a full shadcn component set. The panels should compose it
 * rather than re-implementing cards, list rows and empty states as bare `div`s
 * — which is exactly what the first pass at this UI did.
 *
 * These assertions are deliberately coarse: they catch a wholesale return to
 * hand-rolled markup, not every individual `div`.
 */
function workspaceRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('could not find the workspace root');
}

const ROOT = workspaceRoot();
const UI_SRC = join(ROOT, 'packages/ui/src');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // The vendored set is third-party; only our own code is in scope.
      if (entry !== 'ui') sourceFiles(full, found);
    } else if (/\.tsx$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

const files = sourceFiles(UI_SRC).map((file) => ({
  path: relative(ROOT, file),
  source: readFileSync(file, 'utf8'),
}));

const panels = files.filter((file) => file.path.includes('/panels/'));

describe('the panels compose the vendored shadcn set', () => {
  it('finds the panels it is meant to be checking', () => {
    // Guards the guard: a broken walk would make everything below vacuous.
    expect(panels.length).toBeGreaterThanOrEqual(7);
    expect(panels.some((file) => file.path.endsWith('DebtsPanel.tsx'))).toBe(true);
  });

  it('imports from @/components/ui in every panel', () => {
    const offenders = panels
      .filter((file) => !file.source.includes("from '@/components/ui/"))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('builds the shared primitives on the vendored set, not on bare markup', () => {
    // Panels compose the set both directly and through these. Counting a
    // panel's direct imports would punish that factoring — `DashboardPanel`
    // uses `Stat` and `Meter`, which is the right way round.
    const built: Readonly<Record<string, string>> = {
      'Stat.tsx': 'item',
      'Meter.tsx': 'progress',
      'Nothing.tsx': 'empty',
      'TabBar.tsx': 'tabs',
      'Term.tsx': 'popover',
    };

    for (const [name, expected] of Object.entries(built)) {
      const file = files.find((candidate) => candidate.path.endsWith(`/finme/${name}`));
      expect(file, `${name} is missing`).toBeDefined();
      expect(file!.source, `${name} should be built on ${expected}`).toContain(
        `@/components/ui/${expected}`,
      );
    }
  });

  it('does not re-implement a bordered card as a bare div', () => {
    // `rounded-lg border p-4` on a div is the shape Card already provides.
    const offenders = files
      .filter((file) => /className="[^"]*\brounded-lg border\b/.test(file.source))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});

/**
 * The stylesheet the whole component set depends on.
 *
 * This regressed once and nothing caught it: `index.css` was rewritten and the
 * design tokens were dropped, so every shadcn class resolved to nothing. The
 * build succeeded, the type check passed, and all 466 tests stayed green while
 * the app rendered as unstyled markup — the failure is invisible to everything
 * except looking at it.
 */
describe('the shadcn design tokens', () => {
  const css = readFileSync(join(UI_SRC, 'index.css'), 'utf8');

  it('imports the shadcn stylesheet and Tailwind', () => {
    expect(css).toContain('@import "tailwindcss"');
    expect(css).toContain('@import "shadcn/tailwind.css"');
  });

  it('declares every token the vendored components resolve against', () => {
    // Each of these backs at least one utility class used across the panels.
    const required = [
      'background', 'foreground',
      'card', 'card-foreground',
      'popover', 'popover-foreground',
      'primary', 'primary-foreground',
      'secondary', 'secondary-foreground',
      'muted', 'muted-foreground',
      'accent', 'accent-foreground',
      'destructive', 'border', 'input', 'ring', 'radius',
    ];
    const missing = required.filter((token) => !new RegExp(`--${token}:`).test(css));
    expect(missing).toEqual([]);
  });

  it('binds the tokens to Tailwind colour keys', () => {
    // Without `@theme inline`, the variables exist and `bg-background` still
    // resolves to nothing.
    expect(css).toContain('@theme inline');
    for (const key of ['--color-background', '--color-muted-foreground', '--color-border']) {
      expect(css, `${key} binding is missing`).toContain(key);
    }
  });

  it('carries a dark theme', () => {
    expect(css).toContain('.dark');
    const dark = css.slice(css.indexOf('.dark'));
    expect(dark).toContain('--background:');
    expect(dark).toContain('--foreground:');
  });

  it('applies the base layer to body', () => {
    expect(css).toMatch(/@layer base/);
    expect(css).toMatch(/bg-background text-foreground/);
  });
});

describe('the vendored set is used without its judging variants', () => {
  it('never applies a destructive variant in our own code', () => {
    // GDD §1: `destructive` is reserved for destructive *user actions* — delete
    // a save, confirm bankruptcy. No figure, badge, alert or row may carry it.
    const offenders = files
      .filter((file) => /variant=["']destructive["']/.test(file.source))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('never hard-codes a red or green utility class', () => {
    const offenders = files
      .filter((file) => /\b(text|bg|border)-(red|green|emerald|rose)-\d/.test(file.source))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('would catch a violation', () => {
    // The patterns above are only worth anything if they match when they should.
    expect(/variant=["']destructive["']/.test('<Alert variant="destructive" />')).toBe(true);
    expect(/\b(text|bg|border)-(red|green|emerald|rose)-\d/.test('className="text-red-500"')).toBe(true);
    expect(/className="[^"]*\brounded-lg border\b/.test('<div className="rounded-lg border p-4">')).toBe(true);
  });
});
