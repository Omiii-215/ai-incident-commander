// Defense-in-depth redaction before storage, model requests and display
// (SECURITY_AND_PERMISSIONS.md §7). Markers stay visible so readers can see
// where content was removed.

const PATTERNS: Array<{ type: string; re: RegExp }> = [
  { type: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { type: 'aws-access-key', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { type: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { type: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { type: 'api-key', re: /\b(sk|pk|rk)[-_](live|test|proj|ant)?[-_]?[A-Za-z0-9]{16,}\b/g },
  { type: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { type: 'bearer', re: /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi },
  {
    type: 'secret-assignment',
    re: /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
  },
  { type: 'connection-string', re: /\b(mongodb(\+srv)?|postgres(ql)?|mysql|redis|amqp):\/\/[^\s:@/]+:[^\s@/]+@/gi },
  { type: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
];

export type RedactionResult = { text: string; count: number; truncated: boolean };

export function redact(input: string, extra: RegExp[] = [], maxBytes = 64 * 1024): RedactionResult {
  let text = input;
  let count = 0;
  for (const { type, re } of [...PATTERNS, ...extra.map((re) => ({ type: 'custom', re }))]) {
    text = text.replace(re, () => {
      count++;
      return `[REDACTED:${type}]`;
    });
  }
  let truncated = false;
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    text = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8') + '\n[TRUNCATED]';
    truncated = true;
  }
  return { text, count, truncated };
}

// Prompt-injection classification is a signal, not a control (SECURITY §7).
const INJECTION_SIGNALS = [
  /ignore (all |any )?(previous|prior|above) (instructions|directions)/i,
  /disregard (the )?(system|previous) (prompt|instructions)/i,
  /you are now (an?|the) /i,
  /(reveal|print|export|send) (the |all )?(secrets?|credentials|api keys?|tokens?)/i,
  /(approve|execute|run) (this|the) action (immediately|now|without)/i,
  /(disable|bypass|skip) (the )?(approval|policy|safety)/i,
  /change (the )?workspace/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION_SIGNALS.some((re) => re.test(text));
}
