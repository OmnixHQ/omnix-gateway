import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { IdentityLinkRepository } from '@ucp-gateway/core';
import { buildUCPErrorBody } from './checkout-helpers.js';

const UCP_VERSION = '2026-01-23';

const linkCreateSchema = z.object({
  external_id: z.string().min(1),
  platform_customer_id: z.string().min(1),
});

export async function identityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ucp/identity/config', async (request: FastifyRequest) => {
    const adapter = request.adapter;
    const config = adapter.getIdentityConfig ? await adapter.getIdentityConfig() : null;

    return {
      ucp: {
        version: UCP_VERSION,
        capabilities: {
          'dev.ucp.shopping.identity_linking': [{ version: UCP_VERSION }],
        },
      },
      mechanisms: config?.mechanisms ?? [],
    };
  });

  app.post('/ucp/identity/link', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = linkCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(
          buildUCPErrorBody(
            'validation_error',
            parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
          ),
        );
    }

    const db = app.container.resolve('db');
    const repo = new IdentityLinkRepository(db);
    const link = await repo.create(
      request.tenant.id,
      parsed.data.external_id,
      parsed.data.platform_customer_id,
    );

    return reply.status(201).send({
      id: link.id,
      external_id: link.externalId,
      platform_customer_id: link.platformCustomerId,
      created_at: link.createdAt,
    });
  });

  app.get<{ Params: { externalId: string } }>(
    '/ucp/identity/link/:externalId',
    async (request, reply: FastifyReply) => {
      const db = app.container.resolve('db');
      const repo = new IdentityLinkRepository(db);
      const link = await repo.findByExternalId(request.tenant.id, request.params.externalId);

      if (!link) {
        return reply.status(404).send(buildUCPErrorBody('not_found', 'Identity link not found'));
      }

      return {
        id: link.id,
        external_id: link.externalId,
        platform_customer_id: link.platformCustomerId,
        created_at: link.createdAt,
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/ucp/identity/link/:id',
    async (request, reply: FastifyReply) => {
      const db = app.container.resolve('db');
      const repo = new IdentityLinkRepository(db);
      const deleted = await repo.deleteByTenant(request.params.id, request.tenant.id);

      if (!deleted) {
        return reply.status(404).send(buildUCPErrorBody('not_found', 'Identity link not found'));
      }

      return reply.status(204).send();
    },
  );
}
