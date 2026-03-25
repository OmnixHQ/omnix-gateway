/**
 * Unit tests for mock data removal changes in checkout-pricing and fulfillment.
 * Covers: computeCheckoutTotals (discounts, totals), fulfillment helpers
 * (getStoredAddresses via buildFulfillmentForCreate, resolveItemPrice via
 * computeTotalsWithFulfillment, generateShippingOptions via buildFulfillmentForCreate).
 */

import { describe, it, expect, vi } from 'vitest';
import type { PlatformAdapter, Total, Fulfillment } from '@ucp-gateway/core';
import { computeCheckoutTotals } from '../routes/checkout-pricing.js';
import {
  buildFulfillmentForCreate,
  computeTotalsWithFulfillment,
  getSelectedFulfillmentCost,
} from '../routes/fulfillment.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLineItemTotals(subtotal: number): readonly Total[] {
  return [
    { type: 'subtotal', amount: subtotal },
    { type: 'total', amount: subtotal },
  ];
}

function makeLineItem(overrides: {
  id?: string;
  subtotal: number;
}): { readonly totals: readonly Total[] } {
  return { totals: makeLineItemTotals(overrides.subtotal) };
}

function makeSessionLineItem(opts: {
  id?: string;
  itemId: string;
  price: number;
  quantity: number;
}) {
  const sub = opts.price * opts.quantity;
  return {
    id: opts.id ?? `li-0`,
    item: { id: opts.itemId, title: 'Test Item', price: opts.price, image_url: undefined },
    quantity: opts.quantity,
    totals: makeLineItemTotals(sub) as Total[],
  };
}

function makeMockAdapter(overrides: Partial<PlatformAdapter> = {}): PlatformAdapter {
  return {
    getProduct: vi.fn(),
    searchProducts: vi.fn(),
    createCart: vi.fn(),
    addToCart: vi.fn(),
    placeOrder: vi.fn(),
    ...overrides,
  } as unknown as PlatformAdapter;
}

// ---------------------------------------------------------------------------
// checkout-pricing: computeCheckoutTotals
// ---------------------------------------------------------------------------

describe('computeCheckoutTotals', () => {
  it('returns correct subtotal from line items', async () => {
    const items = [makeLineItem({ subtotal: 2000 }), makeLineItem({ subtotal: 3000 })];

    const result = await computeCheckoutTotals(items, undefined, 0);

    const subtotal = result.totals.find((t) => t.type === 'subtotal');
    const total = result.totals.find((t) => t.type === 'total');
    expect(subtotal?.amount).toBe(5000);
    expect(total?.amount).toBe(5000);
    expect(result.discounts).toBeNull();
  });

  it('with no discount codes returns empty applied discounts (null)', async () => {
    const items = [makeLineItem({ subtotal: 1000 })];

    const result = await computeCheckoutTotals(items, undefined, 0);

    expect(result.discounts).toBeNull();
  });

  it('with empty discount codes array returns empty applied discounts', async () => {
    const items = [makeLineItem({ subtotal: 1000 })];

    const result = await computeCheckoutTotals(items, [], 0);

    // Empty array does not trigger discount processing
    expect(result.discounts).toBeNull();
  });

  it('with discount codes calls adapter.applyCoupon()', async () => {
    const applyCoupon = vi.fn().mockResolvedValue({
      amount: 10,
      type: 'percentage',
      description: '10% off',
    });
    const adapter = makeMockAdapter({ applyCoupon });
    const items = [makeLineItem({ subtotal: 10000 })];

    const result = await computeCheckoutTotals(items, ['SAVE10'], 0, adapter, 'cart-1');

    expect(applyCoupon).toHaveBeenCalledWith('cart-1', 'SAVE10');
    expect(result.discounts).not.toBeNull();
    expect(result.discounts!.codes).toEqual(['SAVE10']);
    expect(result.discounts!.applied).toHaveLength(1);
    expect(result.discounts!.applied[0]!.code).toBe('SAVE10');
    expect(result.discounts!.applied[0]!.type).toBe('percentage');
    // 10% of 10000 = 1000
    expect(result.discounts!.applied[0]!.amount).toBe(1000);

    const discountTotal = result.totals.find((t) => t.type === 'discount');
    expect(discountTotal?.amount).toBe(-1000);

    const total = result.totals.find((t) => t.type === 'total');
    expect(total?.amount).toBe(9000);
  });

  it('with discount codes and fixed_amount type', async () => {
    const applyCoupon = vi.fn().mockResolvedValue({
      amount: 500,
      type: 'fixed_amount',
      description: '$5 off',
    });
    const adapter = makeMockAdapter({ applyCoupon });
    const items = [makeLineItem({ subtotal: 3000 })];

    const result = await computeCheckoutTotals(items, ['FLAT5'], 0, adapter, 'cart-2');

    expect(result.discounts!.applied[0]!.amount).toBe(500);
    const total = result.totals.find((t) => t.type === 'total');
    expect(total?.amount).toBe(2500);
  });

  it('handles adapter without applyCoupon method gracefully', async () => {
    // Adapter exists but has no applyCoupon method
    const adapter = makeMockAdapter();
    const items = [makeLineItem({ subtotal: 5000 })];

    const result = await computeCheckoutTotals(items, ['CODE1'], 0, adapter, 'cart-3');

    // processDiscounts returns codes with empty applied when no applyCoupon
    expect(result.discounts).not.toBeNull();
    expect(result.discounts!.codes).toEqual(['CODE1']);
    expect(result.discounts!.applied).toEqual([]);

    const total = result.totals.find((t) => t.type === 'total');
    expect(total?.amount).toBe(5000);
  });

  it('handles missing cartId gracefully', async () => {
    const applyCoupon = vi.fn();
    const adapter = makeMockAdapter({ applyCoupon });
    const items = [makeLineItem({ subtotal: 5000 })];

    const result = await computeCheckoutTotals(items, ['CODE1'], 0, adapter, undefined);

    // No cartId means processDiscounts skips adapter call
    expect(applyCoupon).not.toHaveBeenCalled();
    expect(result.discounts!.applied).toEqual([]);
  });

  it('with fulfillment cost adds to total', async () => {
    const items = [makeLineItem({ subtotal: 2000 })];

    const result = await computeCheckoutTotals(items, undefined, 500);

    const fulfillmentEntry = result.totals.find((t) => t.type === 'fulfillment');
    expect(fulfillmentEntry?.amount).toBe(500);

    const total = result.totals.find((t) => t.type === 'total');
    expect(total?.amount).toBe(2500);
  });

  it('with discount and fulfillment cost computes correct total', async () => {
    const applyCoupon = vi.fn().mockResolvedValue({
      amount: 1000,
      type: 'fixed_amount',
      description: '$10 off',
    });
    const adapter = makeMockAdapter({ applyCoupon });
    const items = [makeLineItem({ subtotal: 5000 })];

    const result = await computeCheckoutTotals(items, ['OFF10'], 750, adapter, 'cart-4');

    const total = result.totals.find((t) => t.type === 'total');
    // 5000 - 1000 + 750 = 4750
    expect(total?.amount).toBe(4750);
  });

  it('silently ignores unknown coupon codes that throw', async () => {
    const applyCoupon = vi.fn().mockRejectedValue(new Error('Coupon not found'));
    const adapter = makeMockAdapter({ applyCoupon });
    const items = [makeLineItem({ subtotal: 2000 })];

    const result = await computeCheckoutTotals(items, ['INVALID'], 0, adapter, 'cart-5');

    expect(applyCoupon).toHaveBeenCalledWith('cart-5', 'INVALID');
    expect(result.discounts!.applied).toEqual([]);
    const total = result.totals.find((t) => t.type === 'total');
    expect(total?.amount).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// fulfillment: getStoredAddresses returns empty (no mock data)
// ---------------------------------------------------------------------------

describe('fulfillment: getStoredAddresses returns empty array', () => {
  it('buildFulfillmentForCreate with shipping type and no stored addresses yields no pre-populated destinations', async () => {
    // When no destinations provided in the request, and getStoredAddresses returns [],
    // the resolved destinations should be undefined
    const result = await buildFulfillmentForCreate(
      { methods: [{ type: 'shipping' }] },
      [makeSessionLineItem({ itemId: 'item-1', price: 1000, quantity: 1 })],
      'user@example.com',
    );

    expect(result).not.toBeNull();
    expect(result!.methods).toHaveLength(1);
    // No client destinations provided, stored returns empty => undefined
    expect(result!.methods[0]!.destinations).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// fulfillment: resolveItemPrice uses line item price from session
// ---------------------------------------------------------------------------

describe('fulfillment: resolveItemPrice uses session line item price', () => {
  it('computeTotalsWithFulfillment uses price from line items, not mock products', () => {
    const lineItems = [
      makeSessionLineItem({ id: 'li-0', itemId: 'prod-abc', price: 2500, quantity: 2 }),
      makeSessionLineItem({ id: 'li-1', itemId: 'prod-xyz', price: 1000, quantity: 1 }),
    ];

    const session = {
      id: 'sess-1',
      tenant_id: 'tenant-1',
      cart_id: null,
      status: 'incomplete' as const,
      line_items: lineItems,
      currency: 'USD',
      totals: [],
      links: [],
      buyer: null,
      shipping_address: null,
      billing_address: null,
      order: null,
      fulfillment: null,
      discounts: null,
      continue_url: null,
      messages: [],
      escalation: null,
      idempotency_key: null,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      created_at: new Date().toISOString(),
    };

    const totals = computeTotalsWithFulfillment(session, null);

    // subtotal = (2500 * 2) + (1000 * 1) = 6000
    const subtotal = totals.find((t) => t.type === 'subtotal');
    expect(subtotal?.amount).toBe(6000);

    const total = totals.find((t) => t.type === 'total');
    expect(total?.amount).toBe(6000);
  });

  it('resolveItemPrice returns 0 when line item has no price', () => {
    const lineItems = [
      {
        id: 'li-0',
        item: { id: 'prod-no-price', title: 'No Price' },
        quantity: 3,
        totals: makeLineItemTotals(0) as Total[],
      },
    ];

    const session = {
      id: 'sess-2',
      tenant_id: 'tenant-1',
      cart_id: null,
      status: 'incomplete' as const,
      line_items: lineItems,
      currency: 'USD',
      totals: [],
      links: [],
      buyer: null,
      shipping_address: null,
      billing_address: null,
      order: null,
      fulfillment: null,
      discounts: null,
      continue_url: null,
      messages: [],
      escalation: null,
      idempotency_key: null,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      created_at: new Date().toISOString(),
    };

    const totals = computeTotalsWithFulfillment(session, null);

    const subtotal = totals.find((t) => t.type === 'subtotal');
    expect(subtotal?.amount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fulfillment: generateShippingOptions still works as mock fallback
// ---------------------------------------------------------------------------

describe('fulfillment: generateShippingOptions mock fallback', () => {
  it('generates US shipping options when destination is US', async () => {
    const lineItems = [
      makeSessionLineItem({ id: 'li-0', itemId: 'item-1', price: 500, quantity: 1 }),
    ];

    const result = await buildFulfillmentForCreate(
      {
        methods: [
          {
            type: 'shipping',
            destinations: [{ id: 'dest_1', address_country: 'US' }],
            selected_destination_id: 'dest_1',
          },
        ],
      },
      lineItems,
      undefined,
    );

    expect(result).not.toBeNull();
    const group = result!.methods[0]!.groups[0]!;
    expect(group.options).toBeDefined();
    expect(group.options!.length).toBeGreaterThanOrEqual(2);

    const ids = group.options!.map((o) => o.id);
    expect(ids).toContain('std-ship');
    expect(ids).toContain('exp-ship-us');
  });

  it('generates international shipping options for non-US destination', async () => {
    const lineItems = [
      makeSessionLineItem({ id: 'li-0', itemId: 'item-1', price: 500, quantity: 1 }),
    ];

    const result = await buildFulfillmentForCreate(
      {
        methods: [
          {
            type: 'shipping',
            destinations: [{ id: 'dest_1', address_country: 'DE' }],
            selected_destination_id: 'dest_1',
          },
        ],
      },
      lineItems,
      undefined,
    );

    expect(result).not.toBeNull();
    const group = result!.methods[0]!.groups[0]!;
    expect(group.options).toBeDefined();

    const ids = group.options!.map((o) => o.id);
    expect(ids).toContain('std-ship');
    expect(ids).toContain('exp-ship-intl');
  });

  it('generates free shipping when subtotal exceeds threshold', async () => {
    const lineItems = [
      makeSessionLineItem({ id: 'li-0', itemId: 'item-1', price: 15000, quantity: 1 }),
    ];

    const result = await buildFulfillmentForCreate(
      {
        methods: [
          {
            type: 'shipping',
            destinations: [{ id: 'dest_1', address_country: 'US' }],
            selected_destination_id: 'dest_1',
          },
        ],
      },
      lineItems,
      undefined,
    );

    const group = result!.methods[0]!.groups[0]!;
    const stdOption = group.options!.find((o) => o.id === 'std-ship')!;
    const stdTotal = stdOption.totals.find((t) => t.type === 'total');
    expect(stdTotal?.amount).toBe(0);
  });

  it('getSelectedFulfillmentCost returns cost of selected option', () => {
    const fulfillment: Fulfillment = {
      methods: [
        {
          id: 'method_0',
          type: 'shipping',
          line_item_ids: ['li-0'],
          groups: [
            {
              id: 'group_0',
              line_item_ids: ['li-0'],
              options: [
                {
                  id: 'std-ship',
                  title: 'Standard Shipping',
                  totals: [
                    { type: 'subtotal', amount: 500 },
                    { type: 'tax', amount: 0 },
                    { type: 'total', amount: 500 },
                  ],
                },
              ],
              selected_option_id: 'std-ship',
            },
          ],
        },
      ],
    };

    expect(getSelectedFulfillmentCost(fulfillment)).toBe(500);
  });

  it('getSelectedFulfillmentCost returns 0 when no fulfillment', () => {
    expect(getSelectedFulfillmentCost(null)).toBe(0);
  });
});
