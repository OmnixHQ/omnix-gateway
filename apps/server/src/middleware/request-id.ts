import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

export const requestIdPlugin = fp(async function requestId(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const incomingId = request.headers['request-id'];
    const resolvedId =
      typeof incomingId === 'string' && incomingId.length > 0 ? incomingId : randomUUID();
    request.log = request.log.child({ requestId: resolvedId });
    void reply.header('Request-Id', resolvedId);
  });
});
