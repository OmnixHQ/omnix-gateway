import type { Product, UCPProfile, FulfillmentDestination } from '@ucp-gateway/core';

/* ---------------------------------------------------------------------------
 * Mock customer / address data (mirrors test_data CSVs)
 * ------------------------------------------------------------------------- */

export interface MockCustomer {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export const MOCK_CUSTOMERS: readonly MockCustomer[] = [
  { id: 'cust_1', name: 'John Doe', email: 'john.doe@example.com' },
  { id: 'cust_2', name: 'Jane Smith', email: 'jane.smith@example.com' },
  { id: 'cust_3', name: 'Jane Doe', email: 'jane.doe@example.com' },
];

export interface MockAddress {
  readonly id: string;
  readonly customer_id: string;
  readonly street_address: string;
  readonly city: string;
  readonly state: string;
  readonly postal_code: string;
  readonly country: string;
}

export const MOCK_ADDRESSES: readonly MockAddress[] = [
  {
    id: 'addr_1',
    customer_id: 'cust_1',
    street_address: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    postal_code: '62704',
    country: 'US',
  },
  {
    id: 'addr_2',
    customer_id: 'cust_1',
    street_address: '456 Oak Ave',
    city: 'Metropolis',
    state: 'NY',
    postal_code: '10012',
    country: 'US',
  },
  {
    id: 'addr_3',
    customer_id: 'cust_2',
    street_address: '789 Pine Ln',
    city: 'Smallville',
    state: 'KS',
    postal_code: '66002',
    country: 'US',
  },
];

/** Items eligible for free shipping regardless of order value. */
export const FREE_SHIPPING_ITEM_IDS: readonly string[] = ['bouquet_roses'];

/** Order subtotal threshold (in cents) above which standard shipping is free. */
export const FREE_SHIPPING_THRESHOLD_CENTS = 10000;

/**
 * Convert a MockAddress to a FulfillmentDestination.
 */
export function toFulfillmentDestination(addr: MockAddress): FulfillmentDestination {
  return {
    id: addr.id,
    street_address: addr.street_address,
    address_locality: addr.city,
    address_region: addr.state,
    postal_code: addr.postal_code,
    address_country: addr.country,
  };
}

export const MOCK_PROFILE: UCPProfile = {
  ucp: {
    version: '2026-01-23',
    services: {
      'dev.ucp.shopping': {
        version: '2026-01-23',
        spec: 'https://ucp.dev/latest/specification/checkout/',
        rest: {
          schema: 'https://ucp.dev/2026-01-23/schemas/shopping/checkout.json',
          endpoint: 'http://localhost:3000',
        },
      },
    },
    capabilities: [
      {
        name: 'dev.ucp.shopping.checkout',
        version: '2026-01-23',
        spec: 'https://ucp.dev/latest/specification/checkout/',
        schema: 'https://ucp.dev/2026-01-23/schemas/shopping/checkout.json',
      },
      {
        name: 'dev.ucp.shopping.fulfillment',
        version: '2026-01-23',
        spec: 'https://ucp.dev/latest/specification/fulfillment/',
        schema: 'https://ucp.dev/2026-01-23/schemas/shopping/fulfillment.json',
        extends: 'dev.ucp.shopping.checkout',
      },
      {
        name: 'dev.ucp.shopping.discounts',
        version: '2026-01-23',
        spec: 'https://ucp.dev/latest/specification/discounts/',
        schema: 'https://ucp.dev/2026-01-23/schemas/shopping/discounts.json',
        extends: 'dev.ucp.shopping.checkout',
      },
    ],
  },
  signing_keys: [],
  payment: {
    handlers: [
      {
        id: 'mock_payment_handler',
        name: 'dev.ucp.mock_payment',
        version: '2026-01-23',
        spec: 'https://ucp.dev/latest/specification/overview/',
        config_schema: 'https://ucp.dev/latest/specification/overview/',
        instrument_schemas: [],
        config: {},
      },
    ],
  },
};

/* ---------------------------------------------------------------------------
 * Discount codes
 * ------------------------------------------------------------------------- */

export interface MockDiscount {
  readonly code: string;
  readonly type: 'percentage' | 'fixed_amount';
  readonly value: number;
  readonly description: string;
}

export const MOCK_DISCOUNTS: readonly MockDiscount[] = [
  { code: '10OFF', type: 'percentage', value: 10, description: '10% Off' },
  { code: 'WELCOME20', type: 'percentage', value: 20, description: '20% Off' },
  { code: 'FIXED500', type: 'fixed_amount', value: 500, description: '$5.00 Off' },
];

export const MOCK_PRODUCTS: readonly Product[] = [
  {
    id: 'bouquet_roses',
    title: 'Red Rose',
    description: 'A beautiful bouquet of red roses.',
    price_cents: 3500,
    currency: 'USD',
    in_stock: true,
    stock_quantity: 100,
    images: ['https://mock.store/images/bouquet-roses-1.jpg'],
    variants: [
      {
        id: 'var-roses-a',
        title: 'Standard',
        price_cents: 3500,
        in_stock: true,
        attributes: { size: 'standard' },
      },
    ],
  },
  {
    id: 'gardenias',
    title: 'Gardenias',
    description: 'Beautiful gardenias flower arrangement.',
    price_cents: 2000,
    currency: 'USD',
    in_stock: false,
    stock_quantity: 0,
    images: ['https://mock.store/images/gardenias-1.jpg'],
    variants: [],
  },
  {
    id: 'prod-001',
    title: 'Running Shoes Pro',
    description: 'High-performance running shoes with advanced cushioning.',
    price_cents: 12999,
    currency: 'USD',
    in_stock: true,
    stock_quantity: 50,
    images: ['https://mock.store/images/shoes-pro-1.jpg'],
    variants: [
      {
        id: 'var-001a',
        title: 'Size 9',
        price_cents: 12999,
        in_stock: true,
        attributes: { size: '9' },
      },
      {
        id: 'var-001b',
        title: 'Size 10',
        price_cents: 12999,
        in_stock: true,
        attributes: { size: '10' },
      },
    ],
  },
  {
    id: 'prod-002',
    title: 'Casual Sneakers',
    description: 'Comfortable everyday sneakers with breathable mesh upper.',
    price_cents: 7999,
    currency: 'USD',
    in_stock: true,
    stock_quantity: 120,
    images: ['https://mock.store/images/sneakers-1.jpg'],
    variants: [
      {
        id: 'var-002a',
        title: 'White / Size 9',
        price_cents: 7999,
        in_stock: true,
        attributes: { color: 'white', size: '9' },
      },
      {
        id: 'var-002b',
        title: 'Black / Size 10',
        price_cents: 7999,
        in_stock: true,
        attributes: { color: 'black', size: '10' },
      },
    ],
  },
  {
    id: 'prod-003',
    title: 'Hiking Boots',
    description: 'Waterproof hiking boots with ankle support and Vibram sole.',
    price_cents: 18999,
    currency: 'USD',
    in_stock: true,
    stock_quantity: 30,
    images: ['https://mock.store/images/hiking-boots-1.jpg'],
    variants: [
      {
        id: 'var-003a',
        title: 'Size 10',
        price_cents: 18999,
        in_stock: true,
        attributes: { size: '10' },
      },
    ],
  },
  {
    id: 'prod-004',
    title: 'Leather Loafers',
    description: 'Classic Italian leather loafers for formal occasions.',
    price_cents: 24999,
    currency: 'USD',
    in_stock: true,
    stock_quantity: 15,
    images: ['https://mock.store/images/loafers-1.jpg'],
    variants: [
      {
        id: 'var-004a',
        title: 'Brown / Size 9',
        price_cents: 24999,
        in_stock: true,
        attributes: { color: 'brown', size: '9' },
      },
    ],
  },
  {
    id: 'prod-005',
    title: 'Sport Sandals',
    description: 'Lightweight sport sandals with adjustable straps.',
    price_cents: 4999,
    currency: 'USD',
    in_stock: true,
    stock_quantity: 200,
    images: ['https://mock.store/images/sandals-1.jpg'],
    variants: [
      {
        id: 'var-005a',
        title: 'Size 9',
        price_cents: 4999,
        in_stock: true,
        attributes: { size: '9' },
      },
    ],
  },
];
