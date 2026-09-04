/**
 * Glossary — GDD §7.
 *
 * Every financial term the UI shows routes through the `<Term>` component,
 * which reads these. Definitions explain; they never advise, and they never
 * tell the player what they should have done.
 */
import { z } from 'zod';
import data from '../glossary.json' with { type: 'json' };

export const glossaryTermSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  definition: z
    .string()
    .min(20)
    .refine(
      (text) => !/\b(you should|make sure to|always|never invest|best to|avoid|recommended)\b/i.test(text),
      'the glossary explains; it does not advise (GDD §1)',
    ),
});

export const glossaryFileSchema = z
  .object({ terms: z.array(glossaryTermSchema).min(1) })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    for (const term of file.terms) {
      if (seen.has(term.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate glossary id '${term.id}'` });
      }
      seen.add(term.id);
    }
  });

export interface GlossaryTerm {
  readonly id: string;
  readonly label: string;
  readonly definition: string;
}

export const GLOSSARY: readonly GlossaryTerm[] = glossaryFileSchema.parse(data).terms;

const byId = new Map(GLOSSARY.map((term) => [term.id, term]));

export function glossaryTerm(id: string): GlossaryTerm | undefined {
  return byId.get(id);
}
