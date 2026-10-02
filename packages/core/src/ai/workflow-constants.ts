// Versioned workflow identity recorded on every run and diagnosis.
export const WORKFLOW_VERSION = 'investigate-v1';
export const PROMPT_VERSION = 'diagnosis-prompt-v1';

// Initial defaults (AI_ORCHESTRATION.md §2). Validate before relying on them.
export const LIMITS = {
  deadlineMs: 90_000,
  maxNodeTransitions: 12,
  maxModelCalls: 2,
  maxToolCalls: 6,
  maxConcurrentToolCalls: 3,
  maxChunks: 8,
  maxChunksPerDocument: 2,
  maxInputTokens: 24_000,
  maxOutputTokens: 4_000,
  providerTimeoutMs: 30_000,
} as const;
