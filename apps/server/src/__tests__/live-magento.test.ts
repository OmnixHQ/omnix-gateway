/**
 * Live integration test against real Magento via UCP Middleware.
 *
 * Prerequisites (skip this test if not running):
 *   - Magento at http://localhost:8080 with sample products
 *   - UCP Postgres at localhost:5433
 *   - UCP Redis at localhost:6380
 *   - Tenant 'localhost' pointing to Magento in tenants table
 *
 * Run:
 *   npm run test:live -w apps/server
 *
 * This test is SKIPPED by default in CI (no real platforms available).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';

import { createContainer, asValue, asClass, InjectionMode } from 'awilix';
import Redis from 'ioredis';
import { createDb, TenantRepository, AdapterRegistry, SessionStore } from '@ucp-gateway/core';
import { MockAdapter } from '@ucp-gateway/adapters';
import type { Cradle } from '../container/index.js';
import { errorHandlerPlugin } from '../middleware/error-handler.js';
import { tenantResolutionPlugin } from '../middleware/tenant-resolution.js';
import { agentHeaderPlugin } from '../middleware/agent-header.js';
import { healthRoutes } from '../routes/health.js';
import { discoveryRoutes } from '../routes/discovery.js';
import { productRoutes } from '../routes/products.js';
import { checkoutRoutes } from '../routes/checkout.js';

const LIVE_DB_URL = 'postgresql://ucp:ucp@localhost:5433/ucp';
const LIVE_REDIS_URL = 'redis://localhost:6380';
const AGENT_HEADER = { 'ucp-agent': 'live-test/1.0', host: 'localhost:3000' };

function isLiveEnvironmentAvailable(): boolean {
  return process.env['RUN_LIVE_TESTS'] === 'true';
}

const describeLive = isLiveEnvironmentAvailable() ? describe : describe.skip;

describeLive('Live: UCP Middleware → Magento', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const db = createDb({ connectionString: LIVE_DB_URL });
    const redis = new Redis.default(LIVE_REDIS_URL);

    const adapterRegistry = new AdapterRegistry();
    adapterRegistry.register('mock', new MockAdapter());

    const sessionStore = new SessionStore(redis);

    const container = createContainer<Cradle>({ injectionMode: InjectionMode.CLASSIC });
    container.register({
      env: asValue({
        PORT: 0,
        LOG_LEVEL: 'error',
        NODE_ENV: 'test',
        DATABASE_URL: LIVE_DB_URL,
        REDIS_URL: LIVE_REDIS_URL,
        SECRET_KEY: 'test_secret_32_chars_at_least_long',
      }),
      db: asValue(db),
      redis: asValue(redis),
      tenantRepository: asClass(TenantRepository, { injector: () => ({ db }) }),
      adapterRegistry: asValue(adapterRegistry),
      sessionStore: asValue(sessionStore),
    });

    app = Fastify({ logger: false });
    app.decorate('container', container);

    await app.register(sensible);
    await app.register(errorHandlerPlugin);
    await app.register(tenantResolutionPlugin);
    await app.register(agentHeaderPlugin);
    await app.register(healthRoutes);
    await app.register(discoveryRoutes);
    await app.register(productRoutes);
    await app.register(checkoutRoutes);

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /.well-known/ucp returns Magento store profile', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/ucp',
      headers: { host: 'localhost:3000' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    const ucp = body['ucp'] as Record<string, unknown>;
    expect(ucp['version']).toBe('2026-01-23');
  });

  it('GET /ucp/products?q=shoes returns real Magento products', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ucp/products?q=shoes',
      headers: AGENT_HEADER,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      products: { id: string; title: string; price_cents: number }[];
    };
    expect(body.products.length).toBeGreaterThan(0);
    expect(body.products[0]!.title).toContain('Shoes');
    expect(body.products[0]!.price_cents).toBe(12999);
  });

  it('GET /ucp/products/ucp-shoes-001 returns product detail', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ucp/products/ucp-shoes-001',
      headers: AGENT_HEADER,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { id: string; title: string };
    expect(body.id).toBe('ucp-shoes-001');
    expect(body.title).toBe('Running Shoes Pro');
  });

  it('GET /ucp/products/nonexistent returns 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ucp/products/nonexistent-sku-xyz',
      headers: AGENT_HEADER,
    });

    expect(res.statusCode).toBe(404);
  });

  it('creates checkout session and sets address', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: { ...AGENT_HEADER, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(createRes.statusCode).toBe(201);
    const session = JSON.parse(createRes.body) as { id: string; status: string };
    expect(session.status).toBe('incomplete');

    const patchRes = await app.inject({
      method: 'PUT',
      url: `/checkout-sessions/${session.id}`,
      headers: { ...AGENT_HEADER, 'content-type': 'application/json' },
      body: JSON.stringify({
        id: session.id,
        buyer: {
          shipping_address: {
            first_name: 'Test',
            last_name: 'User',
            street_address: '456 Oak Ave',
            address_locality: 'Denver',
            postal_code: '80202',
            address_region: 'CO',
            address_country: 'US',
          },
        },
      }),
    });

    expect(patchRes.statusCode).toBe(200);
    const patched = JSON.parse(patchRes.body) as { status: string };
    expect(patched.status).toBe('ready_for_complete');
  });
});
