/**
 * Shared test helpers for integration tests.
 * Builds a Fastify app with MockAdapter and in-memory session store.
 * No real DB, Redis, or external services required.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { createContainer, asValue, asClass, InjectionMode, type AwilixContainer } from 'awilix';
import type { Redis as RedisType } from 'ioredis';
import type { Queue } from 'bullmq';
import {
  AdapterRegistry,
  SessionStore,
  SigningService,
  EventBus,
  TenantRepository,
  createDb,
} from '@ucp-gateway/core';
import { MockAdapter } from '@ucp-gateway/adapters';
import type { WebhookJobData } from '../webhooks/index.js';
import type { Cradle } from '../container/index.js';
import type { Env } from '../config/env.js';
import { errorHandlerPlugin } from '../middleware/error-handler.js';
import { healthRoutes } from '../routes/health.js';
import { discoveryRoutes } from '../routes/discovery.js';
import { productRoutes } from '../routes/products.js';
import { checkoutRoutes } from '../routes/checkout.js';
import { catalogRoutes } from '../routes/catalog.js';
import { cartRoutes } from '../routes/cart.js';
import { MockSessionStore } from './mock-session-store.js';

export const TEST_DOMAIN = 'mock-store.localhost';

export const TEST_ENV: Env = {
  PORT: 0,
  LOG_LEVEL: 'error',
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://ucp:ucp@localhost:5432/ucp',
  REDIS_URL: 'redis://localhost:6379',
  SECRET_KEY: 'test_secret_key_at_least_32_characters_long',
};

/**
 * Build a test app with MockAdapter and in-memory session store.
 * No real Redis or Postgres required.
 */
export async function buildTestApp(): Promise<{
  app: FastifyInstance;
  container: AwilixContainer<Cradle>;
}> {
  const db = createDb({ connectionString: TEST_ENV.DATABASE_URL });
  const adapterRegistry = new AdapterRegistry();
  adapterRegistry.register('mock', new MockAdapter());
  const sessionStore = new MockSessionStore();

  // Create a mock Redis that supports get/set/setex/del/ttl for checkout tests
  const mockRedisStore = new Map<string, string>();
  const mockRedis = {
    get: async (key: string) => mockRedisStore.get(key) ?? null,
    set: async (key: string, value: string) => {
      mockRedisStore.set(key, value);
      return 'OK';
    },
    setex: async (key: string, _ttl: number, value: string) => {
      mockRedisStore.set(key, value);
      return 'OK';
    },
    del: async (key: string) => {
      const had = mockRedisStore.has(key);
      mockRedisStore.delete(key);
      return had ? 1 : 0;
    },
    ttl: async () => 1800,
    quit: async () => 'OK',
  };

  const container = createContainer<Cradle>({
    injectionMode: InjectionMode.CLASSIC,
  });

  const signingService = new SigningService({ keyPrefix: 'test_gw' });
  await signingService.initialize();

  const eventBus = new EventBus();

  const mockWebhookQueue = {
    add: async () => undefined,
    close: async () => undefined,
  } as unknown as Queue<WebhookJobData>;

  container.register({
    env: asValue(TEST_ENV),
    db: asValue(db),
    redis: asValue(mockRedis as unknown as RedisType),
    tenantRepository: asClass(TenantRepository, { injector: () => ({ db }) }),
    adapterRegistry: asValue(adapterRegistry),
    sessionStore: asValue(sessionStore as unknown as SessionStore),
    signingService: asValue(signingService),
    eventBus: asValue(eventBus),
    webhookQueue: asValue(mockWebhookQueue),
  });

  const app = Fastify({ logger: false });
  app.decorate('container', container);
  app.decorate('signingService', signingService);
  await app.register(sensible);
  await app.register(errorHandlerPlugin);

  // Mock tenant resolution — no DB/Redis needed
  app.decorateRequest('tenant', null);
  app.decorateRequest('adapter', null);
  app.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0]!;
    if (url === '/health' || url === '/ready') return;

    const host = request.hostname;
    if (!host || host !== TEST_DOMAIN) {
      void reply.status(404).send({
        messages: [
          {
            type: 'error',
            code: 'unknown_store',
            content: `No store configured for domain: ${host}`,
            severity: 'recoverable',
          },
        ],
      });
      return;
    }

    request.tenant = {
      id: '00000000-0000-0000-0000-000000000001',
      slug: 'mock-store',
      domain: TEST_DOMAIN,
      platform: 'mock',
      adapterConfig: {},
      settings: {},
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    };
    request.adapter = adapterRegistry.get('mock');
  });

  // Agent header validation
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    if (path === '/health' || path === '/ready' || path.startsWith('/.well-known/')) return;
    const agentHeader = request.headers['ucp-agent'];
    if (!agentHeader || typeof agentHeader !== 'string' || agentHeader.trim().length === 0) {
      void reply.status(401).send({
        messages: [
          {
            type: 'error',
            code: 'invalid_agent',
            content: 'Missing or invalid UCP-Agent header',
            severity: 'recoverable',
          },
        ],
      });
      return;
    }

    const versionMatch = /version="([^"]+)"/.exec(agentHeader);
    if (versionMatch?.[1] && versionMatch[1] > '2026-01-23') {
      void reply.status(400).send({
        messages: [
          {
            type: 'error',
            code: 'version_unsupported',
            content: `UCP version ${versionMatch[1]} is not supported`,
            severity: 'recoverable',
          },
        ],
      });
      return;
    }
  });

  // Routes
  await app.register(healthRoutes);
  await app.register(discoveryRoutes);
  await app.register(productRoutes);
  await app.register(catalogRoutes);
  await app.register(cartRoutes);
  await app.register(checkoutRoutes);

  await app.ready();
  return { app, container };
}
