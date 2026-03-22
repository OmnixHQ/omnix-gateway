/**
 * Shared test helpers for integration tests.
 * Builds a Fastify app with MockAdapter and a mock tenant seeded in-memory.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { type AwilixContainer } from 'awilix';
import { createAppContainer, type Cradle } from '../container/index.js';
import { errorHandlerPlugin } from '../middleware/error-handler.js';
import { agentHeaderPlugin } from '../middleware/agent-header.js';
import { healthRoutes } from '../routes/health.js';
import { discoveryRoutes } from '../routes/discovery.js';
import { productRoutes } from '../routes/products.js';
import type { Env } from '../config/env.js';

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
 * Build a test app with MockAdapter.
 * Replaces the real tenant resolution (which needs DB/Redis) with an
 * in-memory mock that injects the tenant directly.
 */
export async function buildTestApp(): Promise<{
  app: FastifyInstance;
  container: AwilixContainer<Cradle>;
}> {
  const container = createAppContainer(TEST_ENV);

  const app = Fastify({ logger: false });

  app.decorate('container', container);
  await app.register(sensible);
  await app.register(errorHandlerPlugin);

  // Mock tenant resolution — replaces the real DB/Redis-backed one
  app.decorateRequest('tenant', null);
  app.decorateRequest('adapter', null);
  app.addHook('onRequest', async (request, reply) => {
    const url = request.url.split('?')[0]!;
    if (url === '/health' || url === '/ready') return;

    const host = request.hostname;
    if (!host || host !== TEST_DOMAIN) {
      void reply.status(404).send({
        error: { code: 'UNKNOWN_STORE', message: `No store configured for domain: ${host}` },
      });
      return;
    }

    const adapterRegistry = container.resolve('adapterRegistry');
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

  // Agent header validation — registered directly (not via register) to ensure hook ordering
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    if (path === '/health' || path === '/ready' || path.startsWith('/.well-known/')) return;
    const agentHeader = request.headers['ucp-agent'];
    if (!agentHeader || typeof agentHeader !== 'string' || agentHeader.trim().length === 0) {
      void reply.status(401).send({
        error: { code: 'INVALID_AGENT', message: 'Missing or invalid UCP-Agent header', http_status: 401 },
      });
      return;
    }
  });

  // Routes
  await app.register(healthRoutes);
  await app.register(discoveryRoutes);
  await app.register(productRoutes);

  await app.ready();
  return { app, container };
}
