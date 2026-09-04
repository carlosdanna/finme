import { describe, expect, it } from 'vitest';
import {
  ANTI_REPEAT_DEPTH,
  MAX_ENTRIES_PER_WEEK,
  type PendingEntry,
  QUIET_GAP_MAX,
  QUIET_GAP_MIN,
  TEMPLATE_VARIABLES,
  TRIGGER_PRIORITY,
  type TemplatePools,
  emitEntries,
  emptyVariantMemory,
  isSignificantDelta,
  logbookKeyFor,
  openLogbook,
  quietEntryDue,
  selectPending,
  selectVariant,
  triggerRank,
} from '../src/logbook/index.ts';
import { ASSET_IDS, dividendPaymentCents, generateMarket, isDividendWeek } from '../src/index.ts';
import { settleAnnualTax, weeklyWithholdingCents } from '../src/tax.ts';
import { stream } from '../src/rng.ts';
import { WEEKS_PER_YEAR, isYearBoundary } from '../src/time.ts';

const templates: TemplatePools = {
  quiet: ['q1', 'q2', 'q3'],
  car_repair_paid: ['a', 'b', 'c', 'd'],
  first_invest: ['i1', 'i2', 'i3'],
};

const flavor = () => stream('4F2A9C1B', 'flavor');

describe('trigger priority and the weekly cap (TDD §11.1)', () => {
  it('orders triggers as §11.1 specifies', () => {
    expect([...TRIGGER_PRIORITY]).toEqual([
      'event',
      'threshold',
      'streakBreak',
      'firstTime',
      'delta',
      'quiet',
    ]);
    expect(triggerRank('event')).toBeLessThan(triggerRank('threshold'));
    expect(triggerRank('threshold')).toBeLessThan(triggerRank('streakBreak'));
    expect(triggerRank('streakBreak')).toBeLessThan(triggerRank('firstTime'));
    expect(triggerRank('firstTime')).toBeLessThan(triggerRank('delta'));
    expect(triggerRank('delta')).toBeLessThan(triggerRank('quiet'));
  });

  it('keeps at most two entries a week, highest priority first', () => {
    const pending: PendingEntry[] = [
      { trigger: { k: 'quiet' }, key: 'quiet' },
      { trigger: { k: 'delta', metric: 'netWorth', pctChange: 0.2 }, key: 'd' },
      { trigger: { k: 'event', eventId: 'E', choiceId: 'c' }, key: 'e' },
      { trigger: { k: 'threshold', metric: 'cash', crossed: 0, direction: 'down' }, key: 't' },
    ];
    const kept = selectPending(pending);
    expect(kept).toHaveLength(MAX_ENTRIES_PER_WEEK);
    expect(kept.map((p) => p.trigger.k)).toEqual(['event', 'threshold']);
  });

  it('keeps tick order within a priority band', () => {
    const pending: PendingEntry[] = [
      { trigger: { k: 'event', eventId: 'B', choiceId: 'x' }, key: 'b' },
      { trigger: { k: 'event', eventId: 'A', choiceId: 'x' }, key: 'a' },
    ];
    expect(selectPending(pending).map((p) => p.key)).toEqual(['b', 'a']);
  });

  it('needs a move over 10% to count as a delta', () => {
    expect(isSignificantDelta(0.1)).toBe(false);
    expect(isSignificantDelta(0.11)).toBe(true);
    expect(isSignificantDelta(-0.11)).toBe(true);
  });

  it('derives a key for every trigger kind', () => {
    expect(logbookKeyFor({ k: 'event', eventId: 'EMG_X', choiceId: 'pay' })).toBe('EMG_X.pay');
    expect(logbookKeyFor({ k: 'event', eventId: 'EMG_X', choiceId: 'pay', branch: 'win' })).toBe('EMG_X.pay.win');
    expect(logbookKeyFor({ k: 'firstTime', action: 'invest' })).toBe('first_invest');
    expect(logbookKeyFor({ k: 'threshold', metric: 'cash', crossed: 0, direction: 'down' })).toBe('threshold_cash_down');
    expect(logbookKeyFor({ k: 'delta', metric: 'netWorth', pctChange: -0.3 })).toBe('delta_netWorth_down');
    expect(logbookKeyFor({ k: 'streakBreak', streak: 'saving' })).toBe('streak_saving');
    expect(logbookKeyFor({ k: 'quiet' })).toBe('quiet');
  });
});

describe('variant selection (TDD §11.2)', () => {
  it('avoids repeating any of the last three variants', () => {
    const rng = flavor();
    let memory = emptyVariantMemory();
    const used: number[] = [];

    for (let i = 0; i < 200; i++) {
      const picked = selectVariant('k', 8, rng, memory);
      memory = picked.memory;
      used.push(picked.index);
    }

    // With a pool of 8 and three rerolls, an immediate repeat is very rare.
    let immediateRepeats = 0;
    for (let i = 1; i < used.length; i++) if (used[i] === used[i - 1]) immediateRepeats++;
    expect(immediateRepeats).toBeLessThan(3);
    expect(new Set(used).size).toBe(8); // the whole pool gets used
  });

  it('remembers only the last three per key', () => {
    const rng = flavor();
    let memory = emptyVariantMemory();
    for (let i = 0; i < 10; i++) memory = selectVariant('k', 6, rng, memory).memory;
    expect(memory.k).toHaveLength(ANTI_REPEAT_DEPTH);
  });

  it('keeps separate memory per key', () => {
    const rng = flavor();
    let memory = emptyVariantMemory();
    memory = selectVariant('a', 5, rng, memory).memory;
    memory = selectVariant('b', 5, rng, memory).memory;
    expect(Object.keys(memory).sort()).toEqual(['a', 'b']);
  });

  it('accepts a repeat rather than looping on a tiny pool', () => {
    const rng = flavor();
    let memory = emptyVariantMemory();
    for (let i = 0; i < 50; i++) {
      const picked = selectVariant('k', 1, rng, memory);
      expect(picked.index).toBe(0);
      memory = picked.memory;
    }
  });

  it('returns -1 for an empty pool rather than throwing', () => {
    expect(selectVariant('k', 0, flavor(), emptyVariantMemory()).index).toBe(-1);
  });
});

describe('emission and the quiet cadence (TDD §11.1)', () => {
  it('draws the first quiet gap in 6-10 weeks', () => {
    for (let i = 0; i < 200; i++) {
      const state = openLogbook(stream(`S${i}`, 'flavor'));
      expect(state.quietGap).toBeGreaterThanOrEqual(QUIET_GAP_MIN);
      expect(state.quietGap).toBeLessThanOrEqual(QUIET_GAP_MAX);
      expect(state.weeksSinceEntry).toBe(0);
    }
  });

  it('emits nothing on a week with no triggers, until the gap runs out', () => {
    const rng = flavor();
    let state = openLogbook(rng);
    const gap = state.quietGap;

    for (let week = 0; week < gap; week++) {
      const result = emitEntries([], week, templates, {}, rng, state);
      expect(result.entries).toHaveLength(0);
      state = result.state;
    }
    expect(quietEntryDue(state)).toBe(true);

    const quiet = emitEntries([], gap, templates, {}, rng, state);
    expect(quiet.entries).toHaveLength(1);
    expect(quiet.entries[0].key).toBe('quiet');
    expect(quiet.state.weeksSinceEntry).toBe(0);
  });

  it('resets the silence counter on any entry, quiet or not', () => {
    const rng = flavor();
    let state = openLogbook(rng);
    state = emitEntries([], 0, templates, {}, rng, state).state;
    expect(state.weeksSinceEntry).toBe(1);

    const fired = emitEntries(
      [{ trigger: { k: 'event', eventId: 'E', choiceId: 'c' }, key: 'car_repair_paid' }],
      1,
      templates,
      {},
      rng,
      state,
    );
    expect(fired.entries).toHaveLength(1);
    expect(fired.state.weeksSinceEntry).toBe(0);
  });

  it('interpolates the template variables', () => {
    const rng = flavor();
    const state = openLogbook(rng);
    const result = emitEntries(
      [{ trigger: { k: 'quiet' }, key: 'named' }],
      5,
      { named: ['Hello {{friendName}}, you are {{age}}.', 'B {{friendName}}', 'C {{friendName}}'] },
      { friendName: 'Marguerite', age: '27' },
      rng,
      state,
    );
    expect(result.entries[0].text).toContain('Marguerite');
    expect(result.entries[0].text).not.toContain('{{');
  });

  it('skips a key with no prose rather than ending the run', () => {
    // Content arrives in batches; a key without copy yet must not throw.
    const rng = flavor();
    const state = openLogbook(rng);
    const result = emitEntries(
      [{ trigger: { k: 'event', eventId: 'E', choiceId: 'c' }, key: 'not_written_yet' }],
      5,
      templates,
      {},
      rng,
      state,
    );
    expect(result.entries).toHaveLength(0);
  });

  it('exposes every §11.3 template variable', () => {
    expect([...TEMPLATE_VARIABLES]).toEqual([
      'amount', 'jobTitle', 'age', 'netWorth', 'cash', 'assetName',
      'pct', 'monthName', 'yearsIn', 'friendName', 'advisorName',
    ]);
  });
});

describe('CRITICAL: the flavor stream must never influence simulation state', () => {
  /**
   * A 30-year run of real simulation — market prices, dividends, withholding and
   * annual tax settlement — with the Logbook emitting alongside it.
   *
   * Returns the simulation outputs and, separately, the prose. If the Logbook
   * could reach the simulation, the two would move together.
   */
  function runYears(
    pools: TemplatePools,
    /**
     * Which stream the Logbook draws from. Defaults to `flavor`, as it must.
     * A test below points it at the simulation's own live stream to prove this
     * harness would actually notice the leak it exists to forbid.
     */
    logbookStream: 'flavor' | 'shared' = 'flavor',
  ): {
    simulation: number[];
    entries: { key: string; variantIndex: number; text: string }[];
  } {
    const history = generateMarket('4F2A9C1B', 30);
    // A live in-play stream the simulation consumes as it goes. If the Logbook
    // ever drew from this, its variable draw count would shift every roll after
    // it — which is precisely the failure this suite exists to catch.
    const outcomeRng = stream('4F2A9C1B', 'eventOutcome');
    const flavorRng = logbookStream === 'shared' ? outcomeRng : stream('4F2A9C1B', 'flavor');

    let shares = 0;
    let cashCents = 500_000;
    let withheldCents = 0;
    let dividendsCents = 0;
    const simulation: number[] = [];

    let logbook = openLogbook(flavorRng);
    const entries: { key: string; variantIndex: number; text: string }[] = [];
    const keys = Object.keys(pools).filter((k) => k !== 'quiet');

    for (let week = 1; week < history.weeks; week++) {
      const price = history.series.SAFE.priceCents[week];

      // Weekly pay, withheld on employment income only.
      const weeklyGross = 100_000;
      withheldCents += weeklyWithholdingCents(weeklyGross, history.inflation.cpi[Math.floor(week / WEEKS_PER_YEAR)]);
      cashCents += weeklyGross;

      // Invest whatever is over a floor.
      if (cashCents > 200_000) {
        shares += (cashCents - 200_000) / price;
        cashCents = 200_000;
      }

      if (isDividendWeek(week)) {
        const paid = dividendPaymentCents(history, 'SAFE', shares, week);
        dividendsCents += paid;
        shares += paid / price;
      }

      // A live roll, every 11 weeks, against the eventOutcome stream.
      if (week % 11 === 0) {
        const roll = outcomeRng();
        cashCents += roll > 0.5 ? 25_000 : -15_000;
      }

      if (isYearBoundary(week)) {
        const year = Math.floor(week / WEEKS_PER_YEAR);
        const settlement = settleAnnualTax({
          employmentGrossCents: weeklyGross * WEEKS_PER_YEAR,
          sideHustleGrossCents: 0,
          dividendsCents,
          shortTermGainsCents: 0,
          longTermGainsCents: 0,
          retirementContributionsCents: 0,
          withheldCents,
          cpi: history.inflation.cpi[year],
        });
        cashCents += settlement.settlementCents;
        withheldCents = 0;
        dividendsCents = 0;
        simulation.push(Math.round(shares * price), cashCents, settlement.totalOwedCents);
      }

      // The Logbook runs alongside, driven only by `flavor`.
      const pending: PendingEntry[] =
        week % 37 === 0
          ? [{ trigger: { k: 'event', eventId: 'E', choiceId: 'c' }, key: keys[week % keys.length] }]
          : [];
      const emitted = emitEntries(pending, week, pools, { age: '27' }, flavorRng, logbook);
      logbook = emitted.state;
      for (const entry of emitted.entries) {
        entries.push({ key: entry.key, variantIndex: entry.variantIndex, text: entry.text });
      }
    }

    simulation.push(Math.round(shares * history.series.SAFE.priceCents[history.weeks - 1]), cashCents);
    for (const id of ASSET_IDS) simulation.push(history.series[id].priceCents[history.weeks - 1]);
    return { simulation, entries };
  }

  const base: TemplatePools = {
    quiet: ['q1', 'q2', 'q3'],
    alpha: ['a1', 'a2', 'a3'],
    beta: ['b1', 'b2', 'b3'],
    gamma: ['g1', 'g2', 'g3'],
  };

  it('leaves every simulation value identical when variants are reordered', () => {
    const reordered: TemplatePools = {
      quiet: ['q3', 'q1', 'q2'],
      alpha: ['a3', 'a2', 'a1'],
      beta: ['b2', 'b3', 'b1'],
      gamma: ['g1', 'g3', 'g2'],
    };

    const original = runYears(base);
    const shuffled = runYears(reordered);

    expect(shuffled.simulation).toEqual(original.simulation);
    // And the prose really did change, so the test is not vacuous.
    expect(shuffled.entries.map((e) => e.text)).not.toEqual(original.entries.map((e) => e.text));
  });

  it('leaves every simulation value identical when variants are added', () => {
    const expanded: TemplatePools = {
      quiet: [...base.quiet, 'q4', 'q5', 'q6'],
      alpha: [...base.alpha, 'a4'],
      beta: [...base.beta, 'b4', 'b5'],
      gamma: base.gamma,
    };

    const original = runYears(base);
    const grown = runYears(expanded);

    expect(grown.simulation).toEqual(original.simulation);
    expect(grown.entries.map((e) => e.text)).not.toEqual(original.entries.map((e) => e.text));
  });

  it('leaves every simulation value identical when a whole key is removed', () => {
    const { quiet, alpha, beta } = base;
    const trimmed: TemplatePools = { quiet, alpha, beta };

    const original = runYears(base);
    const reduced = runYears(trimmed);

    expect(reduced.simulation).toEqual(original.simulation);

    // The prose changed: 'gamma' is gone entirely, and the silences it left
    // behind pull in extra quiet entries instead.
    expect(original.entries.some((e) => e.key === 'gamma')).toBe(true);
    expect(reduced.entries.some((e) => e.key === 'gamma')).toBe(false);
    expect(reduced.entries.map((e) => e.text)).not.toEqual(original.entries.map((e) => e.text));
    expect(reduced.entries.filter((e) => e.key === 'quiet').length).toBeGreaterThan(
      original.entries.filter((e) => e.key === 'quiet').length,
    );
  });

  it('would notice a leak: sharing a live stream does change the simulation', () => {
    // Guards the guard. If pointing the Logbook at the simulation's own stream
    // did NOT change the outputs, the three tests above would prove nothing.
    const isolated = runYears(base, 'flavor');
    const leaking = runYears(base, 'shared');
    expect(leaking.simulation).not.toEqual(isolated.simulation);
  });

  it('is reproducible for a fixed seed', () => {
    const a = runYears(base);
    const b = runYears(base);
    expect(b.simulation).toEqual(a.simulation);
    expect(b.entries).toEqual(a.entries);
  });
});
