import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import type { AwilixContainer } from 'awilix';
import type { Cradle } from './container/index.js';
import { errorHandlerPlugin } from './middleware/error-handler.js';
import { tenantResolutionPlugin } from './middleware/tenant-resolution.js';
import { agentHeaderPlugin } from './middleware/agent-header.js';
import { requestIdPlugin } from './middleware/request-id.js';
import { requestSignaturePlugin } from './middleware/request-signature.js';
import { healthRoutes } from './routes/health.js';
import { discoveryRoutes } from './routes/discovery.js';
import { productRoutes } from './routes/products.js';
import { checkoutRoutes } from './routes/checkout.js';
import { createWebhookWorker, createWebhookBridge } from './webhooks/index.js';

export interface BuildAppOptions {
  readonly container: AwilixContainer<Cradle>;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { container } = options;
  const env = container.resolve('env');

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
        : {}),
    },
  });

  app.decorate('container', container);

  const signingService = container.resolve('signingService');
  await signingService.initialize();
  app.decorate('signingService', signingService);

  const eventBus = container.resolve('eventBus');
  const webhookQueue = container.resolve('webhookQueue');
  const tenantRepository = container.resolve('tenantRepository');

  createWebhookBridge(eventBus, webhookQueue, tenantRepository, app.log);

  const redisConnection = {
    host: new URL(env.REDIS_URL).hostname || 'localhost',
    port: Number(new URL(env.REDIS_URL).port) || 6379,
  };
  const webhookWorker = createWebhookWorker(redisConnection, signingService, app.log);

  app.addHook('onClose', async () => {
    await webhookWorker.close();
    await webhookQueue.close();
    eventBus.removeAllListeners();
  });

  await app.register(sensible);
  await app.register(errorHandlerPlugin);
  await app.register(requestIdPlugin);
  await app.register(tenantResolutionPlugin);
  await app.register(agentHeaderPlugin);
  await app.register(requestSignaturePlugin);

  await app.register(healthRoutes);
  await app.register(discoveryRoutes);
  await app.register(productRoutes);
  await app.register(checkoutRoutes);

  return app;
}
