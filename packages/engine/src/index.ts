/**
 * Public API surface of the FinMe simulation engine.
 *
 * Pure TypeScript. No React, no DOM, no browser globals, no `Math.random`,
 * no float dollars. Runs identically in Node and the browser — that is what
 * makes the balance harness in packages/sim possible.
 */
export { RULESET_VERSION } from './version.ts';
export { MemoryStorageAdapter } from './storage.ts';
export type { StorageAdapter } from './storage.ts';
