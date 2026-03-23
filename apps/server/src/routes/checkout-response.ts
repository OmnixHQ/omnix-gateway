import type { CheckoutSession, CheckoutLink } from '@ucp-gateway/core';

const UCP_VERSION = '2026-01-23';

const DEFAULT_LINKS: readonly CheckoutLink[] = [
  { type: 'privacy_policy', url: 'https://example.com/privacy' },
  { type: 'terms_of_service', url: 'https://example.com/terms' },
];

export function toPublicCheckoutResponse(session: CheckoutSession): Record<string, unknown> {
  const links = session.links.length > 0 ? session.links : DEFAULT_LINKS;

  return {
    id: session.id,
    status: session.status,
    line_items: session.line_items,
    currency: session.currency,
    totals: session.totals,
    links,
    buyer: session.buyer,
    shipping_address: session.shipping_address,
    billing_address: session.billing_address,
    order: session.order,
    continue_url: session.continue_url,
    messages: session.messages,
    expires_at: session.expires_at,
    ucp: {
      version: UCP_VERSION,
      capabilities: [{ name: 'dev.ucp.shopping.checkout', version: UCP_VERSION }],
    },
  };
}
