import type { ErrorEnvelope } from '@aic/contracts';

// Typed same-origin API client. The browser never holds provider or database
// credentials; the session is an HttpOnly cookie and commands carry CSRF,
// Idempotency-Key and If-Match headers (FRONTEND_ARCHITECTURE.md §7).

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | null,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
  /** True when the server may or may not have applied the command (lost response). */
  get uncertain() {
    return this.status === 0;
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};

export type ApiResult<T> = { data: T; meta: { requestId: string } & Record<string, unknown>; etag: string | null };

async function request<T>(method: string, path: string, init: { body?: unknown; headers?: Record<string, string>; raw?: BodyInit; signal?: AbortSignal } = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json', ...init.headers };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: init.signal ?? null,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'The server could not be reached. The request may or may not have been applied.', null);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const env = json as ErrorEnvelope | null;
    throw new ApiError(
      res.status,
      env?.error?.code ?? 'HTTP_ERROR',
      env?.error?.message ?? `Request failed (${res.status}).`,
      env?.error?.requestId ?? res.headers.get('X-Request-Id'),
      env?.error?.details,
    );
  }
  const body = json as { data: T; meta: ApiResult<T>['meta'] };
  return { data: body.data, meta: body.meta, etag: res.headers.get('ETag') };
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, signal ? { signal } : {}).then((r) => r.data),
  getFull: <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  /**
   * State-changing command. `key` is generated once per user intent and reused
   * for retries of the same exact request; `version` becomes If-Match.
   */
  command: <T>(method: 'POST' | 'PATCH', path: string, opts: { key: string; version?: number; body?: unknown }) =>
    request<T>(method, path, {
      body: opts.body ?? {},
      headers: { 'Idempotency-Key': opts.key, ...(opts.version !== undefined ? { 'If-Match': `"${opts.version}"` } : {}) },
    }).then((r) => r.data),
  put: <T>(path: string, data: Blob, contentType: string) => request<T>('PUT', path, { raw: data, headers: { 'Content-Type': contentType } }).then((r) => r.data),
};

export const newKey = () => crypto.randomUUID();

export const qs = (params: Record<string, string | string[] | number | undefined | null>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};
