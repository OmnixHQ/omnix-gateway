import type { Queue } from 'bullmq';
import type { EventBus, TenantRepository, WebhookEvent } from '@ucp-gateway/core';
import type { WebhookJobData } from './WebhookWorker.js';

interface TenantWebhookSettings {
  readonly webhook_url?: string;
}

interface MinimalLogger {
  readonly info: (msg: string, ...args: unknown[]) => void;
  readonly warn: (msg: string, ...args: unknown[]) => void;
}

function extractWebhookUrl(settings: unknown): string | undefined {
  if (!settings || typeof settings !== 'object') return undefined;
  const s = settings as TenantWebhookSettings;
  return typeof s.webhook_url === 'string' && s.webhook_url.length > 0 ? s.webhook_url : undefined;
}

export function createWebhookBridge(
  eventBus: EventBus,
  webhookQueue: Queue<WebhookJobData>,
  tenantRepository: TenantRepository,
  logger: MinimalLogger,
): void {
  eventBus.on('*', (event: WebhookEvent) => {
    void enqueueWebhook(event, webhookQueue, tenantRepository, logger);
  });
}

async function enqueueWebhook(
  event: WebhookEvent,
  webhookQueue: Queue<WebhookJobData>,
  tenantRepository: TenantRepository,
  logger: MinimalLogger,
): Promise<void> {
  try {
    const tenant = await tenantRepository.findById(event.tenant_id);
    if (!tenant) {
      logger.warn(`Webhook skipped: tenant ${event.tenant_id} not found`);
      return;
    }

    const webhookUrl = extractWebhookUrl(tenant.settings);
    if (!webhookUrl) return;

    await webhookQueue.add(`${event.type}:${event.id}`, {
      event,
      webhookUrl,
      tenantId: tenant.id,
    });

    logger.info(`Webhook enqueued: ${event.type} (${event.id}) for tenant ${tenant.id}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.warn(`Failed to enqueue webhook ${event.id}: ${message}`);
  }
}
