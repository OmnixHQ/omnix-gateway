import type {
  CheckoutSession,
  PlatformAdapter,
  SessionStore,
  UCPOrder,
  OrderFulfillment,
  OrderFulfillmentExpectation,
} from '@ucp-gateway/core';
import { EscalationRequiredError } from '@ucp-gateway/core';
import type { Redis as RedisType } from 'ioredis';
import type { z } from 'zod';
import {
  isSessionExpired,
  isSessionOwnedByTenant,
  hasSessionAlreadyCompleted,
  computeRequestHash,
  storeIdempotencyRecord,
  type MessageSeverity,
} from './checkout-helpers.js';
import {
  buildFulfillmentForCreate,
  buildFulfillmentForUpdate,
  computeTotalsWithFulfillment,
} from './fulfillment.js';
import { computeCheckoutTotals } from './checkout-pricing.js';
import { createPlatformCart } from './checkout-cart.js';
import { validateFulfillmentSelected, shouldMarkReadyForComplete } from './checkout-validation.js';
import { toPublicCheckoutResponse, type TenantLinkSettings } from './checkout-response.js';
import type {
  createSessionSchema,
  updateSessionSchema,
  completeSessionSchema,
} from './checkout-schemas.js';

const UCP_VERSION = '2026-01-23';

type CreateSessionBody = z.infer<typeof createSessionSchema>;
type UpdateSessionBody = z.infer<typeof updateSessionSchema>;
type CompleteSessionBody = z.infer<typeof completeSessionSchema>;

export type ServiceResult =
  | { readonly ok: true; readonly statusCode: number; readonly session: CheckoutSession }
  | {
      readonly ok: false;
      readonly statusCode: number;
      readonly code: string;
      readonly message: string;
      readonly severity?: MessageSeverity;
    };

interface MinimalLogger {
  readonly warn: (msg: string, ...args: unknown[]) => void;
}

function fail(
  statusCode: number,
  code: string,
  message: string,
  severity?: MessageSeverity,
): ServiceResult {
  const base = { ok: false as const, statusCode, code, message };
  return severity ? { ...base, severity } : base;
}

function succeed(statusCode: number, session: CheckoutSession): ServiceResult {
  return { ok: true, statusCode, session };
}

function extractFulfillmentCost(
  session: CheckoutSession,
  effectiveLineItems: CheckoutSession['line_items'],
  fulfillment: NonNullable<CheckoutSession['fulfillment']>,
): number {
  const fulfillmentTotals = computeTotalsWithFulfillment(
    { ...session, line_items: effectiveLineItems } as CheckoutSession,
    fulfillment,
  );
  const fulfillmentCostEntry = fulfillmentTotals.find((t) => t.type === 'fulfillment');
  return fulfillmentCostEntry?.amount ?? 0;
}

async function enrichLineItems(
  adapter: PlatformAdapter,
  parsedLineItems: readonly { readonly item: { readonly id: string }; readonly quantity: number }[],
): Promise<
  | { readonly ok: true; readonly items: CheckoutSession['line_items'] }
  | { readonly ok: false; readonly result: ServiceResult }
> {
  const enrichedItems: Array<{
    readonly id: string;
    readonly item: {
      readonly id: string;
      readonly title: string;
      readonly price: number;
      readonly image_url: string | undefined;
    };
    readonly quantity: number;
    readonly totals: readonly { readonly type: string; readonly amount: number }[];
  }> = [];

  for (let i = 0; i < parsedLineItems.length; i++) {
    const li = parsedLineItems[i]!;
    const productId = li.item.id;

    try {
      const product = await adapter.getProduct(productId);
      if (!product.in_stock || product.stock_quantity < li.quantity) {
        return {
          ok: false,
          result: fail(400, 'out_of_stock', `Insufficient stock for product ${productId}`),
        };
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
      return {
        ok: false,
        result: fail(400, 'product_not_found', `Product ${productId} not found`),
      };
    }
  }

  return { ok: true, items: enrichedItems as unknown as CheckoutSession['line_items'] };
}

function buildOrderFulfillment(session: CheckoutSession): OrderFulfillment {
  if (!session.fulfillment) return { expectations: [], events: [] };

  const expectations: readonly OrderFulfillmentExpectation[] = session.fulfillment.methods.flatMap(
    (method) =>
      (method.destinations ?? [])
        .filter((d) => d.id === method.selected_destination_id)
        .map((dest) => ({
          id: `exp-${method.id}-${dest.id}`,
          line_items: method.line_item_ids.map((liId) => ({ id: liId, quantity: 1 })),
          method_type: (method.type ?? 'shipping') as 'shipping' | 'pickup' | 'digital',
          destination: dest.address ?? {},
        })),
  );

  return { expectations, events: [] };
}

export async function handleCreateSession(
  deps: {
    readonly adapter: PlatformAdapter;
    readonly sessionStore: SessionStore;
    readonly redis: RedisType;
    readonly tenantId: string;
    readonly idempotencyKey?: string | undefined;
    readonly logger: MinimalLogger;
    readonly tenantSettings?: TenantLinkSettings | undefined;
  },
  body: CreateSessionBody,
): Promise<ServiceResult> {
  if (deps.idempotencyKey) {
    const raw = await deps.redis.get(`idempotency:${deps.tenantId}:${deps.idempotencyKey}`);
    if (raw) {
      const record = JSON.parse(raw) as { hash: string; status: number; body: string };
      const currentHash = computeRequestHash(body);
      if (record.hash !== currentHash) {
        return fail(
          409,
          'idempotency_conflict',
          'Idempotency key reused with different parameters',
        );
      }
      // NOTE: cached response — return early with the stored session
      const cachedBody = JSON.parse(record.body) as Record<string, unknown>;
      return {
        ok: true,
        statusCode: record.status,
        session: cachedBody as unknown as CheckoutSession,
      };
    }
  }

  const session = await deps.sessionStore.create(deps.tenantId);
  const updateFields: Record<string, unknown> = {};

  const enrichResult = await enrichLineItems(deps.adapter, body.line_items);
  if (!enrichResult.ok) return enrichResult.result;

  const lineItems = enrichResult.items;
  updateFields['line_items'] = lineItems;

  const cartId = await createPlatformCart(
    deps.adapter,
    body.line_items,
    deps.logger as unknown as Parameters<typeof createPlatformCart>[2],
  );
  if (cartId) updateFields['cart_id'] = cartId;

  const discountCodes = body.discounts?.codes;

  // WHY: only apply discounts here when no fulfillment — the fulfillment branch
  // recomputes totals with fulfillment cost included, and calling applyCoupon
  // twice would double-consume single-use coupons on some adapters.
  const applyDiscountsInBaseTotals = !body.fulfillment;
  const { totals: baseTotals, discounts: baseDiscounts } = await computeCheckoutTotals(
    lineItems,
    applyDiscountsInBaseTotals ? discountCodes : undefined,
    0,
    applyDiscountsInBaseTotals ? deps.adapter : undefined,
    applyDiscountsInBaseTotals ? (cartId ?? undefined) : undefined,
  );
  updateFields['totals'] = baseTotals;
  if (baseDiscounts) updateFields['discounts'] = baseDiscounts;

  if (body.currency) updateFields['currency'] = body.currency;
  if (body.buyer) updateFields['buyer'] = body.buyer;
  if (body.payment) updateFields['payment'] = body.payment;

  if (body.fulfillment) {
    const buyerEmail = body.buyer?.email ?? undefined;
    const fulfillment = await buildFulfillmentForCreate(
      body.fulfillment as Record<string, unknown>,
      lineItems,
      buyerEmail,
      deps.adapter,
      cartId ?? undefined,
    );
    if (fulfillment) {
      updateFields['fulfillment'] = fulfillment;
      const fulfillmentCost = extractFulfillmentCost(
        { ...session, line_items: lineItems, fulfillment } as CheckoutSession,
        lineItems,
        fulfillment,
      );
      const { totals: ffTotals, discounts: ffDiscounts } = await computeCheckoutTotals(
        lineItems,
        discountCodes,
        fulfillmentCost,
        deps.adapter,
        cartId ?? undefined,
      );
      updateFields['totals'] = ffTotals;
      if (ffDiscounts) updateFields['discounts'] = ffDiscounts;
      if (shouldMarkReadyForComplete(fulfillment)) {
        updateFields['status'] = 'ready_for_complete';
      }
    }
  }

  const result =
    Object.keys(updateFields).length > 0
      ? await deps.sessionStore.update(session.id, updateFields)
      : session;

  const finalSession = result ?? session;

  if (deps.idempotencyKey) {
    const hash = computeRequestHash(body);
    const responseBody = toPublicCheckoutResponse(finalSession, deps.tenantSettings);
    await storeIdempotencyRecord(
      deps.redis,
      deps.tenantId,
      deps.idempotencyKey,
      hash,
      201,
      JSON.stringify(responseBody),
    );
  }

  return succeed(201, finalSession);
}

export async function handleUpdateSession(
  deps: {
    readonly adapter: PlatformAdapter;
    readonly sessionStore: SessionStore;
    readonly tenantId: string;
    readonly tenant: { readonly id: string };
  },
  sessionId: string,
  body: UpdateSessionBody,
): Promise<ServiceResult> {
  const session = await deps.sessionStore.get(sessionId);

  if (!session) return fail(404, 'missing', `Session not found: ${sessionId}`);
  if (isSessionExpired(session))
    return fail(410, 'session_expired', 'Checkout session has expired');
  if (session.status !== 'incomplete' && session.status !== 'ready_for_complete') {
    return fail(409, 'invalid_session_state', `Cannot modify session in state: ${session.status}`);
  }
  if (
    !isSessionOwnedByTenant(session, deps.tenant as Parameters<typeof isSessionOwnedByTenant>[1])
  ) {
    return fail(404, 'missing', `Session not found: ${sessionId}`);
  }

  const updateData: Record<string, unknown> = {};

  if (body.line_items) {
    const enrichResult = await enrichLineItems(deps.adapter, body.line_items);
    if (!enrichResult.ok) return enrichResult.result;
    updateData['line_items'] = enrichResult.items;
  }

  if (body.buyer) {
    updateData['buyer'] = body.buyer;
    if (body.buyer.shipping_address) updateData['shipping_address'] = body.buyer.shipping_address;
    if (body.buyer.billing_address) updateData['billing_address'] = body.buyer.billing_address;
  }

  const effectiveLineItems =
    (updateData['line_items'] as CheckoutSession['line_items']) ?? session.line_items;

  const discountCodes = body.discounts?.codes;

  if (body.fulfillment) {
    const fulfillment = await buildFulfillmentForUpdate(
      body.fulfillment as Record<string, unknown>,
      session,
      deps.adapter,
      session.cart_id ?? undefined,
    );
    if (fulfillment) {
      updateData['fulfillment'] = fulfillment;
      const fulfillmentCost = extractFulfillmentCost(session, effectiveLineItems, fulfillment);
      const { totals, discounts } = await computeCheckoutTotals(
        effectiveLineItems,
        discountCodes,
        fulfillmentCost,
        deps.adapter,
        session.cart_id ?? undefined,
      );
      updateData['totals'] = totals;
      if (discounts) updateData['discounts'] = discounts;
      if (shouldMarkReadyForComplete(fulfillment)) {
        updateData['status'] = 'ready_for_complete';
      }
    }
  } else if (discountCodes && discountCodes.length > 0) {
    const existingFulfillment = session.fulfillment;
    const fulfillmentCost = existingFulfillment
      ? extractFulfillmentCost(session, effectiveLineItems, existingFulfillment)
      : 0;
    const { totals, discounts } = await computeCheckoutTotals(
      effectiveLineItems,
      discountCodes,
      fulfillmentCost,
      deps.adapter,
      session.cart_id ?? undefined,
    );
    updateData['totals'] = totals;
    if (discounts) updateData['discounts'] = discounts;
  } else if (updateData['line_items'] || updateData['shipping_address']) {
    const existingFulfillment = session.fulfillment;
    const fulfillmentCost = existingFulfillment
      ? extractFulfillmentCost(session, effectiveLineItems, existingFulfillment)
      : 0;
    const { totals } = await computeCheckoutTotals(effectiveLineItems, undefined, fulfillmentCost);
    updateData['totals'] = totals;
    if (updateData['shipping_address']) {
      updateData['status'] = 'ready_for_complete';
    }
  }

  const updated = await deps.sessionStore.update(sessionId, updateData);
  return succeed(200, updated ?? session);
}

export async function handleCompleteSession(
  deps: {
    readonly adapter: PlatformAdapter;
    readonly sessionStore: SessionStore;
    readonly tenantDomain: string;
    readonly tenant: { readonly id: string };
  },
  sessionId: string,
  body: CompleteSessionBody,
): Promise<ServiceResult> {
  const session = await deps.sessionStore.get(sessionId);

  if (!session) return fail(404, 'missing', `Session not found: ${sessionId}`);
  if (isSessionExpired(session))
    return fail(410, 'session_expired', 'Checkout session has expired');
  if (hasSessionAlreadyCompleted(session)) return succeed(200, session);
  if (
    !isSessionOwnedByTenant(session, deps.tenant as Parameters<typeof isSessionOwnedByTenant>[1])
  ) {
    return fail(404, 'missing', `Session not found: ${sessionId}`);
  }

  if (session.status !== 'ready_for_complete' && session.status !== 'complete_in_progress') {
    return fail(
      409,
      'invalid_session_state',
      `Session must be in ready_for_complete state, got: ${session.status}`,
    );
  }

  if (!validateFulfillmentSelected(session)) {
    return fail(
      400,
      'fulfillment_required',
      'Fulfillment address and option must be selected before completing checkout',
      'requires_buyer_input',
    );
  }

  const cartId = session.cart_id ?? '';

  const selectedInstrument =
    body.payment_data ??
    body.payment?.instruments.find((i) => i.selected) ??
    body.payment?.instruments[0];

  if (!selectedInstrument) {
    return fail(400, 'invalid', 'No payment instrument provided', 'requires_buyer_input');
  }

  const credentialRecord = selectedInstrument.credential as Record<string, unknown> | undefined;
  const paymentTokenValue = String(
    credentialRecord?.['token'] ?? credentialRecord?.['type'] ?? selectedInstrument.id,
  );

  await deps.sessionStore.update(sessionId, { status: 'complete_in_progress' });

  try {
    const paymentToken = {
      token: paymentTokenValue,
      provider: selectedInstrument.handler_id,
    };
    const placedOrder = await deps.adapter.placeOrder(cartId, paymentToken);

    const orderFulfillment = buildOrderFulfillment(session);
    const ucpOrder: UCPOrder = {
      ucp: {
        version: UCP_VERSION,
        capabilities: [{ name: 'dev.ucp.shopping.order', version: UCP_VERSION }],
      },
      id: placedOrder.id,
      checkout_id: session.id,
      permalink_url: `https://${deps.tenantDomain}/orders/${placedOrder.id}`,
      line_items: session.line_items.map((li) => ({
        id: li.id,
        item: { ...li.item },
        quantity: { total: li.quantity, fulfilled: 0 },
        totals: [...li.totals],
        status: 'processing' as const,
      })),
      totals: [...session.totals],
      fulfillment: orderFulfillment,
      adjustments: [],
      created_at: new Date().toISOString(),
    };

    const completed = await deps.sessionStore.update(sessionId, {
      status: 'completed',
      order: ucpOrder,
    });

    return succeed(200, completed ?? session);
  } catch (err: unknown) {
    if (err instanceof EscalationRequiredError) {
      const escalationMessage = {
        type: 'error' as const,
        code: 'escalation_required',
        content: err.escalation.reason ?? 'Payment requires additional verification',
        severity: 'requires_buyer_review' as const,
      };
      const existingMessages = session.messages ?? [];
      const escalated = await deps.sessionStore.update(sessionId, {
        status: 'requires_escalation',
        escalation: err.escalation,
        continue_url: err.escalation.continue_url,
        messages: [...existingMessages, escalationMessage],
      });
      return succeed(200, escalated ?? session);
    }
    throw err;
  }
}
