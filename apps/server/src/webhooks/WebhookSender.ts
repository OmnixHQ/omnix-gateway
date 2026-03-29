import type { SigningService } from '@ucp-gateway/core';
import type { WebhookEvent } from '@ucp-gateway/core';

export interface WebhookDeliveryResult {
  readonly success: boolean;
  readonly statusCode?: number;
  readonly error?: string;
  readonly retryable: boolean;
}

export interface WebhookSenderDeps {
  readonly signingService: SigningService;
  readonly userAgent?: string;
}

export async function sendWebhook(
  event: WebhookEvent,
  webhookUrl: string,
  deps: WebhookSenderDeps,
): Promise<WebhookDeliveryResult> {
  const body = JSON.stringify({
    id: event.id,
    type: event.type,
    occurred_at: event.occurred_at,
    payload: event.payload,
  });

  const bodyBytes = new TextEncoder().encode(body);

  let signature: string;
  try {
    signature = await deps.signingService.sign(bodyBytes);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown signing error';
    return { success: false, error: `Signing failed: ${message}`, retryable: false };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Request-Signature': signature,
        'X-Webhook-Id': event.id,
        'X-Webhook-Event': event.type,
        'User-Agent': deps.userAgent ?? 'UCP-Gateway/0.1.0',
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });

    if (response.ok) {
      return { success: true, statusCode: response.status, retryable: false };
    }

    const retryable = response.status >= 500;
    return {
      success: false,
      statusCode: response.status,
      error: `HTTP ${response.status}`,
      retryable,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown network error';
    return { success: false, error: message, retryable: true };
  }
}
