/**
 * Pricing enrichment and totals computation for checkout sessions.
 */

import type {
  CheckoutSession,
  CheckoutDiscounts,
  AppliedDiscount,
  Total,
  PlatformAdapter,
} from '@ucp-gateway/core';
import { sendSessionError } from './checkout-helpers.js';
import type { FastifyReply } from 'fastify';

interface EnrichedLineItem {
  readonly id: string;
  readonly item: {
    readonly id: string;
    readonly title: string;
    readonly price: number;
    readonly image_url: string | undefined;
  };
  readonly quantity: number;
  readonly totals: readonly Total[];
}

type EnrichResult =
  | { readonly ok: true; readonly items: readonly EnrichedLineItem[] }
  | { readonly ok: false; readonly reply: FastifyReply };

/**
 * Fetch authoritative product data from the adapter and build enriched line items.
 * Returns an error reply if a product is not found or out of stock.
 */
export async function enrichLineItemsWithPricing(
  adapter: PlatformAdapter,
  parsedLineItems: readonly { readonly item: { readonly id: string }; readonly quantity: number }[],
  reply: FastifyReply,
): Promise<EnrichResult> {
  const enrichedItems: EnrichedLineItem[] = [];

  for (let i = 0; i < parsedLineItems.length; i++) {
    const li = parsedLineItems[i]!;
    const productId = li.item.id;

    try {
      const product = await adapter.getProduct(productId);
      if (!product.in_stock || product.stock_quantity < li.quantity) {
        return {
          ok: false,
          reply: sendSessionError(
            reply,
            'out_of_stock',
            `Insufficient stock for product ${productId}`,
            400,
          ),
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
        reply: sendSessionError(reply, 'product_not_found', `Product ${productId} not found`, 400),
      };
    }
  }

  return { ok: true, items: enrichedItems };
}

async function processDiscounts(
  codes: readonly string[],
  subtotal: number,
  adapter?: PlatformAdapter,
  cartId?: string,
): Promise<CheckoutDiscounts> {
  if (!adapter?.applyCoupon || !cartId) {
    return { codes: [...codes], applied: [] };
  }

  const applied: AppliedDiscount[] = [];
  let runningTotal = subtotal;

  for (const code of codes) {
    try {
      const discountDef = await adapter.applyCoupon(cartId, code);

      let amount: number;
      if (discountDef.type === 'percentage') {
        amount = runningTotal - Math.trunc(runningTotal * (1 - discountDef.amount / 100));
        runningTotal = Math.trunc(runningTotal * (1 - discountDef.amount / 100));
      } else {
        amount = Math.min(discountDef.amount, runningTotal);
        runningTotal = runningTotal - amount;
      }

      applied.push({
        title: discountDef.description,
        amount,
        code,
        automatic: false,
      });
    } catch {
      // NOTE: unknown codes are silently ignored
    }
  }

  return { codes: [...codes], applied };
}

export async function computeCheckoutTotals(
  lineItems: readonly { readonly totals: readonly Total[] }[],
  discountCodes: readonly string[] | undefined,
  fulfillmentCost: number,
  adapter?: PlatformAdapter,
  cartId?: string,
): Promise<{ readonly totals: readonly Total[]; readonly discounts: CheckoutDiscounts | null }> {
  const subtotal = lineItems.reduce((sum, li) => {
    const liSubtotal = li.totals.find((t) => t.type === 'subtotal');
    return sum + (liSubtotal?.amount ?? 0);
  }, 0);

  const totals: Total[] = [{ type: 'subtotal', amount: subtotal }];

  let discounts: CheckoutDiscounts | null = null;
  let discountAmount = 0;

  if (discountCodes && discountCodes.length > 0) {
    discounts = await processDiscounts(discountCodes, subtotal, adapter, cartId);
    discountAmount = discounts.applied.reduce((sum, d) => sum + d.amount, 0);
    if (discountAmount > 0) {
      totals.push({ type: 'discount', amount: discountAmount, display_text: 'Discount' });
    }
  }

  if (fulfillmentCost > 0) {
    totals.push({ type: 'fulfillment', amount: fulfillmentCost, display_text: 'Shipping' });
  }

  totals.push({ type: 'total', amount: subtotal - discountAmount + fulfillmentCost });

  return { totals, discounts };
}

/**
 * Extract fulfillment cost from a session with fulfillment, then compute totals.
 */
export async function computeTotalsForSessionWithFulfillment(
  session: CheckoutSession,
  effectiveLineItems: CheckoutSession['line_items'],
  fulfillment: NonNullable<CheckoutSession['fulfillment']>,
  discountCodes: readonly string[] | undefined,
  computeFulfillmentTotals: (
    session: CheckoutSession,
    fulfillment: NonNullable<CheckoutSession['fulfillment']>,
  ) => readonly Total[],
  adapter?: PlatformAdapter,
  cartId?: string,
): Promise<{ readonly totals: readonly Total[]; readonly discounts: CheckoutDiscounts | null }> {
  const effectiveSession: CheckoutSession = {
    ...session,
    line_items: effectiveLineItems,
    fulfillment,
  };
  const fulfillmentTotals = computeFulfillmentTotals(effectiveSession, fulfillment);
  const fulfillmentCostEntry = fulfillmentTotals.find((t) => t.type === 'fulfillment');
  const fulfillmentCost = fulfillmentCostEntry?.amount ?? 0;

  return computeCheckoutTotals(effectiveLineItems, discountCodes, fulfillmentCost, adapter, cartId);
}
