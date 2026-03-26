import crypto from 'node:crypto';
import type { Redis as RedisType } from 'ioredis';
import type {
  PostalAddress,
  Total,
  CheckoutLink,
  OrderConfirmation,
  Buyer,
  UCPMessage,
  Fulfillment,
} from '../types/commerce.js';
import type { EscalationDetails } from '../types/errors.js';

export type SessionStatus =
  | 'incomplete'
  | 'ready_for_complete'
  | 'complete_in_progress'
  | 'completed'
  | 'canceled'
  | 'requires_escalation';

export interface CheckoutSessionLineItem {
  readonly id: string;
  readonly item: {
    readonly id: string;
    readonly title?: string | undefined;
    readonly price?: number | undefined;
    readonly image_url?: string | undefined;
  };
  readonly quantity: number;
  readonly totals: readonly Total[];
}

export interface AppliedDiscount {
  readonly title: string;
  readonly amount: number;
  readonly code?: string | undefined;
  readonly automatic?: boolean | undefined;
  readonly method?: 'each' | 'across' | undefined;
}

export interface CheckoutDiscounts {
  readonly codes: readonly string[];
  readonly applied: readonly AppliedDiscount[];
}

export interface CheckoutSession {
  readonly id: string;
  readonly tenant_id: string;
  readonly cart_id: string | null;
  readonly status: SessionStatus;
  readonly line_items: readonly CheckoutSessionLineItem[];
  readonly currency: string;
  readonly totals: readonly Total[];
  readonly links: readonly CheckoutLink[];
  readonly buyer: Buyer | null;
  readonly shipping_address: PostalAddress | null;
  readonly billing_address: PostalAddress | null;
  readonly order: OrderConfirmation | null;
  readonly continue_url: string | null;
  readonly messages: readonly UCPMessage[];
  readonly fulfillment: Fulfillment | null;
  readonly discounts: CheckoutDiscounts | null;
  readonly escalation: EscalationDetails | null;
  readonly idempotency_key: string | null;
  readonly expires_at: string;
  readonly created_at: string;
}

/** Fields that may be provided when updating a session. */
export type UpdateSessionData = Partial<Omit<CheckoutSession, 'id' | 'tenant_id' | 'created_at'>>;

const KEY_PREFIX = 'session:';
const DEFAULT_TTL_SECONDS = 21600;

export class SessionStore {
  private readonly redis: RedisType;

  constructor(redis: RedisType) {
    this.redis = redis;
  }

  async create(
    tenantId: string,
    ttlSeconds: number = DEFAULT_TTL_SECONDS,
  ): Promise<CheckoutSession> {
    const id = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    const session: CheckoutSession = {
      id,
      tenant_id: tenantId,
      cart_id: null,
      status: 'incomplete',
      line_items: [],
      currency: 'USD',
      totals: [],
      links: [],
      buyer: null,
      shipping_address: null,
      billing_address: null,
      order: null,
      fulfillment: null,
      discounts: null,
      continue_url: null,
      messages: [],
      escalation: null,
      idempotency_key: null,
      expires_at: expiresAt.toISOString(),
      created_at: now.toISOString(),
    };

    await this.redis.setex(buildSessionKey(id), ttlSeconds, JSON.stringify(session));
    return session;
  }

  async get(id: string): Promise<CheckoutSession | null> {
    const raw = await this.redis.get(buildSessionKey(id));
    if (raw === null) return null;
    return JSON.parse(raw) as CheckoutSession;
  }

  async update(id: string, data: UpdateSessionData): Promise<CheckoutSession | null> {
    const existing = await this.get(id);
    if (existing === null) return null;

    const updated: CheckoutSession = {
      ...existing,
      ...data,
      id: existing.id,
      tenant_id: existing.tenant_id,
      created_at: existing.created_at,
    };

    const ttl = await this.redis.ttl(buildSessionKey(id));
    const effectiveTtl = ttl > 0 ? ttl : DEFAULT_TTL_SECONDS;

    await this.redis.setex(buildSessionKey(id), effectiveTtl, JSON.stringify(updated));
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const removed = await this.redis.del(buildSessionKey(id));
    return removed > 0;
  }
}

function buildSessionKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}
