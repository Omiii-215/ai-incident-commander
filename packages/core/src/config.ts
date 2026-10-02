import { z } from 'zod';

// Startup configuration (DEPLOYMENT.md §4). Partial or unsafe production
// configuration fails fast; nothing silently falls back to fixture auth.

const Schema = z
  .object({
    APP_ENV: z.enum(['local', 'ci', 'staging', 'production']).default('local'),
    AUTH_MODE: z.enum(['dev', 'oidc']).default('dev'),
    PUBLIC_APP_ORIGIN: z.url().default('http://localhost:3000'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27018/aic?replicaSet=rs0'),
    REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),
    CURSOR_SIGNING_KEY: z.string().min(16),
    OBJECT_STORAGE_DIR: z.string().default('.data/objects'),
    MODEL_PROVIDER_PROFILE: z.string().default('fake-deterministic-v1'),
    ACTIONS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    WORKER_ROLE: z.enum(['all', 'dispatcher', 'investigator', 'executor']).default('all'),
  })
  .superRefine((c, ctx) => {
    const hosted = c.APP_ENV === 'staging' || c.APP_ENV === 'production';
    if (hosted && c.AUTH_MODE === 'dev') {
      ctx.addIssue({ code: 'custom', path: ['AUTH_MODE'], message: 'Test authentication is forbidden outside local/ci.' });
    }
    if (hosted && !c.PUBLIC_APP_ORIGIN.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['PUBLIC_APP_ORIGIN'], message: 'Hosted environments require an HTTPS origin.' });
    }
    if (hosted && /change-me|dev-/.test(c.CURSOR_SIGNING_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['CURSOR_SIGNING_KEY'], message: 'Development signing key is not allowed in hosted environments.' });
    }
    if (c.AUTH_MODE === 'oidc') {
      ctx.addIssue({ code: 'custom', path: ['AUTH_MODE'], message: 'OIDC adapter is not implemented in this milestone; configure an identity provider first.' });
    }
  });

export type AppConfig = z.infer<typeof Schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = Schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${lines}`);
  }
  return parsed.data;
}
