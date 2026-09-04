import type { EventDef } from '@finme/engine';
import { useIsMobile } from '@/hooks/use-mobile';
import { Button } from '@/components/ui/button';
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
    <div className="flex flex-col gap-2">
      {available.map((choice) => (
        <Button
          key={choice.id}
          type="button"
          // Identical variant for every option. No default, no emphasis.
          variant="outline"
          onClick={() => onChoose(choice.id)}
          className="h-auto min-h-14 w-full justify-start whitespace-normal px-4 py-3 text-left"
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
  body,
  onChoose,
}: {
  event: EventDef | null;
  choiceIds: readonly string[];
  body: string;
  onChoose: (choiceId: string) => void;
}) {
  const isMobile = useIsMobile();
  const open = event !== null;
  if (event === null) return null;

  const content = (
    <>
      <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{body}</p>
      <Choices event={event} choiceIds={choiceIds} onChoose={onChoose} />
    </>
  );

  // Not dismissible: an event is a decision, and there is no "close without
  // choosing" outcome in the simulation.
  if (isMobile) {
    return (
      <Sheet open={open}>
        <SheetContent
          side="bottom"
          className="max-h-[90dvh] overflow-y-auto"
          style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
        >
          <SheetHeader className="px-0">
            <SheetTitle className="text-left text-lg">{event.title}</SheetTitle>
          </SheetHeader>
          {content}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{event.title}</DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
