import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { OrderSchema, type Order } from '@omnixhq/ucp-js-sdk';
import type { PlatformAdapter, PaymentHandler } from '@ucp-gateway/core';
import { AdapterError } from '@ucp-gateway/core';
import {
  sendSessionError,
  checkIdempotencyKey,
  storeIdempotencyRecord,
  computeRequestHash,
  type MessageSeverity,
} from './checkout-helpers.js';
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
  updateOrderSchema,
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
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
      if (idempotencyKey) {
        const redis = app.container.resolve('redis');
        const check = await checkIdempotencyKey(
          redis,
          request.tenant.id,
          idempotencyKey,
          request.body,
          reply,
        );
        if (check?.cached) return check.reply;
      }

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
      const response = sendResult(reply, result, options);

      if (idempotencyKey && result.ok) {
        const redis = app.container.resolve('redis');
        const hash = computeRequestHash(request.body);
        const body = JSON.stringify(toPublicCheckoutResponse(result.session, options));
        await storeIdempotencyRecord(
          redis,
          request.tenant.id,
          idempotencyKey,
          hash,
          result.statusCode,
          body,
        );
      }
      return response;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/checkout-sessions/:id/complete',
    async (request, reply: FastifyReply) => {
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
      if (idempotencyKey) {
        const redis = app.container.resolve('redis');
        const check = await checkIdempotencyKey(
          redis,
          request.tenant.id,
          idempotencyKey,
          request.body,
          reply,
        );
        if (check?.cached) return check.reply;
      }

      const parsed = completeSessionSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);

      const result = await handleCompleteSession(
        {
          adapter: request.adapter,
          sessionStore: app.container.resolve('sessionStore'),
          tenantDomain: request.tenant.domain,
          tenant: request.tenant,
          eventBus: app.container.resolve('eventBus'),
        },
        request.params.id,
        parsed.data,
      );

      const options = await buildResponseOptions(request);
      const response = sendResult(reply, result, options);

      if (idempotencyKey && result.ok) {
        const redis = app.container.resolve('redis');
        const hash = computeRequestHash(request.body);
        const body = JSON.stringify(toPublicCheckoutResponse(result.session, options));
        await storeIdempotencyRecord(
          redis,
          request.tenant.id,
          idempotencyKey,
          hash,
          result.statusCode,
          body,
        );
      }
      return response;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/checkout-sessions/:id/cancel',
    async (request, reply: FastifyReply) => {
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
      if (idempotencyKey) {
        const redis = app.container.resolve('redis');
        const check = await checkIdempotencyKey(
          redis,
          request.tenant.id,
          idempotencyKey,
          request.body ?? {},
          reply,
        );
        if (check?.cached) return check.reply;
      }

      const sessionStore = app.container.resolve('sessionStore');
      const session = await sessionStore.get(request.params.id);

      if (!session)
        return sendSessionError(reply, 'missing', `Session not found: ${request.params.id}`, 404);
      if (!isSessionOwnedByTenant(session, request.tenant))
        return sendSessionError(reply, 'missing', `Session not found: ${request.params.id}`, 404);
      if (session.status === 'completed')
        return sendSessionError(
          reply,
          'invalid_session_state',
          'Cannot cancel a completed session',
          409,
        );
      const options = await buildResponseOptions(request);
      if (session.status === 'canceled')
        return reply.status(200).send(toPublicCheckoutResponse(session, options));

      const canceled = await sessionStore.update(request.params.id, { status: 'canceled' });

      const eventBus = app.container.resolve('eventBus');
      eventBus.emit({
        id: randomUUID(),
        type: 'order.canceled',
        tenant_id: request.tenant.id,
        occurred_at: new Date().toISOString(),
        payload: { session_id: request.params.id },
      });

      const responseBody = toPublicCheckoutResponse(canceled ?? session, options);

      if (idempotencyKey) {
        const redis = app.container.resolve('redis');
        const hash = computeRequestHash(request.body ?? {});
        await storeIdempotencyRecord(
          redis,
          request.tenant.id,
          idempotencyKey,
          hash,
          200,
          JSON.stringify(responseBody),
        );
      }
      return reply.status(200).send(responseBody);
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

  function buildOrderResponse(
    order: import('@ucp-gateway/core').PlatformOrder,
    details: import('@ucp-gateway/core').PlatformOrderDetails | null,
  ): Order & { readonly status: string; readonly created_at: string } {
    const lineItems = (details?.line_items ?? []).map((li, i) => ({
      id: `li-${i}`,
      item: { id: li.product_id, title: li.title, price: li.unit_price_cents },
      quantity: { total: li.quantity, fulfilled: (li as { _fulfilled?: number })._fulfilled ?? 0 },
      totals: [{ type: 'total' as const, amount: li.unit_price_cents * li.quantity }],
      status:
        ((li as { _fulfilled?: number })._fulfilled ?? 0) >= li.quantity
          ? ('fulfilled' as const)
          : ('processing' as const),
    }));

    const input = {
      ucp: {
        version: '2026-01-23',
        status: 'success' as const,
        capabilities: {
          'dev.ucp.shopping.order': [{ version: '2026-01-23' }],
        },
      },
      id: order.id,
      checkout_id: `session-${order.id}`,
      permalink_url: `https://mock.store/orders/${order.id}`,
      line_items: lineItems,
      totals: [{ type: 'total' as const, amount: order.total_cents }],
      currency: order.currency,
      fulfillment: {
        expectations: details?.fulfillment_expectations ?? [],
        events: details?.fulfillment_events ?? [],
      },
      adjustments: details?.adjustments ?? [],
    };

    const result = OrderSchema.safeParse(input);
    const base = result.success ? result.data : (input as unknown as Order);
    return { ...base, status: order.status, created_at: order.created_at_iso };
  }

  app.get<{ Params: { id: string } }>('/orders/:id', async (request, reply: FastifyReply) => {
    try {
      const adapter = request.adapter;
      const details = adapter.getOrderWithDetails
        ? await adapter.getOrderWithDetails(request.params.id)
        : null;
      const order = details ?? (await adapter.getOrder(request.params.id));

      return reply.status(200).send(buildOrderResponse(order, details));
    } catch (err: unknown) {
      if (err instanceof AdapterError && err.code === 'ORDER_NOT_FOUND') {
        return sendSessionError(reply, 'missing', `Order not found: ${request.params.id}`, 404);
      }
      throw err;
    }
  });

  app.put<{ Params: { id: string } }>('/orders/:id', async (request, reply: FastifyReply) => {
    if (!request.adapter.updateOrder) {
      return sendSessionError(reply, 'not_supported', 'Order updates not supported', 501);
    }

    const parsed = updateOrderSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendSessionError(
        reply,
        'invalid',
        parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
        400,
      );
    }

    try {
      const update: import('@ucp-gateway/core').OrderUpdateInput = parsed.data;

      const updated = await request.adapter.updateOrder(request.params.id, update);
      const details = request.adapter.getOrderWithDetails
        ? await request.adapter.getOrderWithDetails(request.params.id)
        : null;

      const eventBus = app.container.resolve('eventBus');
      const eventType =
        update.fulfillment_event?.type === 'delivered'
          ? ('order.fulfilled' as const)
          : ('order.updated' as const);
      eventBus.emit({
        id: randomUUID(),
        type: eventType,
        tenant_id: request.tenant.id,
        occurred_at: new Date().toISOString(),
        payload: { id: updated.id, status: updated.status } as Readonly<Record<string, unknown>>,
      });

      return reply.status(200).send(buildOrderResponse(updated, details));
    } catch (err: unknown) {
      if (err instanceof AdapterError && err.code === 'ORDER_NOT_FOUND') {
        return sendSessionError(reply, 'missing', `Order not found: ${request.params.id}`, 404);
      }
      throw err;
    }
  });
}
