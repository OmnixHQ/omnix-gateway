import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import type { AwilixContainer } from 'awilix';
import type { Cradle } from './container/index.js';
import { errorHandlerPlugin } from './middleware/error-handler.js';
import { tenantResolutionPlugin } from './middleware/tenant-resolution.js';
import { agentHeaderPlugin } from './middleware/agent-header.js';
import { healthRoutes } from './routes/health.js';
import { discoveryRoutes } from './routes/discovery.js';
import { productRoutes } from './routes/products.js';

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

  // Decorate with DI container
  app.decorate('container', container);

  // Plugins
  await app.register(sensible);

  // Error handling
  await app.register(errorHandlerPlugin);

  // Middleware (order matters: tenant first, then agent header)
  await app.register(tenantResolutionPlugin);
  await app.register(agentHeaderPlugin);

  // Routes
  await app.register(healthRoutes);
  await app.register(discoveryRoutes);
  await app.register(productRoutes);

  return app;
}
