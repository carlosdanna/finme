import type { EventDef } from '@finme/engine';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
import { Typography } from '@/components/finme/Typography';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';

/**
 * The event modal — full-screen `Sheet` below `md:`, centred `Dialog` above.
 *
 * **Choices must never signal which one is correct** — not in wording, not in
 * order, not in styling (GDD §1). So every button here is the same variant and
 * the same size, and they render in the order the content declares. There is no
 * primary action, because the game does not have an opinion.
 */
function Choices({
  event,
  choiceIds,
  onChoose,
}: {
  event: EventDef;
  choiceIds: readonly string[];
  onChoose: (choiceId: string) => void;
}) {
  const available = event.choices.filter((choice) => choiceIds.includes(choice.id));

  return (
    /*
      A plain list, not a `ButtonGroup`.

      `ButtonGroup` builds a *joined* control: vertical mode strips the bottom
      radius from every child, the top radius from every child after the first,
      forces `rounded-b-4xl!` onto the last, and drops interior top borders. The
      result here was three square-cornered slabs held apart by the gap, the
      first rounded 18px on top and the last 26px on the bottom.

      It is also the wrong shape for this. Joining the choices into one control
      gives them a first and a last, and GDD §1 is explicit that no choice may be
      ranked by position, label or styling. A list of equals is the point.
    */
    <div role="group" data-slot="event-choices" className="flex w-full flex-col gap-2.5">
      {available.map((choice) => (
        <Button
          key={choice.id}
          type="button"
          // Identical variant for every option. No default, no emphasis.
          variant="outline"
          onClick={() => onChoose(choice.id)}
          // `rounded-2xl`, not the variant's default pill: a 26px radius on a
          // full-width 56px row reads as a lozenge rather than a button.
          className="h-auto min-h-14 w-full justify-start rounded-2xl bg-muted px-4 py-3 text-left whitespace-normal"
        >
          {choice.label}
        </Button>
      ))}
    </div>
  );
}

export function EventModal({
  event,
  choiceIds,
  title,
  body,
  onChoose,
}: {
  event: EventDef | null;
  choiceIds: readonly string[];
  /** Interpolated by the caller — titles may carry `{{placeholders}}` too. */
  title: string;
  body: string;
  onChoose: (choiceId: string) => void;
}) {
  const isMobile = useIsMobile();
  const open = event !== null;
  if (event === null) return null;

  const content = (
    <>
      <Typography color="muted" className="mb-5 leading-relaxed text-pretty">
        {body}
      </Typography>
      <Choices event={event} choiceIds={choiceIds} onChoose={onChoose} />
    </>
  );

  // Not dismissible: an event is a decision, and there is no "close without
  // choosing" outcome in the simulation.
  if (isMobile) {
    return (
      <Sheet open={open}>
        {/* A column with one scrolling row: an event with many choices, or a long
            body at a large text size, has to reach its last choice. */}
        <SheetContent
          side="bottom"
          // `SheetContent` renders a close button by default, which contradicted
          // the comment above: there is no "close without choosing" outcome in
          // the simulation, so offering one was a way to get stuck.
          showCloseButton={false}
          className="max-h-[90dvh] gap-0 p-0"
        >
          <SheetHeader className="flex-none pb-0">
            <SheetTitle className="text-left">
              <Typography variant="h3" as="span">
                {title}
              </Typography>
            </SheetTitle>
          </SheetHeader>
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 sm:px-6"
            style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
          >
            {content}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open}>
      {/* Not dismissible, on this branch too. `showCloseButton` was passed on the
          sheet and missed here, so the same event that could not be escaped on a
          phone could be escaped on a desktop. */}
      <DialogContent showCloseButton={false} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[70dvh] overflow-y-auto overscroll-contain">{content}</div>
      </DialogContent>
    </Dialog>
  );
}
