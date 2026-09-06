import { Typography } from '@/components/finme/Typography';

/**
 * The screen header — name on the left, run clock on the right.
 *
 * A row in the shell's column, not a `sticky` layer. Nothing here overlaps
 * anything, so it needs no stacking context and carries no `z-index`.
 */
export function TopBar({ title, clock }: { title: string; clock: string }) {
  return (
    <header className="flex-none border-b bg-card">
      <div className="mx-auto flex h-14 max-w-2xl items-center justify-between gap-3 px-4">
        <Typography variant="h3" as="h1">
          {title}
        </Typography>
        <Typography variant="caption" color="muted" className="tabular-nums">
          {clock}
        </Typography>
      </div>
    </header>
  );
}
