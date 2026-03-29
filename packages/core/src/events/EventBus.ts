import { EventEmitter } from 'node:events';
import type { WebhookEvent, WebhookEventType } from './types.js';

type EventHandler = (event: WebhookEvent) => void;

export class EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(20);
  }

  emit(event: WebhookEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event);
  }

  on(type: WebhookEventType | '*', handler: EventHandler): void {
    this.emitter.on(type, handler);
  }

  off(type: WebhookEventType | '*', handler: EventHandler): void {
    this.emitter.off(type, handler);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }

  listenerCount(type: WebhookEventType | '*'): number {
    return this.emitter.listenerCount(type);
  }
}
