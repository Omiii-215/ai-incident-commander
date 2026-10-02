// Provider abstraction (AI_ORCHESTRATION.md §6). The MVP ships the interface
// and a deterministic fake provider. Real OpenAI/Anthropic adapters must pass
// the same contract tests before being enabled; model IDs are deployment config.

export type DiagnosisEvidence = {
  id: string;
  sourceType: string;
  title: string;
  excerpt: string;
  collectedAt: string;
  observedFrom: string | null;
  observedTo: string | null;
  sourceVersion: string | null;
  suspectedInjection: boolean;
};

export type DiagnosisInput = {
  instructions: string; // versioned trusted template
  incident: { title: string; severity: string; status: string; serviceName: string; environment: string; openedAt: string };
  evidence: DiagnosisEvidence[]; // untrusted data, separately labelled
  allowedTools: Array<{ toolId: string; arguments: string }>;
  repairHint?: string;
};

export type ProviderUsage = { inputTokens: number; outputTokens: number } | 'unknown';
export type ProviderErrorKind = 'timeout' | 'quota' | 'invalid_schema' | 'refusal' | 'authentication' | 'transient' | 'unavailable';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface ModelProvider {
  readonly profile: string;
  describeCapabilities(): { structuredOutput: boolean; toolCalls: boolean; streaming: boolean; contextTokens: number; region: string };
  estimateBudget(input: DiagnosisInput): { inputTokens: number; outputTokens: number };
  generateDiagnosis(input: DiagnosisInput, signal: AbortSignal): Promise<{ output: unknown; usage: ProviderUsage }>;
  classifyError(error: unknown): ProviderErrorKind;
}

export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

abstract class BaseProvider implements ModelProvider {
  abstract readonly profile: string;
  describeCapabilities() {
    return { structuredOutput: true, toolCalls: false, streaming: false, contextTokens: 32_000, region: 'local' };
  }
  estimateBudget(input: DiagnosisInput) {
    return { inputTokens: estimateTokens(JSON.stringify(input)), outputTokens: 1500 };
  }
  abstract generateDiagnosis(input: DiagnosisInput, signal: AbortSignal): Promise<{ output: unknown; usage: ProviderUsage }>;
  classifyError(error: unknown): ProviderErrorKind {
    if (error instanceof ProviderError) return error.kind;
    if (error instanceof Error && error.name === 'AbortError') return 'timeout';
    return 'transient';
  }
}

/** Used when no provider is configured or AI is disabled: manual workflows continue. */
export class DisabledProvider extends BaseProvider {
  readonly profile = 'disabled';
  async generateDiagnosis(): Promise<never> {
    throw new ProviderError('unavailable', 'AI provider is disabled for this deployment.');
  }
}

export type FakeMode = 'normal' | 'invalid-citation-once' | 'invalid-always' | 'timeout' | 'unavailable';

/**
 * Deterministic fixture model. It reasons only over the evidence it is given,
 * cites evidence IDs, keeps hypotheses separate from facts, and abstains from
 * suggesting an action when deployment evidence is missing.
 */
export class FakeProvider extends BaseProvider {
  readonly profile = 'fake-deterministic-v1';
  private calls = 0;
  constructor(private readonly mode: FakeMode = 'normal') {
    super();
  }

  async generateDiagnosis(input: DiagnosisInput, signal: AbortSignal) {
    this.calls++;
    if (signal.aborted) throw new ProviderError('timeout', 'aborted');
    if (this.mode === 'unavailable') throw new ProviderError('unavailable', 'Fixture provider unavailable.');
    if (this.mode === 'timeout') {
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new ProviderError('timeout', 'Provider timed out.'))));
    }
    const output = this.reason(input);
    const corrupt = this.mode === 'invalid-always' || (this.mode === 'invalid-citation-once' && !input.repairHint);
    if (corrupt && output.hypotheses[0]) output.hypotheses[0].support.push('evidence-invented-by-model');
    return { output, usage: { inputTokens: estimateTokens(JSON.stringify(input)), outputTokens: estimateTokens(JSON.stringify(output)) } };
  }

  private reason(input: DiagnosisInput) {
    const ev = input.evidence;
    const trusted = ev.filter((e) => !e.suspectedInjection);
    const deploy = trusted.find((e) => e.sourceType === 'deployment');
    const logs = trusted.find((e) => e.sourceType === 'log' && /error|exception|5\d\d|timeout/i.test(e.excerpt));
    const metric = trusted.find((e) => e.sourceType === 'metric');
    const alert = trusted.find((e) => e.sourceType === 'alert');
    const runbook = trusted.find((e) => e.sourceType === 'runbook' && /roll ?back/i.test(e.excerpt));
    const injected = ev.filter((e) => e.suspectedInjection);

    const facts: Array<{ statement: string; support: string[] }> = [];
    if (alert) facts.push({ statement: `Alerting reported: ${alert.title}.`, support: [alert.id] });
    const errorRate = metric ? Number(/error_rate=([0-9.]+)/.exec(metric.excerpt)?.[1] ?? NaN) : NaN;
    if (metric && Number.isFinite(errorRate)) {
      facts.push({ statement: `Sampled error rate is ${(errorRate * 100).toFixed(1)}%.`, support: [metric.id] });
    }

    // Latest deployment line: "<iso> <version> commit=... author=..."
    const deployLines = deploy?.excerpt.split('\n').filter((l) => /^\d{4}-/.test(l)) ?? [];
    const latest = deployLines.at(-1)?.split(' ');
    const previous = deployLines.at(-2)?.split(' ');
    const deployedAt = latest?.[0] ? new Date(latest[0]) : null;
    const openedAt = new Date(input.incident.openedAt);
    const recentDeploy = deployedAt && openedAt.getTime() - deployedAt.getTime() < 2 * 60 * 60 * 1000 && openedAt >= deployedAt;

    const hypotheses: Array<{ id: string; statement: string; support: string[]; contradictions: string[]; strength: 'tentative' | 'moderate' | 'strong'; nextCheck: string }> = [];
    const suggestedActions: Array<{ toolId: string; arguments: Record<string, string>; rationale: string; expectedEffect: string; support: string[] }> = [];
    const missingEvidence: string[] = [];

    if (deploy && recentDeploy && latest?.[1]) {
      hypotheses.push({
        id: 'hypothesis-1',
        statement: `Release ${latest[1]} deployed shortly before the incident may have introduced the errors.`,
        support: [deploy.id, ...(logs ? [logs.id] : []), ...(alert ? [alert.id] : [])],
        contradictions: [],
        strength: logs ? 'moderate' : 'tentative',
        nextCheck: `Compare error onset with the ${latest[1]} rollout time and review its change list.`,
      });
      if (previous?.[1]) {
        suggestedActions.push({
          toolId: 'simulator.rollback_deployment',
          arguments: { toVersion: previous[1] },
          rationale: `Errors align with release ${latest[1]}; rolling back to ${previous[1]} tests the hypothesis with a reversible change.`,
          expectedEffect: 'Error rate returns below 1% within five minutes if the release is the cause.',
          support: [deploy.id, ...(runbook ? [runbook.id] : []), ...(logs ? [logs.id] : [])],
        });
      }
    } else {
      missingEvidence.push(deploy ? 'No deployment within two hours before the incident; release correlation is unsupported.' : 'Deployment history was unavailable.');
    }
    if (metric || logs) {
      hypotheses.push({
        id: `hypothesis-${hypotheses.length + 1}`,
        statement: 'A degraded downstream dependency could produce the same error pattern.',
        support: [...(logs ? [logs.id] : []), ...(metric ? [metric.id] : [])],
        contradictions: deploy && recentDeploy ? [deploy.id] : [],
        strength: 'tentative',
        nextCheck: 'Check dependency health and error codes returned by upstream calls.',
      });
    }
    if (!logs) missingEvidence.push('No error log excerpt was available for the incident window.');
    if (!runbook) missingEvidence.push('No published runbook passage covered remediation for this service.');
    missingEvidence.push('Database migration completion record for the latest release.');
    if (injected.length) missingEvidence.push(`${injected.length} source(s) contained instruction-like text and were excluded from justification pending human review.`);

    const summary = hypotheses.length
      ? `${hypotheses[0]!.strength === 'moderate' ? 'Evidence points to' : 'Evidence weakly suggests'}: ${hypotheses[0]!.statement}`
      : 'There is not enough evidence to recommend an action. Review the available logs.';

    return {
      summary,
      facts,
      hypotheses,
      missingEvidence,
      proposedChecks: hypotheses.map((h) => h.nextCheck),
      suggestedActions,
    };
  }
}

export function createProvider(profile: string): ModelProvider {
  switch (profile) {
    case 'fake-deterministic-v1':
      return new FakeProvider('normal');
    case 'disabled':
      return new DisabledProvider();
    default:
      // Unknown profiles fail closed rather than silently falling back to another vendor.
      throw new Error(`Unsupported MODEL_PROVIDER_PROFILE "${profile}". Qualified profiles: fake-deterministic-v1, disabled.`);
  }
}
