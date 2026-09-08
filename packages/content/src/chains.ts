/**
 * Chain definitions — validated at load, never inlined in TypeScript.
 *
 * A chain step's card is an ordinary `EventDef` and is held to every rule one
 * is: placeholders must resolve, a choice must do something or say it doesn't,
 * ids are stable forever. On top of that this file enforces the rules a state
 * machine needs and an event does not — every `goto` resolves, every step is
 * reachable, every choice routes somewhere, and some path reaches the end.
 *
 * The last of those is the one that matters most: a chain that cannot terminate
 * is a search the player can never stop having.
 */
import { CHAIN_END, type ChainDef, type Effect } from '@finme/engine';
import { z } from 'zod';
import data from '../chains/mvp.json' with { type: 'json' };
import { eventSchema } from './events.ts';

const stepSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9_]+$/, 'step ids are lowercase, digits and underscores'),
  gapWeeks: z.number().int().positive(),
  card: eventSchema,
});

export const chainSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[A-Z][A-Z0-9_]*$/, 'chain ids are UPPER_SNAKE and are stable forever'),
    stream: z.enum(['chain', 'jobApplication']),
    startGates: z.array(z.unknown()),
    startEffects: z.array(z.unknown()),
    firstStepId: z.string().min(1),
    steps: z.array(stepSchema).min(2),
    cooldownWeeks: z.number().int().nonnegative(),
    abandonEffects: z.array(z.unknown()),
    logbookKeyStart: z.string().min(1),
    logbookKeyAbandon: z.string().min(1),
  })
  .superRefine((chain, ctx) => {
    const fail = (message: string): void => {
      ctx.addIssue({ code: 'custom', message: `${chain.id}: ${message}` });
    };

    const ids = new Set<string>();
    for (const step of chain.steps) {
      if (ids.has(step.id)) fail(`duplicate step id '${step.id}'`);
      ids.add(step.id);
    }
    if (!ids.has(chain.firstStepId)) fail(`firstStepId '${chain.firstStepId}' is not a step`);

    // Card ids are event ids and share their namespace, so they must be unique
    // across the whole chain too.
    const cardIds = new Set<string>();
    for (const step of chain.steps) {
      if (cardIds.has(step.card.id)) fail(`two steps share the card id '${step.card.id}'`);
      cardIds.add(step.card.id);
    }

    const edges = new Map<string, string[]>();
    for (const step of chain.steps) {
      const targets: string[] = [];

      for (const choice of step.card.choices) {
        const direct = gotosIn(choice.effects as readonly Effect[]);
        const branches = (choice.outcomeRoll?.branches ?? []).map((branch) =>
          gotosIn(branch.effects as readonly Effect[]),
        );

        // Every choice must say where the chain goes — including `"end"`. A
        // choice that says nothing ends the chain silently, which is exactly
        // the authoring slip the `noop` lint exists to catch elsewhere.
        const routed =
          direct.length > 0 || (branches.length > 0 && branches.every((list) => list.length > 0));
        if (!routed) {
          fail(
            `choice '${choice.id}' on step '${step.id}' declares no chain effect — add one, ` +
              `with "goto": "${CHAIN_END}" if it should finish the search`,
          );
        }

        for (const goto of [...direct, ...branches.flat()]) {
          if (goto !== CHAIN_END && !ids.has(goto)) {
            fail(`step '${step.id}' routes to '${goto}', which is not a step`);
          }
          targets.push(goto);
        }
      }
      edges.set(step.id, targets);
    }

    // Reachability, from the first step forward.
    const seen = new Set<string>([chain.firstStepId]);
    const queue = [chain.firstStepId];
    let reachesEnd = false;
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const target of edges.get(current) ?? []) {
        if (target === CHAIN_END) {
          reachesEnd = true;
          continue;
        }
        if (!seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }

    for (const step of chain.steps) {
      if (!seen.has(step.id)) fail(`step '${step.id}' is unreachable from '${chain.firstStepId}'`);
    }
    if (!reachesEnd) {
      fail('no reachable path finishes — a search the player can never stop having');
    }
  });

function gotosIn(effects: readonly Effect[]): string[] {
  return effects.filter((effect) => effect.k === 'chain').map((effect) => effect.goto);
}

export const chainsFileSchema = z
  .object({ chains: z.array(chainSchema).min(1) })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const chain of file.chains) {
      if (seen.has(chain.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate chain id '${chain.id}'` });
      }
      seen.add(chain.id);
    }
  });

/** Parsed and validated at module load, so a content bug is never a runtime crash. */
export const CHAINS: readonly ChainDef[] = chainsFileSchema.parse(data)
  .chains as unknown as readonly ChainDef[];

export function chainDefById(id: string): ChainDef | undefined {
  return CHAINS.find((chain) => chain.id === id);
}

/** Every logbook key the chain content references, sorted and deduplicated. */
export function referencedChainLogbookKeys(chains: readonly ChainDef[] = CHAINS): string[] {
  const keys = new Set<string>();
  for (const chain of chains) {
    keys.add(chain.logbookKeyStart);
    keys.add(chain.logbookKeyAbandon);
    for (const step of chain.steps) {
      for (const choice of step.card.choices) {
        keys.add(choice.logbookKey);
        for (const branch of choice.outcomeRoll?.branches ?? []) keys.add(branch.logbookKey);
        for (const deferred of choice.deferred ?? []) {
          if (deferred.logbookKey !== undefined) keys.add(deferred.logbookKey);
        }
      }
    }
  }
  return [...keys].sort();
}

/** Every step card, for the formula and placeholder lints the events get. */
export function chainCards(chains: readonly ChainDef[] = CHAINS) {
  return chains.flatMap((chain) => chain.steps.map((step) => step.card));
}
