import { describe, expect, it } from 'vitest';
import { stream } from '@finme/engine';
import {
  ADVISOR_NAMES,
  FRIEND_NAMES,
  LOGBOOK_TEMPLATES,
  MIN_VARIANTS_PER_KEY,
  drawRunNames,
  missingTemplateKeys,
  namesFileSchema,
  templatesFileSchema,
} from '../src/logbook.ts';
import { referencedLogbookKeys } from '../src/events.ts';

describe('logbook templates', () => {
  it('has prose for every key the events reference', () => {
    expect(missingTemplateKeys()).toEqual([]);
    for (const key of referencedLogbookKeys()) {
      expect(LOGBOOK_TEMPLATES[key], `missing prose for '${key}'`).toBeDefined();
    }
  });

  it('has at least three variants for every key', () => {
    for (const [key, pool] of Object.entries(LOGBOOK_TEMPLATES)) {
      expect(pool.length, `'${key}' has too few variants`).toBeGreaterThanOrEqual(
        MIN_VARIANTS_PER_KEY,
      );
    }
  });

  it('rejects a key with fewer than three variants', () => {
    expect(() => templatesFileSchema.parse({ templates: { k: ['one', 'two'] } })).toThrow();
  });

  it('rejects duplicate variants within a key', () => {
    expect(() =>
      templatesFileSchema.parse({ templates: { k: ['same', 'same', 'other'] } }),
    ).toThrow(/duplicate variants/);
  });

  it('never approves, advises, or moralizes', () => {
    // GDD §1: the Logbook narrates what happened. It can be wry. It cannot
    // approve, and it never says whether a decision was smart.
    for (const bad of [
      'You should have saved that.',
      'A smart move, all things considered.',
      'Well done — the balance is healthier.',
      'That was a mistake and you know it.',
    ]) {
      expect(() =>
        templatesFileSchema.parse({ templates: { k: [bad, 'neutral one', 'neutral two'] } }),
      ).toThrow();
    }
  });

  it('keeps the shipped copy free of judgement', () => {
    const judging = /\b(should|mistake|wisely|foolish|smart move|well done|good job|congratulations)\b/i;
    for (const [key, pool] of Object.entries(LOGBOOK_TEMPLATES)) {
      for (const text of pool) {
        expect(text, `'${key}': ${text}`).not.toMatch(judging);
      }
    }
  });

  it('only uses template variables the engine provides', () => {
    const known = new Set([
      'amount', 'jobTitle', 'age', 'netWorth', 'cash', 'assetName',
      'pct', 'monthName', 'yearsIn', 'friendName', 'advisorName',
    ]);
    for (const [key, pool] of Object.entries(LOGBOOK_TEMPLATES)) {
      for (const text of pool) {
        for (const [, name] of text.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
          expect(known, `'${key}' uses unknown variable {{${name}}}`).toContain(name);
        }
      }
    }
  });
});

describe('run-scoped names (TDD §11.3)', () => {
  it('draws a stable pair from startingDraw', () => {
    const a = drawRunNames(stream('4F2A9C1B', 'startingDraw'));
    const b = drawRunNames(stream('4F2A9C1B', 'startingDraw'));
    expect(b).toEqual(a);

    expect(FRIEND_NAMES).toContain(a.friendName);
    expect(ADVISOR_NAMES).toContain(a.advisorName);
  });

  it('differs across seeds', () => {
    const names = new Set<string>();
    for (let i = 0; i < 50; i++) names.add(drawRunNames(stream(`S${i}`, 'startingDraw')).friendName);
    expect(names.size).toBeGreaterThan(4);
  });

  it('requires enough names to feel varied', () => {
    expect(() => namesFileSchema.parse({ friendNames: ['A'], advisorNames: ['B'] })).toThrow();
    expect(FRIEND_NAMES.length).toBeGreaterThanOrEqual(8);
  });
});
