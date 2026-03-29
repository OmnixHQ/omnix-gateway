import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus, type WebhookEvent } from '@ucp-gateway/core';
import { sendWebhook } from '../webhooks/WebhookSender.js';

function createTestEvent(overrides?: Partial<WebhookEvent>): WebhookEvent {
  return {
    id: 'evt-test-001',
    type: 'order.created',
    tenant_id: 'tenant-001',
    occurred_at: '2026-03-29T12:00:00Z',
    payload: { order_id: 'order-123' },
    ...overrides,
  };
}

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  afterEach(() => {
    bus.removeAllListeners();
  });

  it('delivers events to type-specific listeners', () => {
    const handler = vi.fn();
    bus.on('order.created', handler);

    const event = createTestEvent();
    bus.emit(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('delivers all events to wildcard listeners', () => {
    const handler = vi.fn();
    bus.on('*', handler);

    const created = createTestEvent({ type: 'order.created' });
    const canceled = createTestEvent({ id: 'evt-002', type: 'order.canceled' });
    bus.emit(created);
    bus.emit(canceled);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, created);
    expect(handler).toHaveBeenNthCalledWith(2, canceled);
  });

  it('does not deliver events to unrelated type listeners', () => {
    const handler = vi.fn();
    bus.on('order.fulfilled', handler);

    bus.emit(createTestEvent({ type: 'order.created' }));

    expect(handler).not.toHaveBeenCalled();
  });

  it('removes listeners with off()', () => {
    const handler = vi.fn();
    bus.on('order.created', handler);
    bus.off('order.created', handler);

    bus.emit(createTestEvent());

    expect(handler).not.toHaveBeenCalled();
  });

  it('reports correct listener count', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('order.created', h1);
    bus.on('order.created', h2);
    bus.on('*', vi.fn());

    expect(bus.listenerCount('order.created')).toBe(2);
    expect(bus.listenerCount('*')).toBe(1);
  });
});

describe('WebhookSender', () => {
  let mockSigningService: {
    initialize: ReturnType<typeof vi.fn>;
    getPublicKeys: ReturnType<typeof vi.fn>;
    sign: ReturnType<typeof vi.fn>;
    verify: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSigningService = {
      initialize: vi.fn(),
      getPublicKeys: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      sign: vi.fn().mockResolvedValue('mock.detached.jws') as never,
      verify: vi.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    globalThis.fetch = vi.fn() as never;
  });

  it('sends a signed webhook with correct headers', async () => {
    const mockResponse = { ok: true, status: 200 } as Response;
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse);

    const event = createTestEvent();
    const result = await sendWebhook(event, 'https://example.com/webhook', {
      signingService: mockSigningService as never,
    });

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);

    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    expect(url).toBe('https://example.com/webhook');

    const headers = options!.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Request-Signature']).toBe('mock.detached.jws');
    expect(headers['X-Webhook-Id']).toBe('evt-test-001');
    expect(headers['X-Webhook-Event']).toBe('order.created');
    expect(headers['User-Agent']).toBe('UCP-Gateway/0.1.0');
  });

  it('calls signingService.sign with the body bytes', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: true, status: 200 } as Response);

    const event = createTestEvent();
    await sendWebhook(event, 'https://example.com/webhook', {
      signingService: mockSigningService as never,
    });

    expect(mockSigningService.sign).toHaveBeenCalledOnce();
    const signedBytes = mockSigningService.sign.mock.calls[0]![0] as Uint8Array;
    const bodyStr = new TextDecoder().decode(signedBytes);
    const parsed = JSON.parse(bodyStr) as Record<string, unknown>;
    expect(parsed['id']).toBe('evt-test-001');
    expect(parsed['type']).toBe('order.created');
  });

  it('returns retryable=true on 5xx responses', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: false, status: 502 } as Response);

    const result = await sendWebhook(createTestEvent(), 'https://example.com/webhook', {
      signingService: mockSigningService as never,
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.statusCode).toBe(502);
  });

  it('returns retryable=false on 4xx responses', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: false, status: 400 } as Response);

    const result = await sendWebhook(createTestEvent(), 'https://example.com/webhook', {
      signingService: mockSigningService as never,
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
  });

  it('returns retryable=true on network errors', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await sendWebhook(createTestEvent(), 'https://example.com/webhook', {
      signingService: mockSigningService as never,
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.error).toBe('ECONNREFUSED');
  });

  it('returns retryable=false on signing failure', async () => {
    mockSigningService.sign.mockRejectedValueOnce(new Error('Key not initialized'));

    const result = await sendWebhook(createTestEvent(), 'https://example.com/webhook', {
      signingService: mockSigningService as never,
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.error).toContain('Signing failed');
  });
});
