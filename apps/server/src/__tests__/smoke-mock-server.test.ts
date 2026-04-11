import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, TEST_DOMAIN } from './test-helpers.js';

const HEADERS = { host: TEST_DOMAIN, 'ucp-agent': 'test-agent/1.0' };
const JSON_HEADERS = { ...HEADERS, 'content-type': 'application/json' };
const UCP_VERSION = '2026-04-08';

let app: FastifyInstance;

beforeAll(async () => {
  ({ app } = await buildTestApp());
});

afterAll(async () => {
  await app.close();
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 1. Full checkout flow: discover → search → create → update → complete → order → adjust
 * ───────────────────────────────────────────────────────────────────────── */

describe('Full checkout flow (SDK 2.0.0)', () => {
  let sessionId: string;
  let orderId: string;

  it('1. discovery profile returns version 2026-04-08', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/ucp',
      headers: { host: TEST_DOMAIN },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    const ucp = body['ucp'] as Record<string, unknown>;
    expect(ucp['version']).toBe(UCP_VERSION);
    expect(ucp).toHaveProperty('capabilities');
    expect(ucp).toHaveProperty('services');
    expect(body).toHaveProperty('signing_keys');
  });

  it('2. product search returns results', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ucp/products?q=shoes',
      headers: HEADERS,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(Array.isArray(body['products'])).toBe(true);
    expect((body['products'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('3. create checkout session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        line_items: [{ item: { id: 'prod-001' }, quantity: 2 }],
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).toHaveProperty('id');
    expect(body['status']).toBe('incomplete');
    expect(body['currency']).toBe('USD');
    expect(body).toHaveProperty('line_items');
    expect(body).toHaveProperty('totals');
    expect(body).toHaveProperty('links');

    const ucp = body['ucp'] as Record<string, unknown>;
    expect(ucp['version']).toBe(UCP_VERSION);
    expect(ucp['status']).toBe('success');
    expect(ucp).toHaveProperty('capabilities');

    sessionId = body['id'] as string;
  });

  it('4. update session with buyer + fulfillment', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/checkout-sessions/${sessionId}`,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        id: sessionId,
        line_items: [{ item: { id: 'prod-001' }, quantity: 2 }],
        buyer: {
          first_name: 'Test',
          last_name: 'Buyer',
          email: 'test@example.com',
          shipping_address: {
            street_address: '123 Main St',
            address_locality: 'Austin',
            postal_code: '78701',
            address_country: 'US',
          },
        },
        fulfillment: {
          methods: [
            {
              type: 'shipping',
              destinations: [{ id: 'dest_1', address_country: 'US' }],
              selected_destination_id: 'dest_1',
              groups: [{ selected_option_id: 'std-ship' }],
            },
          ],
        },
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body['id']).toBe(sessionId);
    expect(body['currency']).toBe('USD');
    expect((body['ucp'] as Record<string, unknown>)['version']).toBe(UCP_VERSION);
  });

  it('5. complete session creates order with currency', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/checkout-sessions/${sessionId}/complete`,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        payment: {
          instruments: [
            {
              id: 'inst-1',
              handler_id: 'mock',
              type: 'card',
              selected: true,
              credential: { type: 'test_token' },
            },
          ],
        },
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body['status']).toBe('completed');
    expect(body['currency']).toBe('USD');
    expect((body['ucp'] as Record<string, unknown>)['version']).toBe(UCP_VERSION);

    const order = body['order'] as Record<string, unknown>;
    expect(order).toHaveProperty('id');
    orderId = order['id'] as string;
  });

  it('6. get order includes currency (SDK 2.0.0 required field)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/orders/${orderId}`,
      headers: HEADERS,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body['id']).toBe(orderId);
    expect(body['currency']).toBe('USD');
    expect(body).toHaveProperty('totals');
    expect(body).toHaveProperty('line_items');
    expect(body).toHaveProperty('fulfillment');
    expect((body['ucp'] as Record<string, unknown>)['version']).toBe(UCP_VERSION);
  });

  it('7. order adjustment uses totals[] not amount (SDK 2.0.0 format)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/orders/${orderId}`,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        adjustment: {
          type: 'refund',
          status: 'completed',
          amount: 5000,
          description: 'Customer return',
          line_items: [{ id: 'li-0', quantity: 1 }],
        },
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    const adjustments = body['adjustments'] as Record<string, unknown>[];
    expect(adjustments).toHaveLength(1);

    const adj = adjustments[0]!;
    expect(adj['type']).toBe('refund');
    expect(adj['status']).toBe('completed');
    expect(adj).toHaveProperty('id');
    expect(adj).toHaveProperty('occurred_at');
    expect(adj).not.toHaveProperty('amount');

    const totals = adj['totals'] as { type: string; amount: number }[];
    expect(totals).toHaveLength(1);
    expect(totals[0]!.type).toBe('total');
    expect(totals[0]!.amount).toBe(5000);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 2. Cart CRUD
 * ───────────────────────────────────────────────────────────────────────── */

describe('Cart CRUD', () => {
  let cartId: string;

  it('POST /ucp/cart creates a cart with ucp envelope', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ucp/cart',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        line_items: [{ item: { id: 'prod-001' }, quantity: 3 }],
        currency: 'USD',
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('line_items');
    const ucp = body['ucp'] as Record<string, unknown>;
    expect(ucp['version']).toBe(UCP_VERSION);
    cartId = body['id'] as string;
  });

  it('GET /ucp/cart/:id returns the cart with ucp version', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/ucp/cart/${cartId}`,
      headers: HEADERS,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body['id']).toBe(cartId);
    expect(body).toHaveProperty('line_items');
    expect((body['ucp'] as Record<string, unknown>)['version']).toBe(UCP_VERSION);
  });

  it('PUT /ucp/cart/:id updates the cart', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/ucp/cart/${cartId}`,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        line_items: [
          { item: { id: 'prod-001' }, quantity: 1 },
          { item: { id: 'prod-002' }, quantity: 2 },
        ],
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body['id']).toBe(cartId);
    expect((body['ucp'] as Record<string, unknown>)['version']).toBe(UCP_VERSION);
  });

  it('GET /ucp/cart/:unknown returns 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ucp/cart/nonexistent-cart-id',
      headers: HEADERS,
    });

    expect(res.statusCode).toBe(404);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 3. Catalog search + lookup
 * ───────────────────────────────────────────────────────────────────────── */

describe('Catalog search and lookup', () => {
  it('POST /ucp/catalog/search returns UCP envelope with version', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ucp/catalog/search',
      headers: JSON_HEADERS,
      payload: { q: 'test' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    const ucp = body['ucp'] as Record<string, unknown>;
    expect(ucp['version']).toBe(UCP_VERSION);
    expect(body).toHaveProperty('products');
    expect(body).toHaveProperty('pagination');
  });

  it('POST /ucp/catalog/product returns single product with UCP envelope', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ucp/catalog/product',
      headers: JSON_HEADERS,
      payload: { id: 'prod-001' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    const ucp = body['ucp'] as Record<string, unknown>;
    expect(ucp['version']).toBe(UCP_VERSION);
    expect(body).toHaveProperty('product');
  });

  it('POST /ucp/catalog/product with unknown id returns 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ucp/catalog/product',
      headers: JSON_HEADERS,
      payload: { id: 'nonexistent-product' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('POST /ucp/catalog/product with empty id returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ucp/catalog/product',
      headers: JSON_HEADERS,
      payload: { id: '' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /ucp/catalog/search with string limit returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ucp/catalog/search',
      headers: JSON_HEADERS,
      payload: { q: 'test', limit: '20' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('GET /ucp/products/:id returns single product detail', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ucp/products/prod-001',
      headers: HEADERS,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).toHaveProperty('id', 'prod-001');
    expect(body).toHaveProperty('title');
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 4. Session lifecycle: fetch + cancel
 * ───────────────────────────────────────────────────────────────────────── */

describe('Session lifecycle', () => {
  let incompleteSessionId: string;
  let completedSessionId: string;

  it('create sessions for lifecycle tests', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        line_items: [{ item: { id: 'prod-002' }, quantity: 1 }],
      }),
    });
    expect(res.statusCode).toBe(201);
    incompleteSessionId = (JSON.parse(res.body) as Record<string, unknown>)['id'] as string;

    const createRes2 = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
      }),
    });
    completedSessionId = (JSON.parse(createRes2.body) as Record<string, unknown>)['id'] as string;

    await app.inject({
      method: 'PUT',
      url: `/checkout-sessions/${completedSessionId}`,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        id: completedSessionId,
        line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
        buyer: {
          first_name: 'A',
          last_name: 'B',
          shipping_address: {
            street_address: '1 St',
            address_locality: 'X',
            postal_code: '00000',
            address_country: 'US',
          },
        },
        fulfillment: {
          methods: [
            {
              type: 'shipping',
              destinations: [{ id: 'd1', address_country: 'US' }],
              selected_destination_id: 'd1',
              groups: [{ selected_option_id: 'std-ship' }],
            },
          ],
        },
      }),
    });

    await app.inject({
      method: 'POST',
      url: `/checkout-sessions/${completedSessionId}/complete`,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        payment: {
          instruments: [
            {
              id: 'i1',
              handler_id: 'mock',
              type: 'card',
              selected: true,
              credential: { type: 'test_token' },
            },
          ],
        },
      }),
    });
  });

  it('GET /checkout-sessions/:id fetches session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/checkout-sessions/${incompleteSessionId}`,
      headers: HEADERS,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body['id']).toBe(incompleteSessionId);
    expect(body['status']).toBe('incomplete');
    expect((body['ucp'] as Record<string, unknown>)['version']).toBe(UCP_VERSION);
  });

  it('POST /checkout-sessions/:id/cancel cancels incomplete session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/checkout-sessions/${incompleteSessionId}/cancel`,
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body['status']).toBe('canceled');
    expect((body['ucp'] as Record<string, unknown>)['version']).toBe(UCP_VERSION);
  });

  it('cancel is idempotent on already-canceled session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/checkout-sessions/${incompleteSessionId}/cancel`,
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(200);
    expect((JSON.parse(res.body) as Record<string, unknown>)['status']).toBe('canceled');
  });

  it('cancel on completed session returns 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/checkout-sessions/${completedSessionId}/cancel`,
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(409);
  });

  it('GET /checkout-sessions/:unknown returns 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/checkout-sessions/nonexistent-session-id',
      headers: HEADERS,
    });

    expect(res.statusCode).toBe(404);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 5. Error handling
 * ───────────────────────────────────────────────────────────────────────── */

describe('Error handling', () => {
  it('POST /checkout-sessions with no line_items key returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: JSON_HEADERS,
      body: JSON.stringify({ currency: 'USD' }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /checkout-sessions with missing body returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /checkout-sessions with invalid product returns error', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        line_items: [{ item: { id: 'nonexistent-product-xyz' }, quantity: 1 }],
      }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('complete without payment returns 400', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
      }),
    });
    const sid = (JSON.parse(createRes.body) as Record<string, unknown>)['id'] as string;

    const res = await app.inject({
      method: 'POST',
      url: `/checkout-sessions/${sid}/complete`,
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(400);
  });

  it('GET /orders/:unknown returns 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/orders/nonexistent-order-id',
      headers: HEADERS,
    });

    expect(res.statusCode).toBe(404);
  });

  it('PUT /orders/:unknown returns 404', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/orders/nonexistent-order-id',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        fulfillment_event: {
          type: 'shipped',
          line_items: [{ id: 'li-0', quantity: 1 }],
        },
      }),
    });

    expect(res.statusCode).toBe(404);
  });

  it('requests without ucp-agent header return 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ucp/products?q=test',
      headers: { host: TEST_DOMAIN },
    });

    expect(res.statusCode).toBe(401);
  });

  it('requests to unknown host return 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/ucp',
      headers: { host: 'unknown-store.example.com' },
    });

    expect(res.statusCode).toBe(404);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 6. Discovery profile structure
 * ───────────────────────────────────────────────────────────────────────── */

describe('Discovery profile structure', () => {
  it('profile includes all gateway capabilities', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/ucp',
      headers: { host: TEST_DOMAIN },
    });

    const body = JSON.parse(res.body) as Record<string, unknown>;
    const ucp = body['ucp'] as Record<string, unknown>;
    const capabilities = ucp['capabilities'] as Record<string, unknown>;

    expect(capabilities).toHaveProperty('dev.ucp.shopping.checkout');
    expect(capabilities).toHaveProperty('dev.ucp.shopping.catalog');
    expect(capabilities).toHaveProperty('dev.ucp.shopping.cart');
    expect(capabilities).toHaveProperty('dev.ucp.shopping.fulfillment');
    expect(capabilities).toHaveProperty('dev.ucp.shopping.discount');
    expect(capabilities).toHaveProperty('dev.ucp.shopping.buyer_consent');
    expect(capabilities).toHaveProperty('dev.ucp.shopping.embedded_checkout');
    expect(capabilities).toHaveProperty('dev.ucp.shopping.identity_linking');
    expect(capabilities).toHaveProperty('dev.ucp.shopping.ap2_mandate');
  });

  it('profile includes signing_keys with valid JWK structure', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/ucp',
      headers: { host: TEST_DOMAIN },
    });

    const body = JSON.parse(res.body) as Record<string, unknown>;
    const keys = body['signing_keys'] as Record<string, unknown>[];
    expect(Array.isArray(keys)).toBe(true);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys[0]).toHaveProperty('kty');
    expect(keys[0]).toHaveProperty('kid');
    expect(keys[0]).toHaveProperty('crv');
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 7. Order fulfillment events
 * ───────────────────────────────────────────────────────────────────────── */

describe('Order fulfillment events', () => {
  let orderId: string;

  it('setup: create and complete a checkout', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
      }),
    });
    const sessionId = (JSON.parse(createRes.body) as Record<string, unknown>)['id'] as string;

    await app.inject({
      method: 'PUT',
      url: `/checkout-sessions/${sessionId}`,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        id: sessionId,
        line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
        buyer: {
          first_name: 'Ship',
          last_name: 'Test',
          shipping_address: {
            street_address: '456 Oak Ave',
            address_locality: 'Portland',
            postal_code: '97201',
            address_country: 'US',
          },
        },
        fulfillment: {
          methods: [
            {
              type: 'shipping',
              destinations: [{ id: 'd1', address_country: 'US' }],
              selected_destination_id: 'd1',
              groups: [{ selected_option_id: 'std-ship' }],
            },
          ],
        },
      }),
    });

    const completeRes = await app.inject({
      method: 'POST',
      url: `/checkout-sessions/${sessionId}/complete`,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        payment: {
          instruments: [
            {
              id: 'inst-1',
              handler_id: 'mock',
              type: 'card',
              selected: true,
              credential: { type: 'test_token' },
            },
          ],
        },
      }),
    });
    const completed = JSON.parse(completeRes.body) as Record<string, unknown>;
    orderId = (completed['order'] as Record<string, unknown>)['id'] as string;
  });

  it('PUT /orders/:id with shipped event adds fulfillment event', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/orders/${orderId}`,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        fulfillment_event: {
          type: 'shipped',
          line_items: [{ id: 'li-0', quantity: 1 }],
          tracking_number: 'TRACK-123',
          carrier: 'UPS',
        },
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    const fulfillment = body['fulfillment'] as Record<string, unknown>;
    const events = fulfillment['events'] as Record<string, unknown>[];
    expect(events.length).toBeGreaterThanOrEqual(1);

    const shipped = events.find((e) => e['type'] === 'shipped');
    expect(shipped).toBeDefined();
    expect(shipped!['tracking_number']).toBe('TRACK-123');
    expect(shipped!['carrier']).toBe('UPS');
  });

  it('PUT /orders/:id with delivered event marks fulfillment complete', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/orders/${orderId}`,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        fulfillment_event: {
          type: 'delivered',
          line_items: [{ id: 'li-0', quantity: 1 }],
        },
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    const fulfillment = body['fulfillment'] as Record<string, unknown>;
    const events = fulfillment['events'] as Record<string, unknown>[];
    const delivered = events.find((e) => e['type'] === 'delivered');
    expect(delivered).toBeDefined();
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * 8. Multi-item checkout
 * ───────────────────────────────────────────────────────────────────────── */

describe('Multi-item checkout', () => {
  it('checkout with multiple line items has correct totals', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        line_items: [
          { item: { id: 'prod-001' }, quantity: 2 },
          { item: { id: 'prod-002' }, quantity: 1 },
        ],
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    const lineItems = body['line_items'] as unknown[];
    expect(lineItems.length).toBe(2);

    const totals = body['totals'] as { type: string; amount: number }[];
    expect(totals.length).toBeGreaterThan(0);
    const total = totals.find((t) => t.type === 'total');
    expect(total).toBeDefined();
    expect(total!.amount).toBeGreaterThan(0);
  });

  it('checkout with EUR currency passes through', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
        currency: 'EUR',
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body['currency']).toBe('EUR');
  });
});
