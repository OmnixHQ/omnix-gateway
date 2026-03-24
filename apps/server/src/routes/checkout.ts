import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { PlatformAdapter, PaymentHandler } from '@ucp-gateway/core';
import { AdapterError } from '@ucp-gateway/core';
import { sendSessionError, type MessageSeverity } from './checkout-helpers.js';
import {
  toPublicCheckoutResponse,
  type TenantLinkSettings,
  type CheckoutResponseOptions,
} from './checkout-response.js';
import { isSessionOwnedByTenant } from './checkout-helpers.js';
import {
  createSessionSchema,
  updateSessionSchema,
  completeSessionSchema,
} from './checkout-schemas.js';
import {
  handleCreateSession,
  handleUpdateSession,
  handleCompleteSession,
} from './checkout-service.js';

function getTenantLinkSettings(request: FastifyRequest): TenantLinkSettings | undefined {
  const settings = request.tenant?.settings;
  const base = settings && typeof settings === 'object' ? (settings as TenantLinkSettings) : {};
  return { ...base, domain: request.tenant?.domain };
}

async function resolvePaymentHandlers(
  adapter: PlatformAdapter,
): Promise<readonly PaymentHandler[]> {
  if (!adapter.getSupportedPaymentMethods) return [];
  try {
    return await adapter.getSupportedPaymentMethods();
  } catch {
    return [];
  }
}

function sendValidationError(reply: FastifyReply, error: z.ZodError): FastifyReply {
  const message = error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
  return sendSessionError(reply, 'invalid', message, 400);
}

function sendResult(
  reply: FastifyReply,
  result:
    | { ok: true; statusCode: number; session: unknown }
    | { ok: false; statusCode: number; code: string; message: string; severity?: MessageSeverity },
  options?: CheckoutResponseOptions,
): FastifyReply {
  if (!result.ok)
    return sendSessionError(reply, result.code, result.message, result.statusCode, result.severity);
  return reply
    .status(result.statusCode)
    .send(
      toPublicCheckoutResponse(
        result.session as Parameters<typeof toPublicCheckoutResponse>[0],
        options,
      ),
    );
}

async function buildResponseOptions(request: FastifyRequest): Promise<CheckoutResponseOptions> {
  const paymentHandlers = await resolvePaymentHandlers(request.adapter);
  return {
    tenantSettings: getTenantLinkSettings(request),
    paymentHandlers,
  };
}

export async function checkoutRoutes(app: FastifyInstance): Promise<void> {
  app.post('/checkout-sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const result = await handleCreateSession(
      {
        adapter: request.adapter,
        sessionStore: app.container.resolve('sessionStore'),
        redis: app.container.resolve('redis'),
        tenantId: request.tenant.id,
        idempotencyKey: request.headers['idempotency-key'] as string | undefined,
        logger: app.log,
        tenantSettings: getTenantLinkSettings(request),
      },
      parsed.data,
    );

    const options = await buildResponseOptions(request);
    return sendResult(reply, result, options);
  });

  app.put<{ Params: { id: string } }>(
    '/checkout-sessions/:id',
    async (request, reply: FastifyReply) => {
      const parsed = updateSessionSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);

      const result = await handleUpdateSession(
        {
          adapter: request.adapter,
          sessionStore: app.container.resolve('sessionStore'),
          tenantId: request.tenant.id,
          tenant: request.tenant,
        },
        request.params.id,
        parsed.data,
      );

      const options = await buildResponseOptions(request);
      return sendResult(reply, result, options);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/checkout-sessions/:id/complete',
    async (request, reply: FastifyReply) => {
      const parsed = completeSessionSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);

      const result = await handleCompleteSession(
        {
          adapter: request.adapter,
          sessionStore: app.container.resolve('sessionStore'),
          tenantDomain: request.tenant.domain,
          tenant: request.tenant,
        },
        request.params.id,
        parsed.data,
      );

      const options = await buildResponseOptions(request);
      return sendResult(reply, result, options);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/checkout-sessions/:id/cancel',
    async (request, reply: FastifyReply) => {
      const sessionStore = app.container.resolve('sessionStore');
      const session = await sessionStore.get(request.params.id);

      if (!session)
        return sendSessionError(reply, 'missing', `Session not found: ${request.params.id}`, 404);
      if (!isSessionOwnedByTenant(session, request.tenant))
        return sendSessionError(reply, 'missing', `Session not found: ${request.params.id}`, 404);
      if (session.status === 'completed')
        return sendSessionError(
          reply,
          'INVALID_SESSION_STATE',
          'Cannot cancel a completed session',
          409,
        );
      const options = await buildResponseOptions(request);
      if (session.status === 'canceled')
        return reply.status(200).send(toPublicCheckoutResponse(session, options));

      const canceled = await sessionStore.update(request.params.id, { status: 'canceled' });
      return reply.status(200).send(toPublicCheckoutResponse(canceled ?? session, options));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/checkout-sessions/:id',
    async (request, reply: FastifyReply) => {
      const sessionStore = app.container.resolve('sessionStore');
      const session = await sessionStore.get(request.params.id);

      if (!session)
        return sendSessionError(reply, 'missing', `Session not found: ${request.params.id}`, 404);
      if (!isSessionOwnedByTenant(session, request.tenant))
        return sendSessionError(reply, 'missing', `Session not found: ${request.params.id}`, 404);

      const options = await buildResponseOptions(request);
      return reply.status(200).send(toPublicCheckoutResponse(session, options));
    },
  );

  app.get<{ Params: { id: string } }>('/orders/:id', async (request, reply: FastifyReply) => {
    try {
      const order = await request.adapter.getOrder(request.params.id);
      return reply.status(200).send(order);
    } catch (err: unknown) {
      if (err instanceof AdapterError && err.code === 'ORDER_NOT_FOUND') {
        return sendSessionError(reply, 'missing', `Order not found: ${request.params.id}`, 404);
      }
      throw err;
    }
  });
}
