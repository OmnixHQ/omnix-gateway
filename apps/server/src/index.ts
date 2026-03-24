/**
 * UCP Gateway Server — entry point.
 * Boots the DI container, builds the Fastify app, and starts listening.
 */

import 'dotenv/config';
import { loadEnv } from './config/env.js';
import { createAppContainer } from './container/index.js';
import { buildApp } from './app.js';

const env = loadEnv();
const container = createAppContainer(env);
const app = await buildApp({ container });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`Received ${signal}, shutting down gracefully…`);
  await app.close();
  await container.dispose();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
