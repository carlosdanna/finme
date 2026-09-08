import { describe, expect, it } from 'vitest';
import {
  ALLOWED_FORMULA_FUNCTIONS,
  CHAINS,
  chainCards,
  chainDefById,
  chainsFileSchema,
  collectFormulas,
  referencedChainLogbookKeys,
} from '../src/index.ts';
import { evaluateFormula } from '../src/events.ts';
import { LOGBOOK_TEMPLATES } from '../src/logbook.ts';

/**
 * Must mirror `chainFormulaContext` in the engine. A name missing here fails
 * the lint as unknown even though it is real, which is the point: the two lists
 * are meant to be kept in step.
 */
const chainContext = {
  vars: {
    cpi: 1.0,
    monthlyIncome: 400_000,
    carScrapValue: 192_000,
    performanceNorm: 0.6,
    roll: 0.5,
    cashCents: 500_000,
    mood: 60,
    energy: 70,
    inflationThisYear: 0.031,
    lastRaisePct: 0.018,
    applicationOdds: 0.5,
    creditScore: 700,
    weeksSearching: 6,
    targetTier: 2,
    targetIsBuy: 0,
    targetRentCents: 160_000,
    currentRentCents: 110_000,
    targetOpen: 1,
    homePriceCents: 30_720_000,
    downPaymentCents: 6_144_000,
    targetMonthlyIncomeCents: 350_000,
  },
  price: (assetId: string) => ({ SAFE: 12_345, CRYP: 640, MOON: 8_000 })[assetId] ?? Number.NaN,
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('the MVP chain batch', () => {
  it('validates against the schema at load', () => {
    expect(CHAINS).toHaveLength(2);
    expect(chainDefById('JOB_SEARCH')).toBeDefined();
    expect(chainDefById('HOME_SEARCH')).toBeDefined();
  });

  it('draws job-application rolls from the stream §2.2 reserves for them', () => {
    // The stream table names `jobApplication` for application success rolls.
    // A search that rolled on `chain` would leave that entry meaning nothing.
    expect(chainDefById('JOB_SEARCH')!.stream).toBe('jobApplication');
    expect(chainDefById('HOME_SEARCH')!.stream).toBe('chain');
  });

  it('spans several weeks — a search is never one card', () => {
    for (const chain of CHAINS) {
      // Every step lands at least a week after the one before it, so no chain
      // can resolve inside a single tick however the player answers.
      for (const step of chain.steps) expect(step.gapWeeks).toBeGreaterThanOrEqual(1);
      const shortest = chain.steps.reduce((sum, step) => Math.min(sum, step.gapWeeks), 99);
      expect(shortest).toBeGreaterThan(0);
    }
  });

  it('parses every formula in the chain cards against the whitelist', () => {
    const formulas = collectFormulas(chainCards());
    expect(formulas.length).toBeGreaterThan(10);
    for (const { eventId, source } of formulas) {
      expect(() => evaluateFormula(source, chainContext), `${eventId}: ${source}`).not.toThrow();
    }
  });

  it('references only whitelisted functions', () => {
    for (const { eventId, source } of collectFormulas(chainCards())) {
      for (const [, name] of source.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
        expect(ALLOWED_FORMULA_FUNCTIONS, `${eventId} calls ${name}()`).toContain(name);
      }
    }
  });

  it('never signals which choice is correct', () => {
    // GDD §1, and it matters more here: a chain is a sequence, so a nudge at
    // one step steers every step after it.
    const judging = /\b(best|worst|smart|dumb|wise|foolish|correct|wrong|recommended|should)\b/i;
    for (const card of chainCards()) {
      for (const choice of card.choices) {
        expect(choice.label, `${card.id}/${choice.id}`).not.toMatch(judging);
      }
    }
  });

  it('has prose for every logbook key it references', () => {
    const keys = referencedChainLogbookKeys();
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      expect(LOGBOOK_TEMPLATES[key], `no prose for ${key}`).toBeDefined();
    }
  });

  it('keeps every card id in the event namespace and distinct', () => {
    const ids = chainCards().map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Z]{3}_[A-Z0-9_]+$/);
  });
});

describe('the chain lint', () => {
  const valid = () => clone({ chains: [chainDefById('JOB_SEARCH')!] } as never) as {
    chains: {
      steps: { id: string; card: { id: string; choices: { effects: unknown[] }[] } }[];
      firstStepId: string;
      id: string;
    }[];
  };

  it('accepts the shipped content', () => {
    expect(() => chainsFileSchema.parse(valid())).not.toThrow();
  });

  it('rejects a goto that names no step', () => {
    const file = valid();
    file.chains[0].steps[0].card.choices[0].effects = [{ k: 'chain', goto: 'nowhere' }];
    expect(() => chainsFileSchema.parse(file)).toThrow(/routes to 'nowhere'/);
  });

  it('rejects a choice that routes nowhere at all', () => {
    // A choice with no chain effect ends the search silently. That is almost
    // always an authoring slip, so it has to be said out loud with "end".
    const file = valid();
    file.chains[0].steps[0].card.choices[0].effects = [{ k: 'mood', delta: -1 }];
    expect(() => chainsFileSchema.parse(file)).toThrow(/declares no chain effect/);
  });

  it('rejects a first step that is not a step', () => {
    const file = valid();
    file.chains[0].firstStepId = 'missing';
    expect(() => chainsFileSchema.parse(file)).toThrow(/is not a step/);
  });

  it('rejects an unreachable step', () => {
    const file = valid();
    // Point everything that led to `gone` somewhere else, stranding it.
    for (const step of file.chains[0].steps) {
      for (const choice of step.card.choices as { effects: unknown[]; outcomeRoll?: { branches: { effects: unknown[] }[] } }[]) {
        const redirect = (effects: unknown[]): unknown[] =>
          effects.map((e) =>
            (e as { k: string; goto?: string }).k === 'chain' &&
            (e as { goto: string }).goto === 'gone'
              ? { k: 'chain', goto: 'end' }
              : e,
          );
        choice.effects = redirect(choice.effects);
        for (const branch of choice.outcomeRoll?.branches ?? []) {
          branch.effects = redirect(branch.effects);
        }
      }
    }
    expect(() => chainsFileSchema.parse(file)).toThrow(/is unreachable/);
  });

  it('rejects a chain no path can finish', () => {
    // The failure this exists to catch: a search the player can never stop
    // having.
    const file = valid();
    for (const step of file.chains[0].steps) {
      for (const choice of step.card.choices as { effects: unknown[]; outcomeRoll?: { branches: { effects: unknown[] }[] } }[]) {
        const loop = (effects: unknown[]): unknown[] =>
          effects.map((e) =>
            (e as { k: string }).k === 'chain' ? { k: 'chain', goto: file.chains[0].steps[0].id } : e,
          );
        choice.effects = loop(choice.effects);
        for (const branch of choice.outcomeRoll?.branches ?? []) branch.effects = loop(branch.effects);
      }
    }
    expect(() => chainsFileSchema.parse(file)).toThrow(/no reachable path finishes/);
  });

  it('rejects a duplicate chain id', () => {
    const file = valid();
    expect(() =>
      chainsFileSchema.parse({ chains: [file.chains[0], clone(file.chains[0])] }),
    ).toThrow(/duplicate chain id/);
  });

  it('rejects two steps sharing a card id', () => {
    const file = valid();
    file.chains[0].steps[1].card.id = file.chains[0].steps[0].card.id;
    expect(() => chainsFileSchema.parse(file)).toThrow(/share the card id/);
  });
});
