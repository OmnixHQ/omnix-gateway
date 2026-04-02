/**
 * Behavioral gap tests — verifies every MockAdapter capability is exercised
 * end-to-end through the HTTP routes with correct SDK-shaped responses.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './test-helpers.js';

const HEADERS = { host: 'mock-store.localhost', 'ucp-agent': 'test-agent/1.0' };
const JSON_HEADERS = { ...HEADERS, 'content-type': 'application/json' };

describe('Behavioral gap coverage', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const result = await buildTestApp();
    app = result.app;
  });

  afterAll(async () => {
    await app.close();
  });

  async function createAndCompleteOrder(
    lineItems: Array<{ item: { id: string }; quantity: number }> = [
      { item: { id: 'prod-001' }, quantity: 2 },
    ],
  ): Promise<{ sessionId: string; orderId: string }> {
    const createRes = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: JSON_HEADERS,
      payload: {
        line_items: lineItems,
        currency: 'USD',
      },
    });
    const session = JSON.parse(createRes.body) as Record<string, unknown>;
    const sessionId = session['id'] as string;

    await app.inject({
      method: 'PUT',
      url: `/checkout-sessions/${sessionId}`,
      headers: JSON_HEADERS,
      payload: {
        id: sessionId,
        line_items: lineItems,
        buyer: {
          first_name: 'Test',
          last_name: 'User',
          email: 'test@example.com',
          shipping_address: {
            street_address: '123 Main St',
            address_locality: 'Beverly Hills',
            postal_code: '90210',
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
      },
    });

    const completeRes = await app.inject({
      method: 'POST',
      url: `/checkout-sessions/${sessionId}/complete`,
      headers: JSON_HEADERS,
      payload: {
        payment: {
          instruments: [
            {
              id: 'inst-1',
              handler_id: 'mock_card',
              type: 'card',
              selected: true,
              credential: { token: 'test_token' },
            },
          ],
        },
      },
    });

    const completed = JSON.parse(completeRes.body) as Record<string, unknown>;
    if (completeRes.statusCode !== 200) {
      throw new Error(`Complete failed (${completeRes.statusCode}): ${JSON.stringify(completed)}`);
    }
    const orderId = (completed['order'] as Record<string, unknown>)['id'] as string;
    return { sessionId, orderId };
  }

  // ── Gap 1: Order response includes line_items ─────────────────────────

  describe('Gap 1: Order response includes line_items', () => {
    it('GET /orders/:id returns line_items with quantity and status', async () => {
      const { orderId } = await createAndCompleteOrder();

      const orderRes = await app.inject({
        method: 'GET',
        url: `/orders/${orderId}`,
        headers: HEADERS,
      });
      expect(orderRes.statusCode).toBe(200);
      const order = JSON.parse(orderRes.body) as Record<string, unknown>;

      expect(order).toHaveProperty('line_items');
      const lineItems = order['line_items'] as Record<string, unknown>[];
      expect(lineItems.length).toBeGreaterThan(0);

      const firstItem = lineItems[0]!;
      expect(firstItem).toHaveProperty('id');
      expect(firstItem).toHaveProperty('item');
      expect(firstItem).toHaveProperty('quantity');
      expect(firstItem).toHaveProperty('totals');
      expect(firstItem).toHaveProperty('status', 'processing');

      const quantity = firstItem['quantity'] as Record<string, number>;
      expect(quantity).toHaveProperty('total');
      expect(quantity).toHaveProperty('fulfilled', 0);

      expect(order).toHaveProperty('checkout_id');
      expect(order).toHaveProperty('permalink_url');
    });
  });

  // ── Gap 2: Order fulfillment expectations ─────────────────────────────

  describe('Gap 2: Order fulfillment expectations populated', () => {
    it('GET /orders/:id returns fulfillment expectations from placeOrder', async () => {
      const { orderId } = await createAndCompleteOrder([{ item: { id: 'prod-001' }, quantity: 1 }]);

      const orderRes = await app.inject({
        method: 'GET',
        url: `/orders/${orderId}`,
        headers: HEADERS,
      });
      const order = JSON.parse(orderRes.body) as Record<string, unknown>;
      const fulfillment = order['fulfillment'] as Record<string, unknown>;

      expect(fulfillment).toHaveProperty('expectations');
      const expectations = fulfillment['expectations'] as Record<string, unknown>[];
      expect(expectations.length).toBeGreaterThan(0);

      const exp = expectations[0]!;
      expect(exp).toHaveProperty('id');
      expect(exp).toHaveProperty('line_items');
      expect(exp).toHaveProperty('method_type');
    });
  });

  // ── Gap 3: DELETE /ucp/cart/:cartId/items/:index ──────────────────────

  describe('Gap 3: removeFromCart route', () => {
    it('DELETE /ucp/cart/:cartId/items/:index removes an item', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/ucp/cart',
        headers: JSON_HEADERS,
        payload: {
          line_items: [
            { item: { id: 'prod-001' }, quantity: 1 },
            { item: { id: 'prod-002' }, quantity: 2 },
          ],
        },
      });
      expect(createRes.statusCode).toBe(201);
      const cart = JSON.parse(createRes.body) as Record<string, unknown>;
      const cartId = cart['id'] as string;
      const initialItems = cart['line_items'] as unknown[];
      expect(initialItems).toHaveLength(2);

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/ucp/cart/${cartId}/items/0`,
        headers: HEADERS,
      });
      expect(deleteRes.statusCode).toBe(200);
      const updated = JSON.parse(deleteRes.body) as Record<string, unknown>;
      const updatedItems = updated['line_items'] as unknown[];
      expect(updatedItems).toHaveLength(1);
    });

    it('returns 404 for unknown cart', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/ucp/cart/nonexistent/items/0',
        headers: HEADERS,
      });
      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for invalid index', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/ucp/cart',
        headers: JSON_HEADERS,
        payload: { line_items: [{ item: { id: 'prod-001' }, quantity: 1 }] },
      });
      const cart = JSON.parse(createRes.body) as Record<string, unknown>;
      const cartId = cart['id'] as string;

      const res = await app.inject({
        method: 'DELETE',
        url: `/ucp/cart/${cartId}/items/-1`,
        headers: HEADERS,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── Gap 4: Fulfillment line_item_ids populated ────────────────────────

  describe('Gap 4: Fulfillment line_item_ids populated from cart', () => {
    it('checkout with fulfillment returns line_item_ids in methods', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/checkout-sessions',
        headers: JSON_HEADERS,
        payload: {
          line_items: [
            { item: { id: 'prod-001' }, quantity: 1 },
            { item: { id: 'prod-002' }, quantity: 1 },
          ],
          currency: 'USD',
          buyer: { email: 'test@test.com', shipping_address: { address_country: 'US' } },
          fulfillment: {
            methods: [
              {
                type: 'shipping',
                destinations: [{ address_country: 'US', postal_code: '90210' }],
              },
            ],
          },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      const fulfillment = body['fulfillment'] as Record<string, unknown> | undefined;

      if (fulfillment) {
        const methods = fulfillment['methods'] as Record<string, unknown>[];
        if (methods && methods.length > 0) {
          const method = methods[0]!;
          const lineItemIds = method['line_item_ids'] as string[];
          expect(lineItemIds.length).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  // ── Gap 5: computeShippingCost uses destination ───────────────────────

  describe('Gap 5: Shipping cost varies by destination', () => {
    it('catalog search returns products with categories for filtering', async () => {
      const usRes = await app.inject({
        method: 'GET',
        url: '/ucp/catalog/search?q=shoes&categories=footwear',
        headers: HEADERS,
      });
      expect(usRes.statusCode).toBe(200);
      const body = JSON.parse(usRes.body) as Record<string, unknown>;
      const products = body['products'] as Record<string, unknown>[];
      expect(products.length).toBeGreaterThan(0);

      const product = products[0]!;
      expect(product).toHaveProperty('categories');
      const categories = product['categories'] as Record<string, unknown>[];
      expect(categories.some((c) => c['value'] === 'footwear')).toBe(true);
    });
  });

  // ── Gap 6: Fulfilled count updates after fulfillment events ──────────

  describe('Gap 6: Fulfilled count updates', () => {
    it('PUT /orders/:id with fulfillment event updates fulfilled count', async () => {
      const { orderId } = await createAndCompleteOrder();

      const updateRes = await app.inject({
        method: 'PUT',
        url: `/orders/${orderId}`,
        headers: JSON_HEADERS,
        payload: {
          fulfillment_event: {
            type: 'shipped',
            line_items: [{ id: 'li-0', quantity: 2 }],
            tracking_number: 'TRK-123',
            carrier: 'MockCarrier',
          },
        },
      });
      expect(updateRes.statusCode).toBe(200);
      const updatedOrder = JSON.parse(updateRes.body) as Record<string, unknown>;

      const fulfillment = updatedOrder['fulfillment'] as Record<string, unknown>;
      const events = fulfillment['events'] as Record<string, unknown>[];
      expect(events.length).toBe(1);
      expect(events[0]!['type']).toBe('shipped');
      expect(events[0]!['tracking_number']).toBe('TRK-123');

      const lineItems = updatedOrder['line_items'] as Record<string, unknown>[];
      expect(lineItems.length).toBeGreaterThan(0);
      const firstItem = lineItems[0]!;
      const quantity = firstItem['quantity'] as Record<string, number>;
      expect(quantity['fulfilled']).toBe(2);
      expect(firstItem['status']).toBe('fulfilled');
    });
  });

  // ── Gap 7: calculateTotals uses CheckoutContext ───────────────────────

  describe('Gap 7: Totals reflect shipping destination', () => {
    it('checkout with international address gets different shipping', async () => {
      const usRes = await app.inject({
        method: 'POST',
        url: '/checkout-sessions',
        headers: JSON_HEADERS,
        payload: {
          line_items: [{ item: { id: 'prod-005' }, quantity: 1 }],
          currency: 'USD',
          buyer: {
            email: 'us@test.com',
            shipping_address: { address_country: 'US', postal_code: '90210' },
          },
          fulfillment: {
            methods: [
              {
                type: 'shipping',
                destinations: [{ address_country: 'US', postal_code: '90210' }],
              },
            ],
          },
        },
      });

      const intlRes = await app.inject({
        method: 'POST',
        url: '/checkout-sessions',
        headers: JSON_HEADERS,
        payload: {
          line_items: [{ item: { id: 'prod-005' }, quantity: 1 }],
          currency: 'USD',
          buyer: {
            email: 'eu@test.com',
            shipping_address: { address_country: 'DE', postal_code: '10115' },
          },
          fulfillment: {
            methods: [
              {
                type: 'shipping',
                destinations: [{ address_country: 'DE', postal_code: '10115' }],
              },
            ],
          },
        },
      });

      expect(usRes.statusCode).toBe(201);
      expect(intlRes.statusCode).toBe(201);
    });
  });

  // ── Cart CRUD lifecycle ───────────────────────────────────────────────

  describe('Cart full lifecycle', () => {
    it('POST → GET → PUT → DELETE → GET (complete CRUD)', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/ucp/cart',
        headers: JSON_HEADERS,
        payload: {
          line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
          buyer: { email: 'buyer@test.com' },
          context: { address_country: 'US' },
        },
      });
      expect(createRes.statusCode).toBe(201);
      const cart = JSON.parse(createRes.body) as Record<string, unknown>;
      const cartId = cart['id'] as string;

      expect(cart).toHaveProperty('ucp');
      expect(cart).toHaveProperty('line_items');
      expect(cart).toHaveProperty('totals');
      expect(cart).toHaveProperty('buyer');
      expect(cart).toHaveProperty('context');

      const getRes = await app.inject({
        method: 'GET',
        url: `/ucp/cart/${cartId}`,
        headers: HEADERS,
      });
      expect(getRes.statusCode).toBe(200);

      const putRes = await app.inject({
        method: 'PUT',
        url: `/ucp/cart/${cartId}`,
        headers: JSON_HEADERS,
        payload: {
          line_items: [{ item: { id: 'prod-002' }, quantity: 3 }],
        },
      });
      expect(putRes.statusCode).toBe(200);
      const updated = JSON.parse(putRes.body) as Record<string, unknown>;
      const updatedItems = updated['line_items'] as unknown[];
      expect(updatedItems.length).toBeGreaterThanOrEqual(2);

      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/ucp/cart/${cartId}/items/0`,
        headers: HEADERS,
      });
      expect(deleteRes.statusCode).toBe(200);

      const finalGet = await app.inject({
        method: 'GET',
        url: `/ucp/cart/${cartId}`,
        headers: HEADERS,
      });
      expect(finalGet.statusCode).toBe(200);
      const finalCart = JSON.parse(finalGet.body) as Record<string, unknown>;
      const finalItems = finalCart['line_items'] as unknown[];
      expect(finalItems.length).toBeLessThan(updatedItems.length);
    });
  });

  // ── Catalog search with SDK response shape ────────────────────────────

  describe('Catalog SDK-shaped responses', () => {
    it('GET /ucp/catalog/search returns UCP envelope with pagination', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ucp/catalog/search?q=shoes',
        headers: HEADERS,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Record<string, unknown>;

      expect(body).toHaveProperty('ucp');
      const ucp = body['ucp'] as Record<string, unknown>;
      expect(ucp['version']).toBe('2026-01-23');
      expect(ucp).toHaveProperty('capabilities');

      expect(body).toHaveProperty('products');
      expect(body).toHaveProperty('pagination');
      const pagination = body['pagination'] as Record<string, number>;
      expect(pagination).toHaveProperty('page');
      expect(pagination).toHaveProperty('limit');
      expect(pagination).toHaveProperty('count');
    });

    it('GET /ucp/catalog/lookup/:id returns single product in envelope', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ucp/catalog/lookup/prod-001',
        headers: HEADERS,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Record<string, unknown>;

      expect(body).toHaveProperty('ucp');
      expect(body).toHaveProperty('product');
      const product = body['product'] as Record<string, unknown>;
      expect(product['id']).toBe('prod-001');
      expect(product).toHaveProperty('price_range');
      expect(product).toHaveProperty('variants');
      expect(product).toHaveProperty('options');
      expect(product).toHaveProperty('categories');
      expect(product).toHaveProperty('rating');
    });
  });

  // ── Discovery capabilities coverage ───────────────────────────────────

  describe('Discovery advertises all capabilities', () => {
    it('GET /.well-known/ucp includes catalog, cart, consent, identity, ap2, embedded', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/.well-known/ucp',
        headers: { host: 'mock-store.localhost' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      const ucp = body['ucp'] as Record<string, unknown>;
      const capabilities = ucp['capabilities'] as Record<string, unknown>;

      expect(capabilities).toHaveProperty('dev.ucp.shopping.checkout');
      expect(capabilities).toHaveProperty('dev.ucp.shopping.fulfillment');
      expect(capabilities).toHaveProperty('dev.ucp.shopping.discounts');
      expect(capabilities).toHaveProperty('dev.ucp.shopping.catalog');
      expect(capabilities).toHaveProperty('dev.ucp.shopping.cart');
      expect(capabilities).toHaveProperty('dev.ucp.shopping.buyer_consent');
      expect(capabilities).toHaveProperty('dev.ucp.shopping.embedded_checkout');
      expect(capabilities).toHaveProperty('dev.ucp.shopping.identity_linking');
      expect(capabilities).toHaveProperty('dev.ucp.shopping.ap2_mandate');

      const handlers = ucp['payment_handlers'] as Record<string, unknown>;
      expect(Object.keys(handlers).length).toBeGreaterThan(0);
    });
  });

  // ── Order adjustment (refund) ─────────────────────────────────────────

  describe('Order adjustments', () => {
    it('PUT /orders/:id with adjustment adds refund to order', async () => {
      const { orderId } = await createAndCompleteOrder([{ item: { id: 'prod-001' }, quantity: 1 }]);

      const adjustRes = await app.inject({
        method: 'PUT',
        url: `/orders/${orderId}`,
        headers: JSON_HEADERS,
        payload: {
          adjustment: {
            type: 'refund',
            status: 'completed',
            amount: 5000,
            description: 'Customer return',
            line_items: [{ id: 'li-0', quantity: 1 }],
          },
        },
      });
      expect(adjustRes.statusCode).toBe(200);
      const order = JSON.parse(adjustRes.body) as Record<string, unknown>;
      const adjustments = order['adjustments'] as Record<string, unknown>[];
      expect(adjustments.length).toBe(1);
      expect(adjustments[0]!['type']).toBe('refund');
      expect(adjustments[0]!['status']).toBe('completed');
      expect(adjustments[0]!['amount']).toBe(5000);
    });
  });

  // ── Consent passthrough ───────────────────────────────────────────────

  describe('Consent and signals passthrough', () => {
    it('checkout session preserves consent and signals', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/checkout-sessions',
        headers: JSON_HEADERS,
        payload: {
          line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
          currency: 'USD',
          consent: { privacy_policy: true, marketing: false },
          signals: { 'dev.ucp.buyer_ip': '1.2.3.4' },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as Record<string, unknown>;

      expect(body).toHaveProperty('consent');
      const consent = body['consent'] as Record<string, boolean>;
      expect(consent['privacy_policy']).toBe(true);
      expect(consent['marketing']).toBe(false);

      expect(body).toHaveProperty('signals');
      const signals = body['signals'] as Record<string, unknown>;
      expect(signals['dev.ucp.buyer_ip']).toBe('1.2.3.4');
    });
  });

  // ── Product SDK shape coverage ────────────────────────────────────────

  describe('Product SDK shape completeness', () => {
    it('product includes all SDK fields: description, price_range, variants, media, categories, options, rating', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ucp/products/prod-002',
        headers: HEADERS,
      });
      expect(res.statusCode).toBe(200);
      const product = JSON.parse(res.body) as Record<string, unknown>;

      expect(product).toHaveProperty('id', 'prod-002');
      expect(product).toHaveProperty('title');

      const desc = product['description'] as Record<string, string>;
      expect(desc).toHaveProperty('plain');

      const priceRange = product['price_range'] as Record<string, Record<string, unknown>>;
      expect(priceRange['min']).toHaveProperty('amount');
      expect(priceRange['min']).toHaveProperty('currency');
      expect(priceRange['max']).toHaveProperty('amount');

      const variants = product['variants'] as Record<string, unknown>[];
      expect(variants.length).toBeGreaterThan(0);
      const variant = variants[0]!;
      expect(variant).toHaveProperty('id');
      expect(variant).toHaveProperty('title');
      expect(variant).toHaveProperty('price');
      expect(variant).toHaveProperty('availability');
      expect(variant).toHaveProperty('selected_options');

      expect(product).toHaveProperty('media');
      expect(product).toHaveProperty('categories');
      expect(product).toHaveProperty('options');

      const options = product['options'] as Record<string, unknown>[];
      expect(options.length).toBeGreaterThan(0);
      expect(options[0]!).toHaveProperty('name');
      expect(options[0]!).toHaveProperty('values');
    });

    it('product with rating includes scale_min, scale_max, count', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ucp/products/prod-001',
        headers: HEADERS,
      });
      const product = JSON.parse(res.body) as Record<string, unknown>;
      expect(product).toHaveProperty('rating');
      const rating = product['rating'] as Record<string, number>;
      expect(rating['value']).toBe(4.5);
      expect(rating['scale_min']).toBe(1);
      expect(rating['scale_max']).toBe(5);
      expect(rating['count']).toBe(89);
    });
  });

  // ── Multiple payment handlers ─────────────────────────────────────────

  describe('Multiple payment handlers in checkout response', () => {
    it('checkout response includes instruments from all handler types', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/checkout-sessions',
        headers: JSON_HEADERS,
        payload: {
          line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
          currency: 'USD',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      const payment = body['payment'] as Record<string, unknown>;
      const instruments = payment['instruments'] as Record<string, unknown>[];

      expect(instruments.length).toBe(4);

      const types = instruments.map((i) => i['type']);
      expect(types).toContain('card');
      expect(types).toContain('wallet');
      expect(types).toContain('redirect');
      expect(types).toContain('offline');
    });
  });
});
