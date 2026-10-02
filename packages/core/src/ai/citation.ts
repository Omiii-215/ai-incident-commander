import { ACTION_TOOLS, isActionTool } from '../connectors/catalog.js';
import type { ModelDiagnosisOutput } from '@aic/contracts';

// Deterministic citation validator (AI_ORCHESTRATION.md §4). It resolves every
// reference against the authorized evidence set for this run. It checks that
// references exist and are permitted; it cannot prove entailment.

export type CitationCheck = { valid: boolean; unresolved: string[]; problems: string[] };

export function validateCitations(
  output: ModelDiagnosisOutput,
  authorized: Map<string, { suspectedInjection: boolean; expired: boolean }>,
): CitationCheck {
  const unresolved = new Set<string>();
  const problems: string[] = [];
  const check = (ref: string) => {
    const e = authorized.get(ref);
    if (!e || e.expired) unresolved.add(ref);
  };
  output.facts.forEach((f) => f.support.forEach(check));
  output.hypotheses.forEach((h) => [...h.support, ...h.contradictions].forEach(check));
  output.suggestedActions.forEach((a) => {
    a.support.forEach(check);
    if (!isActionTool(a.toolId)) problems.push(`Suggested tool ${a.toolId} is not an allowlisted tool.`);
    else if (!ACTION_TOOLS[a.toolId].args.safeParse(a.arguments).success) problems.push(`Suggested arguments for ${a.toolId} are invalid.`);
    // Suspected-injection sources cannot justify an action.
    if (a.support.some((r) => authorized.get(r)?.suspectedInjection)) {
      problems.push('A suggested action cites a source flagged for instruction-like content.');
    }
  });
  if (unresolved.size) problems.push(`Unresolved references: ${[...unresolved].join(', ')}`);
  return { valid: problems.length === 0, unresolved: [...unresolved], problems };
}
