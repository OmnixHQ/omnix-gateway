import type { Cart, LineItem, Buyer, SdkCart } from '../types/commerce.js';

const UCP_VERSION = '2026-01-23';

function mapLineItem(item: LineItem, index: number): SdkCart['line_items'][number] {
  const lineTotal = item.unit_price_cents * item.quantity;
  return {
    id: `li-${index}`,
    item: {
      id: item.product_id,
      title: item.title,
      price: item.unit_price_cents,
    },
    quantity: item.quantity,
    totals: [
      { type: 'subtotal', amount: lineTotal },
      { type: 'total', amount: lineTotal },
    ],
  };
}

export interface ToSdkCartOptions {
  readonly ucpVersion?: string;
  readonly buyer?: Buyer | undefined;
  readonly context?: Record<string, unknown> | undefined;
}

export function toSdkCart(cart: Cart, options?: ToSdkCartOptions): SdkCart {
  const ucpVersion = options?.ucpVersion ?? UCP_VERSION;
  const lineItems = cart.items.map((item, i) => mapLineItem(item, i));
  const subtotal = lineItems.reduce((sum, li) => {
    const sub = li.totals.find((t) => t.type === 'subtotal');
    return sum + (sub?.amount ?? 0);
  }, 0);

  return {
    ucp: {
      version: ucpVersion,
      status: 'success' as const,
      services: {},
      capabilities: {},
    },
    id: cart.id,
    currency: cart.currency,
    line_items: lineItems,
    totals: [
      { type: 'subtotal', amount: subtotal },
      { type: 'total', amount: subtotal },
    ],
    ...(options?.buyer ? { buyer: options.buyer } : {}),
    ...(options?.context ? { context: options.context } : {}),
  };
}
