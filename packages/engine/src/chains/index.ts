/** Chains — multi-week player-initiated processes. TDD §9.6. */
export { CHAIN_END, CHAIN_MAX_STEPS, chainById, stepById } from './schema.ts';
export type { ChainDef, ChainStepDef, ActiveChain, ChainHistory } from './schema.ts';

export {
  startBlockedReason,
  startChain,
  advanceChain,
  dueChain,
  slipChain,
  withChain,
  recordChainEnd,
} from './machine.ts';
export type { ChainBlockedReason } from './machine.ts';
