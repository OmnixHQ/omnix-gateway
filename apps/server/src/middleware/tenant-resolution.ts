import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import type { AwilixContainer } from 'awilix';
import type { Cradle } from '../container/index.js';
import type { Tenant, PlatformAdapter } from '@ucp-gateway/core';
import { createAdapterForTenant } from './adapter-factory.js';

const CACHE_TTL_SECONDS = 300;
const CACHE_PREFIX = 'tenant:domain:';
const SKIP_PATHS = new Set(['/health', '/ready']);

declare module 'fastify' {
  interface FastifyRequest {
    tenant: Tenant;
    adapter: PlatformAdapter;
  }
  interface FastifyInstance {
    container: AwilixContainer<Cradle>;
  }
}

function shouldSkipTenantResolution(url: string): boolean {
  return SKIP_PATHS.has(url);
}

function buildTenantCacheKey(host: string): string {
  return `${CACHE_PREFIX}${host}`;
}

export const tenantResolutionPlugin = fp(async function tenantResolution(
  app: FastifyInstance,
): Promise<void> {
  app.decorateRequest('tenant', null);
  app.decorateRequest('adapter', null);

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (shouldSkipTenantResolution(request.url)) return;

    const container = app.container;
    const redis = container.resolve('redis');
    const tenantRepository = container.resolve('tenantRepository');

    const host = request.hostname;
    if (!host) {
      return reply.status(404).send({
        messages: [
          {
            type: 'error',
            code: 'UNKNOWN_STORE',
            content: 'Missing Host header',
            severity: 'recoverable',
          },
        ],
      });
    }

    const tenant = await resolveTenantByHost(redis, tenantRepository, host);

    if (!tenant) {
      return reply.status(404).send({
        messages: [
          {
            type: 'error',
            code: 'UNKNOWN_STORE',
            content: `No store configured for domain: ${host}`,
            severity: 'recoverable',
          },
        ],
      });
    }

    request.tenant = tenant;
    request.adapter = createAdapterForTenant(tenant.platform, tenant.adapterConfig);
  });
});

async function resolveTenantByHost(
  redis: {
    get(key: string): Promise<string | null>;
    setex(key: string, ttl: number, value: string): Promise<unknown>;
  },
  tenantRepository: { findByDomain(domain: string): Promise<Tenant | null> },
  host: string,
): Promise<Tenant | null> {
  const cacheKey = buildTenantCacheKey(host);
  const cached = await redis.get(cacheKey);

  if (cached) {
    return JSON.parse(cached) as Tenant;
  }

  const tenant = await tenantRepository.findByDomain(host);
  if (tenant) {
    await redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(tenant));
  }

  return tenant;
}
