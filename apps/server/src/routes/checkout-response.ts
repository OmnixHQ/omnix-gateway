import { CheckoutResponseStatusSchema, ExtendedCheckoutResponseSchema } from '@ucp-js/sdk';
import type { CheckoutSession, CheckoutLink } from '@ucp-gateway/core';

const UCP_VERSION = '2026-01-23';

const DEFAULT_LINKS: readonly CheckoutLink[] = [
  { type: 'privacy_policy', url: 'https://example.com/privacy' },
  { type: 'terms_of_service', url: 'https://example.com/terms' },
];

/**
 * Build a raw response object from an internal CheckoutSession.
 * This shape is aligned with `ExtendedCheckoutResponseSchema` from @ucp-js/sdk.
 */
function buildRawResponse(session: CheckoutSession): Record<string, unknown> {
  const links = session.links.length > 0 ? session.links : DEFAULT_LINKS;

  const status = CheckoutResponseStatusSchema.safeParse(session.status);

  return {
    id: session.id,
    status: status.success ? status.data : session.status,
    line_items: session.line_items.map((li) => ({
      id: li.id,
      item: {
        id: li.item.id,
        title: li.item.title ?? '',
        price: li.item.price ?? 0,
        image_url: li.item.image_url,
      },
      quantity: li.quantity,
      totals: li.totals ?? [],
    })),
    currency: session.currency ?? 'USD',
    totals: session.totals ?? [],
    links,
    buyer: session.buyer,
    shipping_address: session.shipping_address,
    billing_address: session.billing_address,
    order: session.order,
    order_id: session.order?.id,
    order_permalink_url: session.order?.permalink_url,
    continue_url: session.continue_url,
    messages: session.messages,
    expires_at: session.expires_at,
    fulfillment: session.fulfillment ?? undefined,
    payment: {
      handlers: [],
      instruments: [],
    },
    ucp: {
      version: UCP_VERSION,
      capabilities: [
        { name: 'dev.ucp.shopping.checkout', version: UCP_VERSION },
        {
          name: 'dev.ucp.shopping.fulfillment',
          version: UCP_VERSION,
          spec: 'https://ucp.dev/latest/specification/fulfillment/',
          schema: 'https://ucp.dev/2026-01-23/schemas/shopping/fulfillment.json',
          extends: 'dev.ucp.shopping.checkout',
        },
      ],
    },
  };
}

/**
 * Transforms an internal CheckoutSession into the public API response shape.
 *
 * We attempt to validate against ExtendedCheckoutResponseSchema so that
 * any drift between our internal model and the SDK is caught early.
 * If validation fails we still return the raw response (graceful degradation)
 * but log a warning so we can fix the mismatch.
 */
export function toPublicCheckoutResponse(session: CheckoutSession): Record<string, unknown> {
  const raw = buildRawResponse(session);

  const result = ExtendedCheckoutResponseSchema.safeParse(raw);
  if (!result.success) {
    // Graceful degradation: return unvalidated response but log the mismatch
    // so we can tighten the internal model over time.
    if (process.env['NODE_ENV'] !== 'test') {
      console.warn(
        '[checkout-response] SDK response validation drift:',
        result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }
  }

  return raw;
}
