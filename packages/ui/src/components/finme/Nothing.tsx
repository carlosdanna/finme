import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';

/**
 * An empty state, built on `Empty`.
 *
 * Says what is not there and stops. No illustration, no encouragement, no
 * suggestion of what the player ought to do about it.
 */
export function Nothing({ title, description }: { title: string; description?: string }) {
  return (
    <Empty className="py-10">
      <EmptyHeader>
        <EmptyTitle className="text-sm font-normal text-muted-foreground">{title}</EmptyTitle>
        {description !== undefined && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}
