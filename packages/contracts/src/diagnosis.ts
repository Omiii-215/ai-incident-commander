import { z } from 'zod';

// Structured diagnosis the model adapter must return (AI_ORCHESTRATION.md §4–5).
// Unknown fields, invalid enums and oversized strings are rejected.

const Ref = z.string().min(1).max(200);
const Text = z.string().min(1).max(1000);

export const ModelDiagnosisOutput = z
  .object({
    summary: Text,
    facts: z.array(z.object({ statement: Text, support: z.array(Ref).min(1).max(10) }).strict()).max(10),
    hypotheses: z
      .array(
        z
          .object({
            id: z.string().regex(/^hypothesis-[0-9]{1,2}$/),
            statement: Text,
            support: z.array(Ref).max(10),
            contradictions: z.array(Ref).max(10),
            strength: z.enum(['tentative', 'moderate', 'strong']),
            nextCheck: Text,
          })
          .strict(),
      )
      .max(5),
    missingEvidence: z.array(Text).max(10),
    proposedChecks: z.array(Text).max(10),
    suggestedActions: z
      .array(
        z
          .object({
            toolId: z.string().min(3).max(120),
            arguments: z.record(z.string().max(64), z.union([z.string().max(200), z.number(), z.boolean()])),
            rationale: Text,
            expectedEffect: Text,
            support: z.array(Ref).min(1).max(10),
          })
          .strict(),
      )
      .max(3),
  })
  .strict();

export type ModelDiagnosisOutput = z.infer<typeof ModelDiagnosisOutput>;
