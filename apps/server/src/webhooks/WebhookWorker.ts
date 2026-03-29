import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { SigningService, WebhookEvent } from '@ucp-gateway/core';
import { sendWebhook } from './WebhookSender.js';

export const WEBHOOK_QUEUE_NAME = 'ucp-webhooks';

export interface WebhookJobData {
  readonly event: WebhookEvent;
  readonly webhookUrl: string;
  readonly tenantId: string;
}

interface MinimalLogger {
  readonly info: (msg: string, ...args: unknown[]) => void;
  readonly warn: (msg: string, ...args: unknown[]) => void;
  readonly error: (msg: string, ...args: unknown[]) => void;
}

export function createWebhookQueue(connection: ConnectionOptions): Queue<WebhookJobData> {
  return new Queue<WebhookJobData>(WEBHOOK_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 5000 },
    },
  });
}

export function createWebhookWorker(
  connection: ConnectionOptions,
  signingService: SigningService,
  logger: MinimalLogger,
): Worker<WebhookJobData> {
  const processor = async (job: Job<WebhookJobData>): Promise<void> => {
    const { event, webhookUrl, tenantId } = job.data;

    logger.info(`Delivering webhook ${event.type} (${event.id}) to tenant ${tenantId}`);

    const result = await sendWebhook(event, webhookUrl, { signingService });

    if (result.success) {
      logger.info(`Webhook delivered: ${event.type} (${event.id}) → ${result.statusCode}`);
      return;
    }

    logger.warn(
      `Webhook delivery failed: ${event.type} (${event.id}) → ${result.error}` +
        ` (retryable: ${result.retryable}, attempt: ${job.attemptsMade + 1}/${job.opts.attempts ?? 5})`,
    );

    if (result.retryable) {
      throw new Error(`Webhook delivery failed (retryable): ${result.error}`);
    }

    logger.error(`Webhook permanently failed: ${event.type} (${event.id}) → ${result.error}`);
  };

  return new Worker<WebhookJobData>(WEBHOOK_QUEUE_NAME, processor, {
    connection,
    concurrency: 5,
  });
}
