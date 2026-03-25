import { describe, it, expect, beforeAll } from 'vitest';

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const AGENT_HEADER = 'e2e-test/1.0';

let PRODUCT_ID: string;

interface TotalEntry {
  readonly type: string;
  readonly amount: number;
}

interface SessionResponse {
  readonly id: string;
  readonly status: string;
  readonly line_items: readonly {
    readonly id: string;
    readonly item: { readonly id: string; readonly title: string; readonly price: number };
    readonly quantity: number;
    readonly totals: readonly TotalEntry[];
  }[];
  readonly totals: readonly TotalEntry[];
  readonly order?: {
    readonly id: string;
    readonly totals?: readonly TotalEntry[];
  };
  readonly fulfillment?: {
    readonly methods: readonly {
      readonly id: string;
      readonly groups: readonly {
        readonly id: string;
        readonly selected_option_id?: string;
        readonly options: readonly { readonly id: string; readonly label: string }[];
      }[];
    }[];
  };
  readonly discounts?: { readonly codes?: readonly string[] };
  readonly messages?: readonly { readonly code: string; readonly severity?: string }[];
}

interface ErrorResponse {
  readonly messages: readonly { readonly code: string; readonly content: string }[];
}

async function postJson(
  path: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<Response> {
  return fetch(`${GATEWAY_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'UCP-Agent': AGENT_HEADER,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function postEmpty(path: string): Promise<Response> {
  return fetch(`${GATEWAY_URL}${path}`, {
    method: 'POST',
    headers: { 'UCP-Agent': AGENT_HEADER },
  });
}

async function put(
  path: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<Response> {
  return fetch(`${GATEWAY_URL}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'UCP-Agent': AGENT_HEADER,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function get(path: string): Promise<Response> {
  return fetch(`${GATEWAY_URL}${path}`, {
    headers: { 'UCP-Agent': AGENT_HEADER },
  });
}

function makeLineItems(productId: string, quantity = 1) {
  return [{ item: { id: productId }, quantity }];
}

function makeBuyer(email: string) {
  return { email, first_name: 'E2E', last_name: 'Test' };
}

function makeFulfillment() {
  return {
    destinations: [
      {
        id: 'dest-1',
        address: {
          street_address: '123 Test St',
          address_locality: 'New York',
          address_region: 'NY',
          postal_code: '10001',
          address_country: 'US',
        },
      },
    ],
    methods: [
      {
        id: 'method-1',
        type: 'shipping',
        selected_destination_id: 'dest-1',
        groups: [
          {
            id: 'group-1',
            selected_option_id: 'opt-flatrate',
            options: [
              {
                id: 'opt-flatrate',
                label: 'Flat Rate',
                amount: { value: 500, currency: 'USD' },
              },
            ],
          },
        ],
      },
    ],
  };
}

function makePayment(handlerId = 'checkmo') {
  return {
    instruments: [
      {
        id: 'inst-1',
        handler_id: handlerId,
        type: 'offline',
        selected: true,
        credential: { type: handlerId },
      },
    ],
  };
}

function findTotal(totals: readonly TotalEntry[] | undefined, type: string): number | undefined {
  if (!totals) return undefined;
  return totals.find((t) => t.type === type)?.amount;
}

async function discoverProductIds(): Promise<{ first: string }> {
  const resp = await get('/ucp/products?q=shoes&limit=5');
  const body = (await resp.json()) as { products: readonly { id: string }[] };
  if (body.products.length < 1) throw new Error('No products found in Magento');
  return { first: body.products[0].id };
}

async function createSession(productId?: string): Promise<SessionResponse> {
  const resp = await postJson('/checkout-sessions', {
    line_items: makeLineItems(productId ?? PRODUCT_ID),
  });
  return (await resp.json()) as SessionResponse;
}

async function createReadySession(): Promise<SessionResponse> {
  const session = await createSession();
  const resp = await put(`/checkout-sessions/${session.id}`, {
    id: session.id,
    buyer: makeBuyer('ready-session@ucp-gateway.test'),
    fulfillment: makeFulfillment(),
  });
  return (await resp.json()) as SessionResponse;
}

async function createCompletedSession(): Promise<SessionResponse> {
  const ready = await createReadySession();
  const resp = await postJson(`/checkout-sessions/${ready.id}/complete`, {
    payment: makePayment(),
  });
  return (await resp.json()) as SessionResponse;
}

describe('Magento E2E Checkout', () => {
  beforeAll(async () => {
    const healthResp = await get('/health');
    const health = (await healthResp.json()) as { status: string };
    if (health.status !== 'ok') throw new Error(`Gateway not healthy: ${JSON.stringify(health)}`);

    const ids = await discoverProductIds();
    PRODUCT_ID = ids.first;
  });

  describe('Checkout lifecycle', () => {
    it('cancel session returns status canceled', async () => {
      const session = await createSession();
      const resp = await postEmpty(`/checkout-sessions/${session.id}/cancel`);
      const body = (await resp.json()) as SessionResponse;

      expect(resp.status).toBe(200);
      expect(body.status).toBe('canceled');
    });

    it('cancel already-completed session returns 409', async () => {
      const completed = await createCompletedSession();
      const resp = await postEmpty(`/checkout-sessions/${completed.id}/cancel`);

      expect(resp.status).toBe(409);
    });

    it('GET session after completion has order data', async () => {
      const completed = await createCompletedSession();
      const resp = await get(`/checkout-sessions/${completed.id}`);
      const body = (await resp.json()) as SessionResponse;

      expect(body.status).toBe('completed');
      expect(body.order).toBeDefined();
      expect(body.order?.id).toBeTruthy();
    });

    it('double-complete same session returns completed status', async () => {
      const completed = await createCompletedSession();
      const resp = await postJson(`/checkout-sessions/${completed.id}/complete`, {
        payment: makePayment(),
      });
      const body = (await resp.json()) as SessionResponse | ErrorResponse;

      const isIdempotent =
        (resp.status === 200 && 'status' in body && body.status === 'completed') ||
        resp.status === 409;
      expect(isIdempotent).toBe(true);
    });
  });

  describe('Validation', () => {
    it('create session with empty line_items returns error or empty session', async () => {
      const resp = await postJson('/checkout-sessions', { line_items: [] });

      expect(resp.status).toBeLessThan(500);
    });

    it('create session with non-existent product ID returns error', async () => {
      const resp = await postJson('/checkout-sessions', {
        line_items: makeLineItems('nonexistent-product-xyz-9999'),
      });
      const body = (await resp.json()) as SessionResponse | ErrorResponse;

      const isError =
        resp.status >= 400 ||
        ('messages' in body &&
          body.messages.some((m) => m.code === 'product_not_found' || m.code === 'missing'));
      expect(isError).toBe(true);
    });

    it('complete session without buyer info returns error', async () => {
      const session = await createSession();
      const resp = await postJson(`/checkout-sessions/${session.id}/complete`, {
        payment: makePayment(),
      });

      expect(resp.status).toBeGreaterThanOrEqual(400);
    });

    it('complete session without fulfillment selection returns error', async () => {
      const session = await createSession();
      await put(`/checkout-sessions/${session.id}`, {
        id: session.id,
        buyer: makeBuyer('no-fulfillment@ucp-gateway.test'),
      });

      const resp = await postJson(`/checkout-sessions/${session.id}/complete`, {
        payment: makePayment(),
      });

      expect(resp.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Fulfillment', () => {
    it('session with fulfillment has totals including fulfillment', async () => {
      const session = await createSession();
      const resp = await put(`/checkout-sessions/${session.id}`, {
        id: session.id,
        buyer: makeBuyer('fulfillment-totals@ucp-gateway.test'),
        fulfillment: makeFulfillment(),
      });
      const body = (await resp.json()) as SessionResponse;

      const subtotal = findTotal(body.totals, 'subtotal');
      const total = findTotal(body.totals, 'total');

      expect(subtotal).toBeDefined();
      expect(total).toBeDefined();
      expect(total!).toBeGreaterThanOrEqual(subtotal!);

      await postEmpty(`/checkout-sessions/${session.id}/cancel`);
    });

    it('updating destination address produces valid session', async () => {
      const session = await createSession();

      const resp = await put(`/checkout-sessions/${session.id}`, {
        id: session.id,
        buyer: makeBuyer('address-test@ucp-gateway.test'),
        fulfillment: {
          destinations: [
            {
              id: 'dest-1',
              address: {
                street_address: '999 Other Ave',
                address_locality: 'Los Angeles',
                address_region: 'CA',
                postal_code: '90001',
                address_country: 'US',
              },
            },
          ],
          methods: [
            {
              id: 'method-1',
              type: 'shipping',
              selected_destination_id: 'dest-1',
              groups: [
                {
                  id: 'group-1',
                  selected_option_id: 'opt-flatrate',
                  options: [
                    {
                      id: 'opt-flatrate',
                      label: 'Flat Rate',
                      amount: { value: 500, currency: 'USD' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      });
      const body = (await resp.json()) as SessionResponse;

      expect(resp.status).toBeLessThan(500);
      expect(body.totals.length).toBeGreaterThan(0);

      await postEmpty(`/checkout-sessions/${session.id}/cancel`);
    });
  });

  describe('Discounts', () => {
    it('apply invalid coupon code does not apply a discount', async () => {
      const session = await createSession();
      const resp = await put(`/checkout-sessions/${session.id}`, {
        id: session.id,
        buyer: makeBuyer('bad-coupon@ucp-gateway.test'),
        fulfillment: makeFulfillment(),
        discounts: { codes: ['TOTALLY_INVALID_COUPON_XYZ'] },
      });
      const body = (await resp.json()) as SessionResponse;

      const discountAmount = findTotal(body.totals, 'discount') ?? 0;
      const appliedDiscounts = body.discounts?.codes ?? [];

      expect(discountAmount).toBe(0);
      expect(appliedDiscounts).toBeDefined();

      await postEmpty(`/checkout-sessions/${session.id}/cancel`);
    });

    it('apply coupon then clear it reverts totals', async () => {
      const session = await createSession();

      const withCoupon = await put(`/checkout-sessions/${session.id}`, {
        id: session.id,
        buyer: makeBuyer('coupon-revert@ucp-gateway.test'),
        fulfillment: makeFulfillment(),
        discounts: { codes: ['UCPTEST10'] },
      });
      const couponBody = (await withCoupon.json()) as SessionResponse;
      const totalWithCoupon = findTotal(couponBody.totals, 'total');

      const withoutCoupon = await put(`/checkout-sessions/${session.id}`, {
        id: session.id,
        buyer: makeBuyer('coupon-revert@ucp-gateway.test'),
        fulfillment: makeFulfillment(),
        discounts: { codes: [] },
      });
      const noCouponBody = (await withoutCoupon.json()) as SessionResponse;
      const totalWithoutCoupon = findTotal(noCouponBody.totals, 'total');

      expect(totalWithCoupon).toBeDefined();
      expect(totalWithoutCoupon).toBeDefined();
      if (totalWithCoupon !== undefined && totalWithoutCoupon !== undefined) {
        expect(totalWithoutCoupon).toBeGreaterThanOrEqual(totalWithCoupon);
      }

      await postEmpty(`/checkout-sessions/${session.id}/cancel`);
    });

    it('discount math: subtotal + discount + fulfillment = total', async () => {
      const session = await createSession();

      const resp = await put(`/checkout-sessions/${session.id}`, {
        id: session.id,
        buyer: makeBuyer('discount-math@ucp-gateway.test'),
        fulfillment: makeFulfillment(),
        discounts: { codes: ['UCPTEST10'] },
      });
      const body = (await resp.json()) as SessionResponse;

      const subtotal = findTotal(body.totals, 'subtotal') ?? 0;
      const discount = findTotal(body.totals, 'discount') ?? 0;
      const fulfillmentCost = findTotal(body.totals, 'fulfillment') ?? 0;
      const total = findTotal(body.totals, 'total') ?? 0;

      expect(subtotal).toBeGreaterThan(0);
      expect(total).toBe(subtotal + discount + fulfillmentCost);

      await postEmpty(`/checkout-sessions/${session.id}/cancel`);
    });
  });

  describe('Idempotency', () => {
    it('same Idempotency-Key returns same session', async () => {
      const idempotencyKey = `idem-same-${Date.now()}`;
      const lineItems = makeLineItems(PRODUCT_ID);

      const resp1 = await postJson(
        '/checkout-sessions',
        { line_items: lineItems },
        { 'Idempotency-Key': idempotencyKey },
      );
      const body1 = (await resp1.json()) as SessionResponse;

      const resp2 = await postJson(
        '/checkout-sessions',
        { line_items: lineItems },
        { 'Idempotency-Key': idempotencyKey },
      );
      const body2 = (await resp2.json()) as SessionResponse;

      expect(body1.id).toBe(body2.id);

      await postEmpty(`/checkout-sessions/${body1.id}/cancel`);
    });

    it('same Idempotency-Key with different body returns 409', async () => {
      const idempotencyKey = `idem-conflict-${Date.now()}`;

      await postJson(
        '/checkout-sessions',
        { line_items: makeLineItems(PRODUCT_ID) },
        { 'Idempotency-Key': idempotencyKey },
      );

      const resp2 = await postJson(
        '/checkout-sessions',
        { line_items: makeLineItems(PRODUCT_ID, 5) },
        { 'Idempotency-Key': idempotencyKey },
      );

      expect(resp2.status).toBe(409);
    });
  });

  describe('Error handling', () => {
    it('GET non-existent session returns 404', async () => {
      const resp = await get('/checkout-sessions/00000000-0000-0000-0000-000000000000');
      const body = (await resp.json()) as ErrorResponse;

      expect(resp.status).toBe(404);
      expect(body.messages[0]?.code).toBe('missing');
    });

    it('PUT to non-existent session returns 404', async () => {
      const resp = await put('/checkout-sessions/00000000-0000-0000-0000-000000000000', {
        id: '00000000-0000-0000-0000-000000000000',
        buyer: makeBuyer('ghost@ucp-gateway.test'),
      });

      expect(resp.status).toBe(404);
    });

    it('complete non-existent session returns 404', async () => {
      const resp = await postJson(
        '/checkout-sessions/00000000-0000-0000-0000-000000000000/complete',
        { payment: makePayment() },
      );

      expect(resp.status).toBe(404);
    });
  });

  describe('Payment', () => {
    it('complete with unknown payment handler still attempts order', async () => {
      const ready = await createReadySession();
      const resp = await postJson(`/checkout-sessions/${ready.id}/complete`, {
        payment: makePayment('totally_fake_handler_999'),
      });
      const body = (await resp.json()) as SessionResponse | ErrorResponse;

      const completed = resp.status === 200 && 'status' in body && body.status === 'completed';
      const errored = resp.status >= 400;
      expect(completed || errored).toBe(true);
    });

    it('order total matches session total after full flow', async () => {
      const session = await createSession();

      const updateResp = await put(`/checkout-sessions/${session.id}`, {
        id: session.id,
        buyer: makeBuyer('total-verify@ucp-gateway.test'),
        fulfillment: makeFulfillment(),
      });
      const readySession = (await updateResp.json()) as SessionResponse;
      const expectedTotal = findTotal(readySession.totals, 'total');

      const completeResp = await postJson(`/checkout-sessions/${session.id}/complete`, {
        payment: makePayment(),
      });
      const completed = (await completeResp.json()) as SessionResponse;

      expect(completed.status).toBe('completed');
      expect(completed.order).toBeDefined();

      const orderTotal = findTotal(completed.order?.totals, 'total');
      if (orderTotal !== undefined && expectedTotal !== undefined) {
        expect(orderTotal).toBe(expectedTotal);
      }
    });
  });
});
