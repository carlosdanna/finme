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
