import { createContainer, asValue, asClass, InjectionMode, type AwilixContainer } from 'awilix';
import Redis, { type Redis as RedisType } from 'ioredis';
import type { Queue } from 'bullmq';
import type { Env } from '../config/env.js';
import {
  createDb,
  TenantRepository,
  AdapterRegistry,
  SessionStore,
  SigningService,
  EventBus,
  type Database,
} from '@ucp-gateway/core';
import { MockAdapter } from '@ucp-gateway/adapters';
import { createWebhookQueue, type WebhookJobData } from '../webhooks/index.js';

export interface Cradle {
  env: Env;
  db: Database;
  redis: RedisType;
  tenantRepository: TenantRepository;
  adapterRegistry: AdapterRegistry;
  sessionStore: SessionStore;
  signingService: SigningService;
  eventBus: EventBus;
  webhookQueue: Queue<WebhookJobData>;
}

export function createAppContainer(env: Env): AwilixContainer<Cradle> {
  const container = createContainer<Cradle>({
    injectionMode: InjectionMode.CLASSIC,
  });

  const db = createDb({ connectionString: env.DATABASE_URL });
  const redis = new Redis.default(env.REDIS_URL);

  const adapterRegistry = new AdapterRegistry();
  adapterRegistry.register('mock', new MockAdapter());

  const sessionStore = new SessionStore(redis);

  const signingService = new SigningService({
    privateKeyJwk: env.UCP_SIGNING_KEY_JWK,
    keyPrefix: 'ucp_gw',
  });

  const eventBus = new EventBus();

  const webhookQueue = createWebhookQueue({
    host: new URL(env.REDIS_URL).hostname || 'localhost',
    port: Number(new URL(env.REDIS_URL).port) || 6379,
  });

  container.register({
    env: asValue(env),
    db: asValue(db),
    redis: asValue(redis),
    tenantRepository: asClass(TenantRepository, {
      injector: () => ({ db }),
    }),
    adapterRegistry: asValue(adapterRegistry),
    sessionStore: asValue(sessionStore),
    signingService: asValue(signingService),
    eventBus: asValue(eventBus),
    webhookQueue: asValue(webhookQueue),
  });

  return container;
}
