import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BillingAddressClassSchema, BuyerClassSchema, PaymentCredentialSchema } from '@ucp-js/sdk';
import {
  AdapterError,
  EscalationRequiredError,
  type CheckoutSession,
  type CheckoutDiscounts,
  type AppliedDiscount,
  type Total,
} from '@ucp-gateway/core';
import { MOCK_DISCOUNTS } from '@ucp-gateway/adapters';
import {
  sendSessionError,
  isSessionExpired,
  isSessionOwnedByTenant,
  hasSessionAlreadyCompleted,
  checkIdempotencyKey,
  storeIdempotencyRecord,
} from './checkout-helpers.js';
import { toPublicCheckoutResponse, type TenantLinkSettings } from './checkout-response.js';
import {
  buildFulfillmentForCreate,
  buildFulfillmentForUpdate,
  computeTotalsWithFulfillment,
} from './fulfillment.js';

/* ---------------------------------------------------------------------------
 * Request-validation schemas
 *
 * We derive these from the official @ucp-js/sdk primitives (BuyerClassSchema,
 * BillingAddressClassSchema, PaymentCredentialSchema) but keep them lenient
 * (most fields optional) so that existing callers and tests continue to work.
 *
 * Response validation uses the full ExtendedCheckoutResponseSchema — see
 * checkout-response.ts.
 * ------------------------------------------------------------------------- */

const postalAddressSchema = BillingAddressClassSchema;

const lineItemSchema = z.object({
  item: z.object({ id: z.string().min(1) }),
  quantity: z.coerce.number().int().min(1),
});

const instrumentSchema = z.object({
  id: z.string().min(1),
  handler_id: z.string().min(1),
  handler_name: z.string().optional(),
  type: z.string().min(1),
  brand: z.string().optional(),
  last_digits: z.string().optional(),
  selected: z.boolean().optional(),
  credential: PaymentCredentialSchema.partial().passthrough().optional(),
  billing_address: postalAddressSchema.optional(),
});

const paymentHandlerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    spec: z.string().optional(),
    config_schema: z.string().optional(),
    instrument_schemas: z.array(z.string()).optional(),
    config: z.record(z.unknown()).optional(),
  })
  .passthrough();

const paymentSchema = z
  .object({
    instruments: z.array(instrumentSchema).optional(),
    handlers: z.array(paymentHandlerSchema).optional(),
  })
  .passthrough()
  .optional();

const fulfillmentSchema = z
  .object({
    methods: z
      .array(
        z
          .object({
            id: z.string().optional(),
            type: z.string().optional(),
            destinations: z.array(z.record(z.unknown())).optional(),
            selected_destination_id: z.string().optional(),
            groups: z
              .array(
                z
                  .object({ id: z.string().optional(), selected_option_id: z.string().optional() })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()
  .optional();

const discountsSchema = z
  .object({
    codes: z.array(z.string()).optional(),
  })
  .passthrough()
  .optional();

const createSessionSchema = z.object({
  line_items: z.array(lineItemSchema),
  currency: z.string().optional(),
  buyer: BuyerClassSchema.extend({
    shipping_address: postalAddressSchema.optional(),
    billing_address: postalAddressSchema.optional(),
  }).optional(),
  context: z
    .object({
      address_country: z.string().optional(),
      address_region: z.string().optional(),
      postal_code: z.string().optional(),
    })
    .optional(),
  payment: paymentSchema,
  fulfillment: fulfillmentSchema,
  discounts: discountsSchema,
});

const updateSessionSchema = z.object({
  id: z.string().optional(),
  line_items: z.array(lineItemSchema).optional(),
  currency: z.string().optional(),
  buyer: BuyerClassSchema.extend({
    shipping_address: postalAddressSchema.optional(),
    billing_address: postalAddressSchema.optional(),
  }).optional(),
  context: z
    .object({
      address_country: z.string().optional(),
      address_region: z.string().optional(),
      postal_code: z.string().optional(),
    })
    .optional(),
  payment: paymentSchema,
  fulfillment: fulfillmentSchema,
  discounts: discountsSchema,
});

const completeSessionSchema = z
  .object({
    payment: z
      .object({
        instruments: z.array(instrumentSchema).min(1),
      })
      .optional(),
    payment_data: instrumentSchema.optional(),
    risk_signals: z.record(z.string()).optional(),
  })
  .refine((data) => data.payment?.instruments?.length || data.payment_data, {
    message: 'Either payment.instruments or payment_data must be provided',
  });

function getTenantLinkSettings(request: FastifyRequest): TenantLinkSettings | undefined {
  const settings = request.tenant?.settings;
  if (settings && typeof settings === 'object') return settings as TenantLinkSettings;
  return undefined;
}

function sendValidationError(reply: FastifyReply, error: z.ZodError): FastifyReply {
  const message = error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
  return sendSessionError(reply, 'invalid', message, 400);
}

function sendPublic(
  reply: FastifyReply,
  status: number,
  session: CheckoutSession,
  tenantSettings?: TenantLinkSettings,
): FastifyReply {
  return reply.status(status).send(toPublicCheckoutResponse(session, tenantSettings));
}

/**
 * Process discount codes and return applied discounts with discount total.
 * Unknown codes are silently ignored.
 */
function processDiscounts(codes: readonly string[], subtotal: number): CheckoutDiscounts {
  const applied: AppliedDiscount[] = [];
  let runningTotal = subtotal;

  for (const code of codes) {
    const discountDef = MOCK_DISCOUNTS.find((d) => d.code === code);
    if (!discountDef) continue;

    let amount: number;
    if (discountDef.type === 'percentage') {
      amount = runningTotal - Math.trunc(runningTotal * (1 - discountDef.value / 100));
      runningTotal = Math.trunc(runningTotal * (1 - discountDef.value / 100));
    } else {
      amount = Math.min(discountDef.value, runningTotal);
      runningTotal = runningTotal - amount;
    }

    applied.push({
      code: discountDef.code,
      type: discountDef.type,
      amount,
      description: discountDef.description,
    });
  }

  return { codes: [...codes], applied };
}

/**
 * Compute totals from enriched line items, applying discounts if present.
 */
function computeBaseTotals(
  lineItems: readonly { readonly totals: readonly Total[] }[],
  discountCodes: readonly string[] | undefined,
  fulfillmentCost: number,
): { readonly totals: readonly Total[]; readonly discounts: CheckoutDiscounts | null } {
  const subtotal = lineItems.reduce((sum, li) => {
    const liSubtotal = li.totals.find((t) => t.type === 'subtotal');
    return sum + (liSubtotal?.amount ?? 0);
  }, 0);

  const totals: Total[] = [{ type: 'subtotal', amount: subtotal }];

  let discounts: CheckoutDiscounts | null = null;
  let discountAmount = 0;

  if (discountCodes && discountCodes.length > 0) {
    discounts = processDiscounts(discountCodes, subtotal);
    discountAmount = discounts.applied.reduce((sum, d) => sum + d.amount, 0);
    if (discountAmount > 0) {
      totals.push({ type: 'discount', amount: -discountAmount, display_text: 'Discount' });
    }
  }

  if (fulfillmentCost > 0) {
    totals.push({ type: 'fulfillment', amount: fulfillmentCost, display_text: 'Shipping' });
  }

  totals.push({ type: 'total', amount: subtotal - discountAmount + fulfillmentCost });

  return { totals, discounts };
}

export async function checkoutRoutes(app: FastifyInstance): Promise<void> {
  app.post('/checkout-sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(reply, parsed.error);

    const sessionStore = app.container.resolve('sessionStore');
    const redis = app.container.resolve('redis');
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    if (idempotencyKey) {
      const idempResult = await checkIdempotencyKey(
        redis,
        request.tenant.id,
        idempotencyKey,
        parsed.data,
        reply,
      );
      if (idempResult && 'cached' in idempResult && idempResult.cached) return idempResult.reply;
    }

    const session = await sessionStore.create(request.tenant.id);

    const updateFields: Record<string, unknown> = {};

    // Enrich line items with authoritative pricing from adapter
    const enrichedItems = [];
    for (let i = 0; i < parsed.data.line_items.length; i++) {
      const li = parsed.data.line_items[i]!;
      const productId = li.item.id;

      try {
        const product = await request.adapter.getProduct(productId);
        if (!product.in_stock || product.stock_quantity < li.quantity) {
          return sendSessionError(
            reply,
            'out_of_stock',
            `Insufficient stock for product ${productId}`,
            400,
          );
        }
        enrichedItems.push({
          id: `li-${i}`,
          item: {
            id: product.id,
            title: product.title,
            price: product.price_cents,
            image_url: product.images[0],
          },
          quantity: li.quantity,
          totals: [
            { type: 'subtotal' as const, amount: product.price_cents * li.quantity },
            { type: 'total' as const, amount: product.price_cents * li.quantity },
          ],
        });
      } catch {
        return sendSessionError(reply, 'product_not_found', `Product ${productId} not found`, 400);
      }
    }

    const lineItems = enrichedItems;
    updateFields['line_items'] = lineItems;

    // Create platform cart and add items
    try {
      const cart = await request.adapter.createCart();
      updateFields['cart_id'] = cart.id;

      const cartLineItems = parsed.data.line_items.map((li) => ({
        product_id: li.item.id,
        title: li.item.id,
        quantity: li.quantity,
        unit_price_cents: 0,
      }));
      await request.adapter.addToCart(cart.id, cartLineItems);
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error && 'statusCode' in err
          ? `[${(err as Error & { code: string }).code}] ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      app.log.warn('Platform cart error (cart_id may still be set): %s', errMsg);
    }

    // Compute totals from enriched items (no discounts on create)
    const { totals: baseTotals } = computeBaseTotals(lineItems, undefined, 0);
    updateFields['totals'] = baseTotals;

    if (parsed.data.currency) updateFields['currency'] = parsed.data.currency;
    if (parsed.data.buyer) updateFields['buyer'] = parsed.data.buyer;
    if (parsed.data.payment) updateFields['payment'] = parsed.data.payment;

    // Process fulfillment extension on create
    if (parsed.data.fulfillment) {
      const buyerEmail = parsed.data.buyer?.email ?? undefined;
      const fulfillment = buildFulfillmentForCreate(
        parsed.data.fulfillment as Record<string, unknown>,
        lineItems,
        buyerEmail,
      );
      if (fulfillment) {
        updateFields['fulfillment'] = fulfillment;
        const totals = computeTotalsWithFulfillment(
          { ...session, line_items: lineItems, fulfillment } as CheckoutSession,
          fulfillment,
        );
        updateFields['totals'] = totals;
        // If fulfillment option is selected, mark ready
        const hasSelectedOption = fulfillment.methods.some((m) =>
          m.groups.some((g) => g.selected_option_id),
        );
        if (hasSelectedOption) {
          updateFields['status'] = 'ready_for_complete';
        }
      }
    }

    const result =
      Object.keys(updateFields).length > 0
        ? await sessionStore.update(session.id, updateFields)
        : session;

    const responseBody = toPublicCheckoutResponse(
      result ?? session,
      getTenantLinkSettings(request),
    );
    if (idempotencyKey) {
      const hash = (await checkIdempotencyKey(
        redis,
        request.tenant.id,
        idempotencyKey,
        parsed.data,
        reply,
      )) as { cached: false; hash: string } | null;
      if (hash && !hash.cached) {
        await storeIdempotencyRecord(
          redis,
          request.tenant.id,
          idempotencyKey,
          hash.hash,
          201,
          JSON.stringify(responseBody),
        );
      }
    }

    return reply.status(201).send(responseBody);
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
      if (session.status !== 'incomplete' && session.status !== 'ready_for_complete')
        return sendSessionError(
          reply,
          'INVALID_SESSION_STATE',
          `Cannot modify session in state: ${session.status}`,
          409,
        );
      if (!isSessionOwnedByTenant(session, request.tenant))
        return sendSessionError(reply, 'missing', `Session not found: ${request.params.id}`, 404);

      const updateData: Record<string, unknown> = {};

      // Enrich line items with authoritative pricing
      if (parsed.data.line_items) {
        const enrichedItems = [];
        for (let i = 0; i < parsed.data.line_items.length; i++) {
          const li = parsed.data.line_items[i]!;
          const productId = li.item.id;

          try {
            const product = await request.adapter.getProduct(productId);
            if (!product.in_stock || product.stock_quantity < li.quantity) {
              return sendSessionError(
                reply,
                'out_of_stock',
                `Insufficient stock for product ${productId}`,
                400,
              );
            }
            enrichedItems.push({
              id: `li-${i}`,
              item: {
                id: product.id,
                title: product.title,
                price: product.price_cents,
                image_url: product.images[0],
              },
              quantity: li.quantity,
              totals: [
                { type: 'subtotal' as const, amount: product.price_cents * li.quantity },
                { type: 'total' as const, amount: product.price_cents * li.quantity },
              ],
            });
          } catch {
            return sendSessionError(
              reply,
              'product_not_found',
              `Product ${productId} not found`,
              400,
            );
          }
        }
        updateData['line_items'] = enrichedItems;
      }

      if (parsed.data.buyer) {
        updateData['buyer'] = parsed.data.buyer;
        if (parsed.data.buyer.shipping_address)
          updateData['shipping_address'] = parsed.data.buyer.shipping_address;
        if (parsed.data.buyer.billing_address)
          updateData['billing_address'] = parsed.data.buyer.billing_address;
      }

      // Determine effective line items for totals computation
      const effectiveLineItems =
        (updateData['line_items'] as CheckoutSession['line_items']) ?? session.line_items;

      // Process discounts
      const discountCodes = parsed.data.discounts?.codes;

      // Process fulfillment extension
      if (parsed.data.fulfillment) {
        const fulfillment = buildFulfillmentForUpdate(
          parsed.data.fulfillment as Record<string, unknown>,
          session,
        );
        if (fulfillment) {
          updateData['fulfillment'] = fulfillment;
          const effectiveSession: CheckoutSession = {
            ...session,
            line_items: effectiveLineItems,
            fulfillment,
          };

          // Get fulfillment cost from computeTotalsWithFulfillment
          const fulfillmentTotals = computeTotalsWithFulfillment(effectiveSession, fulfillment);
          const fulfillmentCostEntry = fulfillmentTotals.find((t) => t.type === 'fulfillment');
          const fulfillmentCost = fulfillmentCostEntry?.amount ?? 0;

          // Compute totals with discounts and fulfillment
          const { totals, discounts } = computeBaseTotals(
            effectiveLineItems,
            discountCodes,
            fulfillmentCost,
          );
          updateData['totals'] = totals;
          if (discounts) updateData['discounts'] = discounts;

          // Mark ready if an option is selected
          const hasSelectedOption = fulfillment.methods.some((m) =>
            m.groups.some((g) => g.selected_option_id),
          );
          if (hasSelectedOption) {
            updateData['status'] = 'ready_for_complete';
          }
        }
      } else if (discountCodes && discountCodes.length > 0) {
        // Discounts without fulfillment change
        const existingFulfillment = session.fulfillment;
        let fulfillmentCost = 0;
        if (existingFulfillment) {
          const fulfillmentTotals = computeTotalsWithFulfillment(
            { ...session, line_items: effectiveLineItems } as CheckoutSession,
            existingFulfillment,
          );
          const fulfillmentCostEntry = fulfillmentTotals.find((t) => t.type === 'fulfillment');
          fulfillmentCost = fulfillmentCostEntry?.amount ?? 0;
        }

        const { totals, discounts } = computeBaseTotals(
          effectiveLineItems,
          discountCodes,
          fulfillmentCost,
        );
        updateData['totals'] = totals;
        if (discounts) updateData['discounts'] = discounts;
      } else if (updateData['line_items'] || updateData['shipping_address']) {
        // Line items or shipping address changed — recompute totals
        const existingFulfillment = session.fulfillment;
        let fulfillmentCost = 0;
        if (existingFulfillment) {
          const fulfillmentTotals = computeTotalsWithFulfillment(
            { ...session, line_items: effectiveLineItems } as CheckoutSession,
            existingFulfillment,
          );
          const fulfillmentCostEntry = fulfillmentTotals.find((t) => t.type === 'fulfillment');
          fulfillmentCost = fulfillmentCostEntry?.amount ?? 0;
        }

        const { totals } = computeBaseTotals(effectiveLineItems, undefined, fulfillmentCost);
        updateData['totals'] = totals;

        // If shipping address was provided, mark session as ready
        if (updateData['shipping_address']) {
          updateData['status'] = 'ready_for_complete';
        }
      }

      const updated = await sessionStore.update(request.params.id, updateData);
      return sendPublic(reply, 200, updated ?? session, getTenantLinkSettings(request));
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
      if (hasSessionAlreadyCompleted(session))
        return sendPublic(reply, 200, session, getTenantLinkSettings(request));
      if (!isSessionOwnedByTenant(session, request.tenant))
        return sendSessionError(reply, 'missing', `Session not found: ${request.params.id}`, 404);

      if (session.status !== 'ready_for_complete' && session.status !== 'complete_in_progress')
        return sendSessionError(
          reply,
          'INVALID_SESSION_STATE',
          `Session must be in ready_for_complete state, got: ${session.status}`,
          409,
        );

      // Check fulfillment is selected before allowing completion
      const hasFulfillmentSelected = session.fulfillment?.methods.some(
        (m) => m.selected_destination_id && m.groups.some((g) => g.selected_option_id),
      );
      if (!hasFulfillmentSelected) {
        return sendSessionError(
          reply,
          'fulfillment_required',
          'Fulfillment address and option must be selected before completing checkout',
          400,
        );
      }

      const cartId = session.cart_id ?? '';

      // Resolve instrument from either payment.instruments or payment_data
      const selectedInstrument =
        parsed.data.payment_data ??
        parsed.data.payment?.instruments.find((i) => i.selected) ??
        parsed.data.payment?.instruments[0];

      if (!selectedInstrument) {
        return sendSessionError(reply, 'invalid', 'No payment instrument provided', 400);
      }

      const credentialRecord = selectedInstrument.credential as Record<string, unknown> | undefined;
      const paymentTokenValue = String(
        credentialRecord?.['token'] ?? credentialRecord?.['type'] ?? selectedInstrument.id,
      );

      await sessionStore.update(request.params.id, { status: 'complete_in_progress' });

      const tenantLinks = getTenantLinkSettings(request);

      try {
        const paymentToken = {
          token: paymentTokenValue,
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

        return sendPublic(reply, 200, completed ?? session, tenantLinks);
      } catch (err: unknown) {
        if (err instanceof EscalationRequiredError) {
          const escalated = await sessionStore.update(request.params.id, {
            status: 'requires_escalation',
            escalation: err.escalation,
            continue_url: err.escalation.continue_url,
          });
          return sendPublic(reply, 200, escalated ?? session, tenantLinks);
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
      const cancelTenantLinks = getTenantLinkSettings(request);
      if (session.status === 'canceled') return sendPublic(reply, 200, session, cancelTenantLinks);

      const canceled = await sessionStore.update(request.params.id, { status: 'canceled' });
      return sendPublic(reply, 200, canceled ?? session, cancelTenantLinks);
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

      return sendPublic(reply, 200, session, getTenantLinkSettings(request));
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
