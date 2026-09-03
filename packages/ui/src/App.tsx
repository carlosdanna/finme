import { RULESET_VERSION } from '@finme/engine';

/**
 * Placeholder shell. Real screens arrive in prompt 15 of docs/BUILD-PLAN.md —
 * mobile-first, designed at 390x844, bottom tab bar, advance control in the
 * bottom-right thumb zone.
 */
export default function App() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6">
      <h1 className="text-2xl font-semibold">FinMe</h1>
      <p className="text-sm opacity-60">ruleset v{RULESET_VERSION}</p>
    </main>
  );
}
