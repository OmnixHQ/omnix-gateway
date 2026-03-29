export type WebhookEventType =
  | 'order.created'
  | 'order.updated'
  | 'order.fulfilled'
  | 'order.canceled';

export interface WebhookEvent {
  readonly id: string;
  readonly type: WebhookEventType;
  readonly tenant_id: string;
  readonly occurred_at: string;
  readonly payload: Readonly<Record<string, unknown>>;
}
