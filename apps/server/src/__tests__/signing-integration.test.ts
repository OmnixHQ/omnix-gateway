import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './test-helpers.js';
import { SigningService } from '@ucp-gateway/core';
import type { JsonWebKey } from '@ucp-gateway/core';

const HOST_HEADER = { host: 'mock-store.localhost' };
const AGENT_HEADER = { 'ucp-agent': 'test-agent/1.0' };
const HEADERS = { ...HOST_HEADER, ...AGENT_HEADER };

// ═══════════════════════════════════════════════════════════════════════════
// 1. DISCOVERY ENDPOINT — signing_keys in /.well-known/ucp
// ═══════════════════════════════════════════════════════════════════════════

describe('Integration: signing_keys in discovery profile', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const result = await buildTestApp();
    app = result.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns signing_keys as a non-empty array', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/ucp', headers: HOST_HEADER });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(Array.isArray(body['signing_keys'])).toBe(true);
    expect((body['signing_keys'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('each signing key has all UCP-required JWK fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/ucp', headers: HOST_HEADER });
    const keys = (JSON.parse(res.body) as Record<string, unknown>)['signing_keys'] as Record<
      string,
      unknown
    >[];
    for (const key of keys) {
      expect(key['kty']).toBe('EC');
      expect(key['crv']).toBe('P-256');
      expect(key['alg']).toBe('ES256');
      expect(key['use']).toBe('sig');
      expect(typeof key['kid']).toBe('string');
      expect((key['kid'] as string).length).toBeGreaterThan(0);
      expect(typeof key['x']).toBe('string');
      expect(typeof key['y']).toBe('string');
    }
  });

  it('signing key does NOT leak private key material (d)', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/ucp', headers: HOST_HEADER });
    const keys = (JSON.parse(res.body) as Record<string, unknown>)['signing_keys'] as Record<
      string,
      unknown
    >[];
    for (const key of keys) {
      expect(key['d']).toBeUndefined();
    }
  });

  it('signing_keys are consistent across multiple requests', async () => {
    const res1 = await app.inject({
      method: 'GET',
      url: '/.well-known/ucp',
      headers: HOST_HEADER,
    });
    const res2 = await app.inject({
      method: 'GET',
      url: '/.well-known/ucp',
      headers: HOST_HEADER,
    });
    const keys1 = (JSON.parse(res1.body) as Record<string, unknown>)['signing_keys'];
    const keys2 = (JSON.parse(res2.body) as Record<string, unknown>)['signing_keys'];
    expect(keys1).toEqual(keys2);
  });

  it('signing_keys coexist with payment and ucp fields', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/ucp', headers: HOST_HEADER });
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).toHaveProperty('ucp');
    const ucp = body['ucp'] as Record<string, unknown>;
    expect(ucp).toHaveProperty('payment_handlers');
    expect(body).toHaveProperty('signing_keys');
    expect((body['ucp'] as Record<string, unknown>)['version']).toBe('2026-01-23');
  });

  it('signing_keys x/y values are valid base64url (no padding)', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/ucp', headers: HOST_HEADER });
    const keys = (JSON.parse(res.body) as Record<string, unknown>)['signing_keys'] as Record<
      string,
      unknown
    >[];
    const b64urlPattern = /^[A-Za-z0-9_-]+$/;
    for (const key of keys) {
      expect(key['x']).toMatch(b64urlPattern);
      expect(key['y']).toMatch(b64urlPattern);
    }
  });

  it('the signing key can actually verify a signature from the gateway', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/ucp', headers: HOST_HEADER });
    const keys = (JSON.parse(res.body) as Record<string, unknown>)['signing_keys'] as JsonWebKey[];

    const signingService = app.signingService;
    const body = new TextEncoder().encode('{"test":"verification"}');
    const sig = await signingService.sign(body);
    const result = await signingService.verify(sig, body, keys);
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. REQUEST-SIGNATURE MIDDLEWARE — inbound header handling
// ═══════════════════════════════════════════════════════════════════════════

describe('Integration: Request-Signature middleware', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const result = await buildTestApp();
    app = result.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET requests without Request-Signature proceed normally', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ucp/products?q=shoes',
      headers: HEADERS,
    });
    expect(res.statusCode).toBe(200);
  });

  it('GET requests with Request-Signature proceed normally (no body to verify)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ucp/products?q=shoes',
      headers: { ...HEADERS, 'request-signature': 'fake..sig' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST without Request-Signature proceeds normally', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: { ...HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
      }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('POST with Request-Signature proceeds normally (best-effort, no rejection)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: {
        ...HEADERS,
        'content-type': 'application/json',
        'request-signature': 'eyJhbGciOiJFUzI1NiJ9..fakesig',
      },
      body: JSON.stringify({
        line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
      }),
    });
    expect(res.statusCode).toBe(201);
  });

  it('health endpoint skips signature check', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'request-signature': 'fake..sig' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('discovery endpoint skips signature check', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/ucp',
      headers: { ...HOST_HEADER, 'request-signature': 'garbage' },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. OUTBOUND SIGNING — gateway can sign responses for webhooks
// ═══════════════════════════════════════════════════════════════════════════

describe('Integration: gateway outbound signing capability', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const result = await buildTestApp();
    app = result.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('signingService is available on the app instance', () => {
    expect(app.signingService).toBeInstanceOf(SigningService);
  });

  it('signingService can sign a webhook-like payload', async () => {
    const webhookPayload = JSON.stringify({
      event: 'order_placed',
      order_id: 'ord-12345',
      checkout_id: 'chk-67890',
      occurred_at: '2026-03-26T10:00:00Z',
    });

    const body = new TextEncoder().encode(webhookPayload);
    const sig = await app.signingService.sign(body);

    expect(sig).toContain('..');
    expect(sig.split('..')[0]!.length).toBeGreaterThan(0);
    expect(sig.split('..')[1]!.length).toBeGreaterThan(0);
  });

  it('signed webhook payload can be verified using discovery profile keys', async () => {
    const profileRes = await app.inject({
      method: 'GET',
      url: '/.well-known/ucp',
      headers: HOST_HEADER,
    });
    const profileKeys = (JSON.parse(profileRes.body) as Record<string, unknown>)[
      'signing_keys'
    ] as JsonWebKey[];

    const webhookPayload = new TextEncoder().encode(
      JSON.stringify({ event: 'order_shipped', order_id: 'ord-99999' }),
    );
    const sig = await app.signingService.sign(webhookPayload);
    const result = await app.signingService.verify(sig, webhookPayload, profileKeys);
    expect(result.valid).toBe(true);
  });

  it('tampered webhook payload fails verification against discovery keys', async () => {
    const profileRes = await app.inject({
      method: 'GET',
      url: '/.well-known/ucp',
      headers: HOST_HEADER,
    });
    const profileKeys = (JSON.parse(profileRes.body) as Record<string, unknown>)[
      'signing_keys'
    ] as JsonWebKey[];

    const original = new TextEncoder().encode(JSON.stringify({ amount: 1000 }));
    const sig = await app.signingService.sign(original);

    const tampered = new TextEncoder().encode(JSON.stringify({ amount: 9999 }));
    const result = await app.signingService.verify(sig, tampered, profileKeys);
    expect(result.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. FULL CHECKOUT FLOW with signing verification
// ═══════════════════════════════════════════════════════════════════════════

describe('Integration: checkout flow preserves signing_keys', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const result = await buildTestApp();
    app = result.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('discovery keys remain stable throughout a checkout session lifecycle', async () => {
    const profile1 = await app.inject({
      method: 'GET',
      url: '/.well-known/ucp',
      headers: HOST_HEADER,
    });
    const keys1 = (JSON.parse(profile1.body) as Record<string, unknown>)['signing_keys'];

    await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: { ...HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
      }),
    });

    const profile2 = await app.inject({
      method: 'GET',
      url: '/.well-known/ucp',
      headers: HOST_HEADER,
    });
    const keys2 = (JSON.parse(profile2.body) as Record<string, unknown>)['signing_keys'];

    expect(keys1).toEqual(keys2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. SPEC COMPLIANCE VALIDATOR COMPATIBILITY
// ═══════════════════════════════════════════════════════════════════════════

describe('Integration: PR-15 spec compliance — signing_keys array', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const result = await buildTestApp();
    app = result.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('signing_keys is an Array (PR-15 check passes)', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/ucp', headers: HOST_HEADER });
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(Array.isArray(body['signing_keys'])).toBe(true);
  });

  it('signing_keys array is not empty (closes MUST gap)', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/ucp', headers: HOST_HEADER });
    const keys = (JSON.parse(res.body) as Record<string, unknown>)['signing_keys'] as unknown[];
    expect(keys.length).toBeGreaterThanOrEqual(1);
  });

  it('each entry in signing_keys has kty=EC (not RSA, not OKP)', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/ucp', headers: HOST_HEADER });
    const keys = (JSON.parse(res.body) as Record<string, unknown>)['signing_keys'] as Record<
      string,
      unknown
    >[];
    for (const key of keys) {
      expect(key['kty']).toBe('EC');
    }
  });

  it('JSON serialisation of profile is valid JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/ucp', headers: HOST_HEADER });
    expect(() => JSON.parse(res.body) as unknown).not.toThrow();
  });

  it('Content-Type is application/json', async () => {
    const res = await app.inject({ method: 'GET', url: '/.well-known/ucp', headers: HOST_HEADER });
    expect(res.headers['content-type']).toContain('application/json');
  });
});
