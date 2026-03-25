import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const SHOPWARE_URL = process.env.SHOPWARE_URL ?? 'http://localhost:8888';
const SHOPWARE_TENANT_HOST = process.env.SHOPWARE_TENANT_HOST ?? 'shopware.localhost:3000';
const AGENT_HEADER = 'e2e-shopware-test/1.0';

function readAccessKey(): string {
  if (process.env.SHOPWARE_ACCESS_KEY) return process.env.SHOPWARE_ACCESS_KEY;
  try {
    return readFileSync(resolve(__dirname, '.shopware-access-key'), 'utf-8').trim();
  } catch {
    throw new Error('SHOPWARE_ACCESS_KEY env var not set and .shopware-access-key file not found');
  }
}

let PRODUCT_ID: string;
let PAYMENT_METHOD_ID: string;

interface TotalEntry {
  readonly type: string;
  readonly amount: number;
}

interface SessionResponse {
  readonly id: string;
  readonly status: string;
  readonly currency?: string;
  readonly line_items: readonly {
    readonly id: string;
    readonly item: { readonly id: string; readonly title: string; readonly price: number };
    readonly quantity: number;
    readonly totals: readonly TotalEntry[];
  }[];
  readonly totals: readonly TotalEntry[];
  readonly buyer?: {
    readonly email?: string;
    readonly first_name?: string;
    readonly last_name?: string;
    readonly full_name?: string;
    readonly phone_number?: string;
  };
  readonly payment?: {
    readonly instruments?: readonly { readonly id: string; readonly handler_id: string }[];
    readonly handlers?: readonly { readonly id: string; readonly name: string }[];
  };
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
  readonly discounts?: {
    readonly codes?: readonly string[];
    readonly applied?: readonly unknown[];
  };
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
      Host: SHOPWARE_TENANT_HOST,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function postEmpty(path: string): Promise<Response> {
  return fetch(`${GATEWAY_URL}${path}`, {
    method: 'POST',
    headers: { 'UCP-Agent': AGENT_HEADER, Host: SHOPWARE_TENANT_HOST },
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
      Host: SHOPWARE_TENANT_HOST,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function get(path: string): Promise<Response> {
  return fetch(`${GATEWAY_URL}${path}`, {
    headers: { 'UCP-Agent': AGENT_HEADER, Host: SHOPWARE_TENANT_HOST },
  });
}

function makeLineItems(productId: string, quantity = 1) {
  return [{ item: { id: productId }, quantity }];
}

function makeBuyer(email: string) {
  return { email, first_name: 'E2E', last_name: 'Shopware' };
}

function makeFulfillment() {
  return {
    destinations: [
      {
        id: 'dest-1',
        address: {
          street_address: '123 Test St',
          address_locality: 'Berlin',
          address_region: 'BE',
          postal_code: '10115',
          address_country: 'DE',
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
            selected_option_id: 'opt-standard',
            options: [
              {
                id: 'opt-standard',
                label: 'Standard Shipping',
                amount: { value: 499, currency: 'EUR' },
              },
            ],
          },
        ],
      },
    ],
  };
}

function makePayment(handlerId?: string) {
  const id = handlerId ?? PAYMENT_METHOD_ID;
  return {
    instruments: [
      {
        id: 'inst-1',
        handler_id: id,
        type: 'offline',
        selected: true,
        credential: { type: id },
      },
    ],
  };
}

function findTotal(totals: readonly TotalEntry[] | undefined, type: string): number | undefined {
  if (!totals) return undefined;
  return totals.find((t) => t.type === type)?.amount;
}

async function discoverProductIds(): Promise<{ first: string }> {
  const resp = await get('/ucp/products?q=Shoes&limit=5');
  const body = (await resp.json()) as { products: readonly { id: string }[] };
  if (body.products.length < 1) throw new Error('No products found in Shopware');
  return { first: body.products[0].id };
}

async function discoverPaymentMethodId(): Promise<string> {
  const accessKey = readAccessKey();
  const resp = await fetch(`${SHOPWARE_URL}/store-api/payment-method`, {
    method: 'POST',
    headers: {
      'sw-access-key': accessKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ limit: 1 }),
  });
  const body = (await resp.json()) as { elements: readonly { id: string }[] };
  if (body.elements.length < 1) return 'invoice';
  return body.elements[0].id;
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

describe('Shopware E2E Checkout', () => {
  beforeAll(async () => {
    const healthResp = await get('/health');
    const health = (await healthResp.json()) as { status: string };
    if (health.status !== 'ok') throw new Error(`Gateway not healthy: ${JSON.stringify(health)}`);

    const ids = await discoverProductIds();
    PRODUCT_ID = ids.first;

    PAYMENT_METHOD_ID = await discoverPaymentMethodId();
  });

  describe('Session create with optional fields', () => {
    it('create with buyer + line_items populates buyer on session', async () => {
      const buyer = makeBuyer('sw-create-buyer@ucp-gateway.test');
      const resp = await postJson('/checkout-sessions', {
        line_items: makeLineItems(PRODUCT_ID),
        buyer,
      });
      const body = (await resp.json()) as SessionResponse;

      expect(resp.status).toBe(201);
      expect(body.buyer).toBeDefined();
      expect(body.buyer?.email).toBe(buyer.email);
      expect(body.buyer?.first_name).toBe(buyer.first_name);
      expect(body.buyer?.last_name).toBe(buyer.last_name);

      await postEmpty(`/checkout-sessions/${body.id}/cancel`);
    });

    it('create with payment handlers echoes them in response', async () => {
      const payment = makePayment();
      const resp = await postJson('/checkout-sessions', {
        line_items: makeLineItems(PRODUCT_ID),
        payment,
      });
      const body = (await resp.json()) as SessionResponse;

      expect(resp.status).toBe(201);
      expect(body.payment).toBeDefined();
      expect(body.payment?.handlers).toBeDefined();
      expect(body.payment!.handlers!.length).toBeGreaterThanOrEqual(1);

      await postEmpty(`/checkout-sessions/${body.id}/cancel`);
    });

    it('create with currency override uses that currency', async () => {
      const resp = await postJson('/checkout-sessions', {
        line_items: makeLineItems(PRODUCT_ID),
        currency: 'EUR',
      });
      const body = (await resp.json()) as SessionResponse;

      expect(resp.status).toBe(201);
      expect(body.currency).toBe('EUR');

      await postEmpty(`/checkout-sessions/${body.id}/cancel`);
    });

    it('create with fulfillment generates shipping options', async () => {
      const resp = await postJson('/checkout-sessions', {
        line_items: makeLineItems(PRODUCT_ID),
        buyer: makeBuyer('sw-create-fulfillment@ucp-gateway.test'),
        fulfillment: makeFulfillment(),
      });
      const body = (await resp.json()) as SessionResponse;

      expect(resp.status).toBe(201);
      expect(body.fulfillment).toBeDefined();
      expect(body.fulfillment?.methods).toBeDefined();
      expect(body.fulfillment!.methods.length).toBeGreaterThanOrEqual(1);

      const fulfillmentTotal = findTotal(body.totals, 'fulfillment');
      expect(fulfillmentTotal).toBeDefined();

      await postEmpty(`/checkout-sessions/${body.id}/cancel`);
    });

    it('create with discounts.codes applies coupon immediately', async () => {
      const resp = await postJson('/checkout-sessions', {
        line_items: makeLineItems(PRODUCT_ID),
        discounts: { codes: ['UCPTEST10'] },
      });
      const body = (await resp.json()) as SessionResponse;

      expect(resp.status).toBe(201);
      expect(body.discounts).toBeDefined();
      expect(body.discounts?.codes).toBeDefined();
      expect(body.discounts!.codes).toContain('UCPTEST10');

      await postEmpty(`/checkout-sessions/${body.id}/cancel`);
    });
  });

  describe('Session create validation failures', () => {
    it('create with invalid currency returns 400', async () => {
      const resp = await postJson('/checkout-sessions', {
        line_items: makeLineItems(PRODUCT_ID),
        currency: '',
      });

      expect(resp.status).toBeGreaterThanOrEqual(400);
      expect(resp.status).toBeLessThan(500);
    });

    it('create with invalid buyer (no email, no name) still accepted as all fields optional', async () => {
      const resp = await postJson('/checkout-sessions', {
        line_items: makeLineItems(PRODUCT_ID),
        buyer: {},
      });
      const body = (await resp.json()) as SessionResponse;

      expect(resp.status).toBe(201);
      expect(body.buyer).toBeDefined();

      await postEmpty(`/checkout-sessions/${body.id}/cancel`);
    });

    it('create with empty body returns 400', async () => {
      const resp = await fetch(`${GATEWAY_URL}/checkout-sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'UCP-Agent': AGENT_HEADER,
          Host: SHOPWARE_TENANT_HOST,
        },
        body: JSON.stringify({}),
      });

      expect(resp.status).toBeGreaterThanOrEqual(400);
      expect(resp.status).toBeLessThan(500);
    });

    it('create with no body at all returns 400', async () => {
      const resp = await fetch(`${GATEWAY_URL}/checkout-sessions`, {
        method: 'POST',
        headers: { 'UCP-Agent': AGENT_HEADER, Host: SHOPWARE_TENANT_HOST },
      });

      expect(resp.status).toBeGreaterThanOrEqual(400);
      expect(resp.status).toBeLessThan(500);
    });
  });

  describe('Checkout lifecycle', () => {
    it('full flow: create → update → complete', async () => {
      const ready = await createReadySession();
      expect(ready.status).toBe('ready_for_complete');

      const resp = await postJson(`/checkout-sessions/${ready.id}/complete`, {
        payment: makePayment(),
      });
      const body = (await resp.json()) as SessionResponse;

      expect(resp.status).toBe(200);
      expect(body.status).toBe('completed');
      expect(body.order).toBeDefined();
      expect(body.order?.id).toBeTruthy();
    });

    it('cancel session returns status canceled', async () => {
      const session = await createSession();
      const resp = await postEmpty(`/checkout-sessions/${session.id}/cancel`);
      const body = (await resp.json()) as SessionResponse;

      expect(resp.status).toBe(200);
      expect(body.status).toBe('canceled');
    });
  });

  describe('Error handling', () => {
    it('GET non-existent session returns 404', async () => {
      const resp = await get('/checkout-sessions/00000000-0000-0000-0000-000000000000');
      const body = (await resp.json()) as ErrorResponse;

      expect(resp.status).toBe(404);
      expect(body.messages[0]?.code).toBe('missing');
    });

    it('create with non-existent product ID returns error', async () => {
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
  });
});
