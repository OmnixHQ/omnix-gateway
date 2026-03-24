/**
 * Platform cart creation and item management for checkout sessions.
 */

import type { PlatformAdapter } from '@ucp-gateway/core';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Create a platform cart and add items. Returns the cart ID, or null on failure.
 * Cart errors are logged but do not fail the checkout session creation.
 */
export async function createPlatformCart(
  adapter: PlatformAdapter,
  lineItems: readonly { readonly item: { readonly id: string }; readonly quantity: number }[],
  logger: FastifyBaseLogger,
): Promise<string | null> {
  try {
    const cart = await adapter.createCart();
    const cartLineItems = lineItems.map((li) => ({
      product_id: li.item.id,
      title: li.item.id,
      quantity: li.quantity,
      unit_price_cents: 0,
    }));
    await adapter.addToCart(cart.id, cartLineItems);
    return cart.id;
  } catch (err: unknown) {
    const errMsg =
      err instanceof Error && 'statusCode' in err
        ? `[${(err as unknown as Error & { code: string }).code}] ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    logger.warn('Platform cart error (cart_id may still be set): %s', errMsg);
    return null;
  }
}
