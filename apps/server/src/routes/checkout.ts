import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AdapterError, EscalationRequiredError, type CheckoutSession } from '@ucp-gateway/core';
import {
  sendSessionError,
  isSessionExpired,
  isSessionOwnedByTenant,
  hasSessionAlreadyCompleted,
  findExistingSessionByIdempotencyKey,
  storeIdempotencyMapping,
} from './checkout-helpers.js';
import { toPublicCheckoutResponse } from './checkout-response.js';

const postalAddressSchema = z.object({
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  street_address: z.string().min(1).optional(),
  extended_address: z.string().optional(),
  address_locality: z.string().min(1).optional(),
  address_region: z.string().optional(),
  postal_code: z.string().min(1).optional(),
  address_country: z.string().length(2).optional(),
  phone_number: z.string().optional(),
});

const lineItemSchema = z.object({
  item: z.object({ id: z.string().min(1) }),
  quantity: z.coerce.number().int().min(1),
});

const instrumentSchema = z.object({
  id: z.string().min(1),
  handler_id: z.string().min(1),
  type: z.string().min(1),
  selected: z.boolean().optional(),
  credential: z
    .object({ type: z.string().min(1) })
    .passthrough()
    .optional(),
  billing_address: postalAddressSchema.optional(),
});

const paymentSchema = z
  .object({
    instruments: z.array(instrumentSchema).min(1),
  })
  .optional();

const createSessionSchema = z.object({
  line_items: z.array(lineItemSchema).optional(),
  buyer: z
    .object({
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      email: z.string().email().optional(),
      phone_number: z.string().optional(),
    })
    .optional(),
  context: z
    .object({
      address_country: z.string().optional(),
      address_region: z.string().optional(),
      postal_code: z.string().optional(),
    })
    .optional(),
  payment: paymentSchema,
});

const updateSessionSchema = z.object({
  id: z.string().min(1),
  line_items: z.array(lineItemSchema).optional(),
  buyer: z
    .object({
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      email: z.string().email().optional(),
      phone_number: z.string().optional(),
      shipping_address: postalAddressSchema.optional(),
      billing_address: postalAddressSchema.optional(),
    })
    .optional(),
  context: z
    .object({
      address_country: z.string().optional(),
      address_region: z.string().optional(),
      postal_code: z.string().optional(),
    })
    .optional(),
  payment: paymentSchema,
});

const completeSessionSchema = z.object({
  payment: z.object({
    instruments: z.array(instrumentSchema).min(1),
  }),
  risk_signals: z.record(z.string()).optional(),
});

function sendValidationError(reply: FastifyReply, error: z.ZodError): FastifyReply {
  const message = error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
  return sendSessionError(reply, 'invalid', message, 400);
}

function sendPublic(reply: FastifyReply, status: number, session: CheckoutSession): FastifyReply {
  return reply.status(status).send(toPublicCheckoutResponse(session));
}

export async function checkoutRoutes(app: FastifyInstance): Promise<void> {
  app.post('/checkout-sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const sessionStore = app.container.resolve('sessionStore');
    const redis = app.container.resolve('redis');
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    if (idempotencyKey) {
      const existingId = await findExistingSessionByIdempotencyKey(
        redis,
        request.tenant.id,
        idempotencyKey,
      );
      if (existingId) {
        const existing = await sessionStore.get(existingId);
        if (existing) return sendPublic(reply, 200, existing);
      }
    }

    const session = await sessionStore.create(request.tenant.id);

    const updateFields: Record<string, unknown> = {};
    if (parsed.data.line_items) {
      updateFields['line_items'] = parsed.data.line_items.map((li, index) => ({
        id: `li-${index}`,
        item: li.item,
        quantity: li.quantity,
        totals: [],
      }));
    }
    if (parsed.data.buyer) updateFields['buyer'] = parsed.data.buyer;
    if (idempotencyKey) updateFields['idempotency_key'] = idempotencyKey;

    const result =
      Object.keys(updateFields).length > 0
        ? await sessionStore.update(session.id, updateFields)
        : session;

    if (idempotencyKey) {
      await storeIdempotencyMapping(redis, request.tenant.id, idempotencyKey, session.id);
    }

    return sendPublic(reply, 201, result ?? session);
  });

  app.put<{ Params: { id: string } }>(
    '/checkout-sessions/:id',
    async (request, reply: FastifyReply) => {
      const parsed = updateSessionSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);

      const sessionStore = app.container.resolve('sessionStore');
      const session = await sessionStore.get(request.params.id);

      if (!session)
        return sendSessionError(reply, 'missing', `Session not found: ${request.params.id}`, 404);
      if (isSessionExpired(session))
        return sendSessionError(reply, 'SESSION_EXPIRED', 'Checkout session has expired', 410);
      if (session.status !== 'incomplete')
        return sendSessionError(
          reply,
          'INVALID_SESSION_STATE',
          `Cannot modify session in state: ${session.status}`,
          409,
        );
      if (!isSessionOwnedByTenant(session, request.tenant))
        return sendSessionError(reply, 'missing', `Session not found: ${request.params.id}`, 404);

      const updateData: Record<string, unknown> = {};
      if (parsed.data.line_items) {
        updateData['line_items'] = parsed.data.line_items.map((li, index) => ({
          id: `li-${index}`,
          item: li.item,
          quantity: li.quantity,
          totals: [],
        }));
      }
      if (parsed.data.buyer) {
        updateData['buyer'] = parsed.data.buyer;
        if (parsed.data.buyer.shipping_address)
          updateData['shipping_address'] = parsed.data.buyer.shipping_address;
        if (parsed.data.buyer.billing_address)
          updateData['billing_address'] = parsed.data.buyer.billing_address;
      }

      if (updateData['shipping_address']) {
        const totals = await calculateTotalsWithFallback(
          request,
          session,
          updateData['shipping_address'] as z.infer<typeof postalAddressSchema>,
        );
        if (totals) updateData['totals'] = totals;
        updateData['status'] = 'ready_for_complete';
      }

      const updated = await sessionStore.update(request.params.id, updateData);
      return sendPublic(reply, 200, updated ?? session);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/checkout-sessions/:id/complete',
    async (request, reply: FastifyReply) => {
      const parsed = completeSessionSchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(reply, parsed.error);

      const sessionStore = app.container.resolve('sessionStore');
      const session = await sessionStore.get(request.params.id);

      if (!session)
        return sendSessionError(reply, 'missing', `Session not found: ${request.params.id}`, 404);
      if (isSessionExpired(session))
        return sendSessionError(reply, 'SESSION_EXPIRED', 'Checkout session has expired', 410);
      if (hasSessionAlreadyCompleted(session)) return sendPublic(reply, 200, session);
      if (session.status !== 'ready_for_complete')
        return sendSessionError(
          reply,
          'INVALID_SESSION_STATE',
          `Session must be in ready_for_complete state, got: ${session.status}`,
          409,
        );
      if (!isSessionOwnedByTenant(session, request.tenant))
        return sendSessionError(reply, 'missing', `Session not found: ${request.params.id}`, 404);

      const cartId = session.cart_id ?? '';

      await sessionStore.update(request.params.id, { status: 'complete_in_progress' });

      try {
        const selectedInstrument =
          parsed.data.payment.instruments.find((i) => i.selected) ??
          parsed.data.payment.instruments[0]!;
        const paymentToken = {
          token: selectedInstrument.credential?.type ?? selectedInstrument.id,
          provider: selectedInstrument.handler_id,
        };
        const placedOrder = await request.adapter.placeOrder(cartId, paymentToken);

        const completed = await sessionStore.update(request.params.id, {
          status: 'completed',
          order: {
            id: placedOrder.id,
            permalink_url: `https://${request.tenant.domain}/orders/${placedOrder.id}`,
          },
        });

        return sendPublic(reply, 200, completed ?? session);
      } catch (err: unknown) {
        if (err instanceof EscalationRequiredError) {
          const escalated = await sessionStore.update(request.params.id, {
            status: 'requires_escalation',
            escalation: err.escalation,
            continue_url: err.escalation.continue_url,
          });
          return sendPublic(reply, 200, escalated ?? session);
        }
        throw err;
      }
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
      if (session.status === 'canceled') return sendPublic(reply, 200, session);

      const canceled = await sessionStore.update(request.params.id, { status: 'canceled' });
      return sendPublic(reply, 200, canceled ?? session);
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

      return sendPublic(reply, 200, session);
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

async function calculateTotalsWithFallback(
  request: FastifyRequest,
  session: CheckoutSession,
  shippingAddress: z.infer<typeof postalAddressSchema>,
): Promise<unknown> {
  const cartId = session.cart_id;
  if (!cartId) return null;

  try {
    return await request.adapter.calculateTotals(cartId, {
      shipping_address: shippingAddress,
    });
  } catch {
    return null;
  }
}
