import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/**
 * The architectural guarantee from BUILD-PLAN Part 2b:
 *
 * > **No file outside the adapter may reference `indexedDB`, `localStorage`, or
 * > `window`.**
 *
 * This is what makes a future `CapacitorStorageAdapter` or `NativeStorageAdapter`
 * a drop-in with no change to the persistence logic in TDD §14. It is asserted
 * over the source tree rather than trusted, because the failure is silent: a
 * `localStorage` call anywhere else keeps working in a browser and quietly makes
 * the native port expensive.
 */
/** Walk up to the workspace root. Vite rewrites import.meta.url to /@fs/... */
function workspaceRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('could not find the workspace root');
}

const ROOT = workspaceRoot();

/** The one file allowed to touch a real store. */
const ADAPTER = 'packages/ui/src/storage/WebStorageAdapter.ts';

/** Vendored shadcn components are third-party code, not ours to rewrite. */
const VENDORED = 'packages/ui/src/components/ui/';

/**
 * Strip comments before scanning.
 *
 * Several files *describe* this rule in their own doc comments — the engine's
 * `storage.ts` explains why the interface exists at all. A mention in prose is
 * not a reference; only code counts.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const BANNED = [
  { name: 'indexedDB', pattern: /\bindexedDB\b/ },
  { name: 'localStorage', pattern: /\blocalStorage\b/ },
  { name: 'sessionStorage', pattern: /\bsessionStorage\b/ },
];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

describe('storage isolation (BUILD-PLAN Part 2b)', () => {
  const files = sourceFiles(join(ROOT, 'packages')).map((file) => ({
    path: relative(ROOT, file),
    source: stripComments(readFileSync(file, 'utf8')),
  }));

  it('finds the source tree it is meant to be checking', () => {
    // Guards the guard: a broken glob would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((file) => file.path === ADAPTER)).toBe(true);
  });

  it('references a real store only inside the adapter', () => {
    const offenders: string[] = [];

    for (const file of files) {
      if (file.path === ADAPTER || file.path.includes(VENDORED)) continue;
      if (file.path.endsWith('storage-isolation.test.ts')) continue;

      for (const banned of BANNED) {
        if (banned.pattern.test(file.source)) {
          offenders.push(`${file.path} references ${banned.name}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('keeps `window` out of the engine, sim and content packages entirely', () => {
    // The UI legitimately runs in a browser; the headless packages must not.
    const offenders = files
      .filter((file) => /^packages\/(engine|sim|content)\//.test(file.path))
      .filter((file) => /\bwindow\b/.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it('routes the adapter through the engine interface, not a concrete type', () => {
    const adapter = files.find((file) => file.path === ADAPTER)!;
    expect(adapter.source).toContain("import type { StorageAdapter } from '@finme/engine'");
  });

  it('would catch a real violation', () => {
    // Guards the guard again: the scan must survive comment stripping and still
    // see code. A stripper that ate everything would make this suite silent.
    const probe = stripComments(`
      /** A comment mentioning localStorage and indexedDB. */
      // Another one about window.
      const a = 1;
    `);
    expect(probe).not.toMatch(/localStorage|indexedDB/);
    expect(probe).toContain('const a = 1');

    const real = stripComments('const value = localStorage.getItem("k");');
    expect(real).toMatch(/localStorage/);
  });
});
