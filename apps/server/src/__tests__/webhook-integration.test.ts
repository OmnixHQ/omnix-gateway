import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AwilixContainer } from 'awilix';
import {
  EventBus,
  SigningService,
  type WebhookEvent,
  type WebhookEventType,
} from '@ucp-gateway/core';
import type { Cradle } from '../container/index.js';
import { buildTestApp } from './test-helpers.js';
import { sendWebhook } from '../webhooks/WebhookSender.js';

const HEADERS = { host: 'mock-store.localhost', 'ucp-agent': 'test-agent/1.0' };
const JSON_HEADERS = { ...HEADERS, 'content-type': 'application/json' };

function createTestEvent(overrides?: Partial<WebhookEvent>): WebhookEvent {
  return {
    id: 'evt-test-001',
    type: 'order.created',
    tenant_id: '00000000-0000-0000-0000-000000000001',
    occurred_at: '2026-03-29T12:00:00Z',
    payload: { order_id: 'order-123' },
    ...overrides,
  };
}

async function createReadySession(app: FastifyInstance): Promise<string> {
  const searchRes = await app.inject({
    method: 'GET',
    url: '/ucp/products?q=shoes',
    headers: HEADERS,
  });
  const products = JSON.parse(searchRes.body) as { products: { id: string }[] };
  const productId = products.products[0]!.id;

  const createRes = await app.inject({
    method: 'POST',
    url: '/checkout-sessions',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      line_items: [{ item: { id: productId }, quantity: 1 }],
    }),
  });
  const session = JSON.parse(createRes.body) as { id: string };

  await app.inject({
    method: 'PUT',
    url: `/checkout-sessions/${session.id}`,
    headers: JSON_HEADERS,
    body: JSON.stringify({
      id: session.id,
      line_items: [{ item: { id: productId }, quantity: 1 }],
      buyer: {
        first_name: 'Test',
        last_name: 'User',
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

  return session.id;
}

async function completeSession(app: FastifyInstance, sessionId: string): Promise<void> {
  await app.inject({
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
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. EventBus → Checkout Integration
// ═══════════════════════════════════════════════════════════════════════════

describe('Webhook Integration: checkout → EventBus', () => {
  let app: FastifyInstance;
  let container: AwilixContainer<Cradle>;
  let eventBus: EventBus;
  const capturedEvents: WebhookEvent[] = [];

  beforeAll(async () => {
    const result = await buildTestApp();
    app = result.app;
    container = result.container;
    eventBus = container.resolve('eventBus');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    capturedEvents.length = 0;
    eventBus.removeAllListeners();
    eventBus.on('*', (event: WebhookEvent) => {
      capturedEvents.push(event);
    });
  });

  it('emits order.created when checkout completes successfully', async () => {
    const sessionId = await createReadySession(app);
    await completeSession(app, sessionId);

    const orderEvents = capturedEvents.filter((e) => e.type === 'order.created');
    expect(orderEvents).toHaveLength(1);

    const event = orderEvents[0]!;
    expect(event.tenant_id).toBe('00000000-0000-0000-0000-000000000001');
    expect(event.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.id).toBeTruthy();
  });

  it('order.created payload contains the UCP order object', async () => {
    const sessionId = await createReadySession(app);
    await completeSession(app, sessionId);

    const event = capturedEvents.find((e) => e.type === 'order.created')!;
    const payload = event.payload as Record<string, unknown>;

    expect(payload['id']).toBeTruthy();
    expect(payload['checkout_id']).toBe(sessionId);
    expect(payload['permalink_url']).toContain('/orders/');
    expect(payload['line_items']).toBeDefined();
    expect(payload['totals']).toBeDefined();
    expect(payload['fulfillment']).toBeDefined();
    expect(payload['ucp']).toBeDefined();

    const ucp = payload['ucp'] as Record<string, unknown>;
    expect(ucp['version']).toBe('2026-01-23');
  });

  it('emits order.canceled when session is canceled', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
      }),
    });
    const session = JSON.parse(createRes.body) as { id: string };

    await app.inject({
      method: 'POST',
      url: `/checkout-sessions/${session.id}/cancel`,
      headers: HEADERS,
    });

    const cancelEvents = capturedEvents.filter((e) => e.type === 'order.canceled');
    expect(cancelEvents).toHaveLength(1);

    const event = cancelEvents[0]!;
    expect(event.tenant_id).toBe('00000000-0000-0000-0000-000000000001');
    expect((event.payload as Record<string, unknown>)['session_id']).toBe(session.id);
  });

  it('does not emit events on create or update', async () => {
    await createReadySession(app);

    expect(capturedEvents).toHaveLength(0);
  });

  it('does not emit order.canceled when session is already canceled', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
      }),
    });
    const session = JSON.parse(createRes.body) as { id: string };

    await app.inject({
      method: 'POST',
      url: `/checkout-sessions/${session.id}/cancel`,
      headers: HEADERS,
    });
    capturedEvents.length = 0;

    await app.inject({
      method: 'POST',
      url: `/checkout-sessions/${session.id}/cancel`,
      headers: HEADERS,
    });

    expect(capturedEvents.filter((e) => e.type === 'order.canceled')).toHaveLength(0);
  });

  it('does not emit order.created on failed complete (409 incomplete state)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
      }),
    });
    const session = JSON.parse(createRes.body) as { id: string };

    await app.inject({
      method: 'POST',
      url: `/checkout-sessions/${session.id}/complete`,
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

    expect(capturedEvents.filter((e) => e.type === 'order.created')).toHaveLength(0);
  });

  it('each event has a unique id', async () => {
    const sid1 = await createReadySession(app);
    await completeSession(app, sid1);

    const sid2 = await createReadySession(app);
    await completeSession(app, sid2);

    const ids = capturedEvents.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('wildcard listener receives both order.created and order.canceled', async () => {
    const sid = await createReadySession(app);
    await completeSession(app, sid);

    const createRes2 = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
      }),
    });
    const session2 = JSON.parse(createRes2.body) as { id: string };
    await app.inject({
      method: 'POST',
      url: `/checkout-sessions/${session2.id}/cancel`,
      headers: HEADERS,
    });

    const types = capturedEvents.map((e) => e.type);
    expect(types).toContain('order.created');
    expect(types).toContain('order.canceled');
  });

  it('type-specific listener only receives matching events', async () => {
    const createdOnly: WebhookEvent[] = [];
    eventBus.on('order.created', (e) => createdOnly.push(e));

    const sid = await createReadySession(app);
    await completeSession(app, sid);

    const createRes2 = await app.inject({
      method: 'POST',
      url: '/checkout-sessions',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
      }),
    });
    const session2 = JSON.parse(createRes2.body) as { id: string };
    await app.inject({
      method: 'POST',
      url: `/checkout-sessions/${session2.id}/cancel`,
      headers: HEADERS,
    });

    expect(createdOnly.every((e) => e.type === 'order.created')).toBe(true);
    expect(createdOnly.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. WebhookSender — Real SigningService (JWT round-trip)
// ═══════════════════════════════════════════════════════════════════════════

describe('WebhookSender: real JWT signing round-trip', () => {
  let signingService: SigningService;

  beforeAll(async () => {
    signingService = new SigningService({ keyPrefix: 'test_webhook' });
    await signingService.initialize();
  });

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('produces a verifiable Request-Signature header', async () => {
    let capturedBody = '';
    let capturedSignature = '';

    vi.mocked(globalThis.fetch).mockImplementation(async (_url, init) => {
      const headers = init!.headers as Record<string, string>;
      capturedSignature = headers['Request-Signature']!;
      capturedBody = init!.body as string;
      return { ok: true, status: 200 } as Response;
    });

    const event = createTestEvent();
    const result = await sendWebhook(event, 'https://receiver.test/hook', {
      signingService,
    });

    expect(result.success).toBe(true);
    expect(capturedSignature).toBeTruthy();
    expect(capturedSignature).toMatch(/^[A-Za-z0-9_-]+\.\.[A-Za-z0-9_-]+=*$/);

    const bodyBytes = new TextEncoder().encode(capturedBody);
    const publicKeys = signingService.getPublicKeys();
    const verifyResult = await signingService.verify(capturedSignature, bodyBytes, publicKeys);
    expect(verifyResult.valid).toBe(true);
  });

  it('signature verification fails when body is tampered', async () => {
    let capturedSignature = '';

    vi.mocked(globalThis.fetch).mockImplementation(async (_url, init) => {
      capturedSignature = (init!.headers as Record<string, string>)['Request-Signature']!;
      return { ok: true, status: 200 } as Response;
    });

    await sendWebhook(createTestEvent(), 'https://receiver.test/hook', { signingService });

    const tamperedBody = new TextEncoder().encode('{"tampered": true}');
    const publicKeys = signingService.getPublicKeys();
    const verifyResult = await signingService.verify(capturedSignature, tamperedBody, publicKeys);
    expect(verifyResult.valid).toBe(false);
  });

  it('receiver can verify using discovery profile signing_keys', async () => {
    let capturedBody = '';
    let capturedSignature = '';

    vi.mocked(globalThis.fetch).mockImplementation(async (_url, init) => {
      const headers = init!.headers as Record<string, string>;
      capturedSignature = headers['Request-Signature']!;
      capturedBody = init!.body as string;
      return { ok: true, status: 200 } as Response;
    });

    await sendWebhook(createTestEvent(), 'https://receiver.test/hook', { signingService });

    const discoveryKeys = signingService.getPublicKeys();
    expect(discoveryKeys.length).toBeGreaterThan(0);
    expect(discoveryKeys[0]!['kty']).toBe('EC');
    expect(discoveryKeys[0]!['alg']).toBe('ES256');

    const bodyBytes = new TextEncoder().encode(capturedBody);
    const result = await signingService.verify(capturedSignature, bodyBytes, discoveryKeys);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.kid).toBe(discoveryKeys[0]!['kid']);
    }
  });

  it('webhook body contains all event fields', async () => {
    let capturedBody = '';

    vi.mocked(globalThis.fetch).mockImplementation(async (_url, init) => {
      capturedBody = init!.body as string;
      return { ok: true, status: 200 } as Response;
    });

    const event = createTestEvent({
      id: 'evt-body-check',
      type: 'order.fulfilled',
      tenant_id: 'tenant-xyz',
      occurred_at: '2026-03-29T15:00:00Z',
      payload: { order_id: 'ord-999', tracking: 'TRACK123' },
    });
    await sendWebhook(event, 'https://receiver.test/hook', { signingService });

    const parsed = JSON.parse(capturedBody) as Record<string, unknown>;
    expect(parsed['id']).toBe('evt-body-check');
    expect(parsed['type']).toBe('order.fulfilled');
    expect(parsed['occurred_at']).toBe('2026-03-29T15:00:00Z');
    expect(parsed['payload']).toEqual({ order_id: 'ord-999', tracking: 'TRACK123' });
  });

  it('does not include tenant_id in the webhook body', async () => {
    let capturedBody = '';

    vi.mocked(globalThis.fetch).mockImplementation(async (_url, init) => {
      capturedBody = init!.body as string;
      return { ok: true, status: 200 } as Response;
    });

    await sendWebhook(createTestEvent(), 'https://receiver.test/hook', { signingService });

    const parsed = JSON.parse(capturedBody) as Record<string, unknown>;
    expect(parsed['tenant_id']).toBeUndefined();
  });

  it('uses custom User-Agent when provided', async () => {
    let capturedUA = '';

    vi.mocked(globalThis.fetch).mockImplementation(async (_url, init) => {
      capturedUA = (init!.headers as Record<string, string>)['User-Agent']!;
      return { ok: true, status: 200 } as Response;
    });

    await sendWebhook(createTestEvent(), 'https://receiver.test/hook', {
      signingService,
      userAgent: 'CustomGateway/2.0',
    });

    expect(capturedUA).toBe('CustomGateway/2.0');
  });

  it('each webhook delivery gets a unique signature (ECDSA non-deterministic)', async () => {
    const signatures: string[] = [];

    vi.mocked(globalThis.fetch).mockImplementation(async (_url, init) => {
      signatures.push((init!.headers as Record<string, string>)['Request-Signature']!);
      return { ok: true, status: 200 } as Response;
    });

    await sendWebhook(createTestEvent(), 'https://receiver.test/hook', { signingService });
    await sendWebhook(createTestEvent(), 'https://receiver.test/hook', { signingService });

    expect(signatures).toHaveLength(2);
    expect(signatures[0]).not.toBe(signatures[1]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. WebhookSender — HTTP delivery edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe('WebhookSender: HTTP delivery edge cases', () => {
  let mockSigning: { sign: ReturnType<typeof vi.fn> } & Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    mockSigning = {
      initialize: vi.fn(),
      getPublicKeys: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      sign: vi.fn().mockResolvedValue('mock..sig') as never,
      verify: vi.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    globalThis.fetch = vi.fn() as never;
  });

  it('treats 301 redirect as non-retryable failure', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: false, status: 301 } as Response);

    const result = await sendWebhook(createTestEvent(), 'https://example.com/hook', {
      signingService: mockSigning as never,
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.statusCode).toBe(301);
  });

  it('treats 503 Service Unavailable as retryable', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: false, status: 503 } as Response);

    const result = await sendWebhook(createTestEvent(), 'https://example.com/hook', {
      signingService: mockSigning as never,
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.statusCode).toBe(503);
  });

  it('treats 429 Too Many Requests as non-retryable (4xx)', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: false, status: 429 } as Response);

    const result = await sendWebhook(createTestEvent(), 'https://example.com/hook', {
      signingService: mockSigning as never,
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
  });

  it('treats DNS resolution failure as retryable', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('fetch failed'));

    const result = await sendWebhook(createTestEvent(), 'https://nonexistent.invalid/hook', {
      signingService: mockSigning as never,
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.error).toBe('fetch failed');
  });

  it('treats timeout as retryable', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(
      new DOMException('signal timed out', 'AbortError'),
    );

    const result = await sendWebhook(createTestEvent(), 'https://slow.example/hook', {
      signingService: mockSigning as never,
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.error).toContain('timed out');
  });

  it('handles 200 with empty body as success', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: true, status: 200 } as Response);

    const result = await sendWebhook(createTestEvent(), 'https://example.com/hook', {
      signingService: mockSigning as never,
    });

    expect(result.success).toBe(true);
  });

  it('handles 202 Accepted as success', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: true, status: 202 } as Response);

    const result = await sendWebhook(createTestEvent(), 'https://example.com/hook', {
      signingService: mockSigning as never,
    });

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(202);
  });

  it('sends all four event types correctly', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: true, status: 200 } as Response);

    const types: WebhookEventType[] = [
      'order.created',
      'order.updated',
      'order.fulfilled',
      'order.canceled',
    ];

    for (const type of types) {
      const event = createTestEvent({ type });
      const result = await sendWebhook(event, 'https://example.com/hook', {
        signingService: mockSigning as never,
      });
      expect(result.success).toBe(true);

      const lastCall = vi.mocked(globalThis.fetch).mock.calls.at(-1)!;
      const headers = lastCall[1]!.headers as Record<string, string>;
      expect(headers['X-Webhook-Event']).toBe(type);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. webhook-bridge — tenant lookup and URL extraction
// ═══════════════════════════════════════════════════════════════════════════

describe('webhook-bridge: tenant settings and URL extraction', () => {
  it('enqueues webhook when tenant has webhook_url in settings', async () => {
    const { createWebhookBridge } = await import('../webhooks/webhook-bridge.js');

    const eventBus = new EventBus();
    const enqueued: Array<{ name: string; data: unknown }> = [];
    const mockQueue = {
      add: vi.fn(async (name: string, data: unknown) => {
        enqueued.push({ name, data });
      }),
    } as never;

    const mockTenantRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'tenant-001',
        slug: 'test',
        domain: 'test.localhost',
        platform: 'mock',
        adapterConfig: {},
        settings: { webhook_url: 'https://hooks.test/receive' },
      }),
    } as never;

    const mockLogger = { info: vi.fn(), warn: vi.fn() };

    createWebhookBridge(eventBus, mockQueue, mockTenantRepo, mockLogger);

    eventBus.emit(createTestEvent({ tenant_id: 'tenant-001' }));

    await vi.waitFor(() => expect(enqueued).toHaveLength(1));
    const job = enqueued[0]!;
    expect(job.name).toContain('order.created');
    expect((job.data as Record<string, unknown>)['webhookUrl']).toBe('https://hooks.test/receive');

    eventBus.removeAllListeners();
  });

  it('skips enqueue when tenant has no webhook_url', async () => {
    const { createWebhookBridge } = await import('../webhooks/webhook-bridge.js');

    const eventBus = new EventBus();
    const mockQueue = { add: vi.fn() } as never;
    const mockTenantRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'tenant-002',
        settings: {},
      }),
    } as never;
    const mockLogger = { info: vi.fn(), warn: vi.fn() };

    createWebhookBridge(eventBus, mockQueue, mockTenantRepo, mockLogger);
    eventBus.emit(createTestEvent({ tenant_id: 'tenant-002' }));

    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(mockQueue as { add: ReturnType<typeof vi.fn> }).add).not.toHaveBeenCalled();

    eventBus.removeAllListeners();
  });

  it('skips enqueue when tenant has null settings', async () => {
    const { createWebhookBridge } = await import('../webhooks/webhook-bridge.js');

    const eventBus = new EventBus();
    const mockQueue = { add: vi.fn() } as never;
    const mockTenantRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'tenant-003',
        settings: null,
      }),
    } as never;
    const mockLogger = { info: vi.fn(), warn: vi.fn() };

    createWebhookBridge(eventBus, mockQueue, mockTenantRepo, mockLogger);
    eventBus.emit(createTestEvent({ tenant_id: 'tenant-003' }));

    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(mockQueue as { add: ReturnType<typeof vi.fn> }).add).not.toHaveBeenCalled();

    eventBus.removeAllListeners();
  });

  it('skips enqueue when tenant has empty string webhook_url', async () => {
    const { createWebhookBridge } = await import('../webhooks/webhook-bridge.js');

    const eventBus = new EventBus();
    const mockQueue = { add: vi.fn() } as never;
    const mockTenantRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'tenant-004',
        settings: { webhook_url: '' },
      }),
    } as never;
    const mockLogger = { info: vi.fn(), warn: vi.fn() };

    createWebhookBridge(eventBus, mockQueue, mockTenantRepo, mockLogger);
    eventBus.emit(createTestEvent({ tenant_id: 'tenant-004' }));

    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(mockQueue as { add: ReturnType<typeof vi.fn> }).add).not.toHaveBeenCalled();

    eventBus.removeAllListeners();
  });

  it('logs warning when tenant not found', async () => {
    const { createWebhookBridge } = await import('../webhooks/webhook-bridge.js');

    const eventBus = new EventBus();
    const mockQueue = { add: vi.fn() } as never;
    const mockTenantRepo = {
      findById: vi.fn().mockResolvedValue(null),
    } as never;
    const mockLogger = { info: vi.fn(), warn: vi.fn() };

    createWebhookBridge(eventBus, mockQueue, mockTenantRepo, mockLogger);
    eventBus.emit(createTestEvent({ tenant_id: 'ghost-tenant' }));

    await vi.waitFor(() => expect(mockLogger.warn).toHaveBeenCalled());
    expect(String((mockLogger.warn.mock.calls as string[][])[0]![0])).toContain('ghost-tenant');

    eventBus.removeAllListeners();
  });

  it('logs warning and continues when tenant repo throws', async () => {
    const { createWebhookBridge } = await import('../webhooks/webhook-bridge.js');

    const eventBus = new EventBus();
    const mockQueue = { add: vi.fn() } as never;
    const mockTenantRepo = {
      findById: vi.fn().mockRejectedValue(new Error('DB connection lost')),
    } as never;
    const mockLogger = { info: vi.fn(), warn: vi.fn() };

    createWebhookBridge(eventBus, mockQueue, mockTenantRepo, mockLogger);
    eventBus.emit(createTestEvent());

    await vi.waitFor(() => expect(mockLogger.warn).toHaveBeenCalled());
    expect(String((mockLogger.warn.mock.calls as string[][])[0]![0])).toContain(
      'DB connection lost',
    );

    eventBus.removeAllListeners();
  });

  it('logs warning and continues when queue.add throws', async () => {
    const { createWebhookBridge } = await import('../webhooks/webhook-bridge.js');

    const eventBus = new EventBus();
    const mockQueue = {
      add: vi.fn().mockRejectedValue(new Error('Redis unavailable')),
    } as never;
    const mockTenantRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'tenant-005',
        settings: { webhook_url: 'https://hooks.test/receive' },
      }),
    } as never;
    const mockLogger = { info: vi.fn(), warn: vi.fn() };

    createWebhookBridge(eventBus, mockQueue, mockTenantRepo, mockLogger);
    eventBus.emit(createTestEvent({ tenant_id: 'tenant-005' }));

    await vi.waitFor(() => expect(mockLogger.warn).toHaveBeenCalled());
    expect(String((mockLogger.warn.mock.calls as string[][])[0]![0])).toContain(
      'Redis unavailable',
    );

    eventBus.removeAllListeners();
  });

  it('enqueues multiple events for the same tenant', async () => {
    const { createWebhookBridge } = await import('../webhooks/webhook-bridge.js');

    const eventBus = new EventBus();
    const enqueued: unknown[] = [];
    const mockQueue = {
      add: vi.fn(async (_name: string, data: unknown) => {
        enqueued.push(data);
      }),
    } as never;

    const mockTenantRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'tenant-006',
        settings: { webhook_url: 'https://hooks.test/receive' },
      }),
    } as never;
    const mockLogger = { info: vi.fn(), warn: vi.fn() };

    createWebhookBridge(eventBus, mockQueue, mockTenantRepo, mockLogger);

    eventBus.emit(createTestEvent({ id: 'evt-1', tenant_id: 'tenant-006', type: 'order.created' }));
    eventBus.emit(
      createTestEvent({ id: 'evt-2', tenant_id: 'tenant-006', type: 'order.canceled' }),
    );
    eventBus.emit(
      createTestEvent({ id: 'evt-3', tenant_id: 'tenant-006', type: 'order.fulfilled' }),
    );

    await vi.waitFor(() => expect(enqueued).toHaveLength(3));

    eventBus.removeAllListeners();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. WebhookWorker — queue configuration
// ═══════════════════════════════════════════════════════════════════════════

describe('WebhookWorker: queue creation', () => {
  it('creates a queue with correct name and retry config', async () => {
    const { createWebhookQueue, WEBHOOK_QUEUE_NAME } = await import('../webhooks/WebhookWorker.js');

    expect(WEBHOOK_QUEUE_NAME).toBe('ucp-webhooks');

    const queue = createWebhookQueue({ host: 'localhost', port: 63790 });

    expect(queue.name).toBe('ucp-webhooks');

    const defaults = queue.defaultJobOptions;
    expect(defaults?.attempts).toBe(5);
    expect(defaults?.backoff).toEqual({ type: 'exponential', delay: 10_000 });

    await queue.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. End-to-end: checkout complete → event → bridge → verifiable signature
// ═══════════════════════════════════════════════════════════════════════════

describe('E2E: checkout → webhook with verifiable JWT', () => {
  let app: FastifyInstance;
  let container: AwilixContainer<Cradle>;

  beforeAll(async () => {
    const result = await buildTestApp();
    app = result.app;
    container = result.container;
  });

  afterAll(async () => {
    await app.close();
  });

  it('complete checkout produces event that can be signed and verified by discovery keys', async () => {
    const eventBus = container.resolve('eventBus');
    const captured: WebhookEvent[] = [];
    eventBus.on('order.created', (e: WebhookEvent) => captured.push(e));

    const sessionId = await createReadySession(app);
    await completeSession(app, sessionId);

    expect(captured).toHaveLength(1);
    const event = captured[0]!;

    const profileRes = await app.inject({
      method: 'GET',
      url: '/.well-known/ucp',
      headers: { host: 'mock-store.localhost' },
    });
    const profile = JSON.parse(profileRes.body) as {
      signing_keys: Array<Record<string, unknown>>;
    };
    expect(profile.signing_keys.length).toBeGreaterThan(0);

    const signingService = container.resolve('signingService');
    const discoveryKeys = signingService.getPublicKeys();

    const body = JSON.stringify({
      id: event.id,
      type: event.type,
      occurred_at: event.occurred_at,
      payload: event.payload,
    });
    const bodyBytes = new TextEncoder().encode(body);
    const signature = await signingService.sign(bodyBytes);

    const verifyResult = await signingService.verify(signature, bodyBytes, discoveryKeys);
    expect(verifyResult.valid).toBe(true);

    eventBus.off('order.created', captured.push.bind(captured));
  });
});
