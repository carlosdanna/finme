import { describe, expect, it } from 'vitest';
import { MemoryStorageAdapter, RULESET_VERSION } from '../src/index.ts';

describe('scaffold', () => {
  it('exposes a ruleset version', () => {
    expect(RULESET_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('round-trips through a StorageAdapter', async () => {
    const storage = new MemoryStorageAdapter();
    expect(await storage.get('run')).toBeNull();

    await storage.set('run', '{"seed":"4F2A9C1B"}');
    expect(await storage.get('run')).toBe('{"seed":"4F2A9C1B"}');
    expect(await storage.keys()).toEqual(['run']);

    await storage.remove('run');
    expect(await storage.keys()).toEqual([]);
  });
});
