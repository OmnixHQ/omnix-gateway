import { z } from 'zod';

const DEV_SECRET_KEY_DEFAULT = 'dev_secret_key_change_in_production';

const isProduction = process.env['NODE_ENV'] === 'production';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1).default('postgresql://ucp:ucp@localhost:5432/ucp'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  SECRET_KEY: isProduction ? z.string().min(1) : z.string().min(1).default(DEV_SECRET_KEY_DEFAULT),
  UCP_SIGNING_KEY_JWK: isProduction ? z.string().min(1) : z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.flatten().fieldErrors;
    const message = Object.entries(formatted)
      .map(([key, errors]) => `  ${key}: ${(errors ?? []).join(', ')}`)
      .join('\n');

    if (isProduction) {
      throw new Error(
        `FATAL: Missing required environment variables in production:\n${message}\n` +
          'SECRET_KEY must be explicitly set in production — no default is allowed.',
      );
    }

    throw new Error(`Invalid environment variables:\n${message}`);
  }
  return result.data;
}
