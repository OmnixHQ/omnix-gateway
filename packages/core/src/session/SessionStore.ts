/**
 * Redis-backed checkout session store.
 *
 * Sessions are stored as JSON strings with automatic TTL expiry.
 * Key format: `session:{id}`
 */

import crypto from 'node:crypto';
import type { Redis as RedisType } from 'ioredis';
import type { Address, Totals } from '../types/commerce.js';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export type SessionStatus =
  | 'incomplete'
  | 'ready_for_complete'
  | 'completed'
  | 'cancelled'
  | 'expired';

export interface CheckoutSession {
  readonly id: string;
  readonly tenant_id: string;
  readonly cart_id: string | null;
  readonly status: SessionStatus;
  readonly shipping_address: Address | null;
  readonly billing_address: Address | null;
  readonly totals: Totals | null;
  readonly order_id: string | null;
  readonly idempotency_key: string | null;
  readonly created_at: string;
  readonly expires_at: string;
}

/** Fields that may be provided when updating a session. */
export type UpdateSessionData = Partial<
  Omit<CheckoutSession, 'id' | 'tenant_id' | 'created_at'>
>;

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const KEY_PREFIX = 'session:';
const DEFAULT_TTL_SECONDS = 1800; // 30 minutes

// ──────────────────────────────────────────────
// SessionStore
// ──────────────────────────────────────────────

export class SessionStore {
  private readonly redis: RedisType;

  constructor(redis: RedisType) {
    this.redis = redis;
  }

  /**
   * Create a new checkout session for the given tenant.
   *
   * @param tenantId - The tenant that owns the session.
   * @param ttlSeconds - Time-to-live in seconds (default 1800).
   * @returns The newly created session.
   */
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
      shipping_address: null,
      billing_address: null,
      totals: null,
      order_id: null,
      idempotency_key: null,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    await this.redis.setex(
      `${KEY_PREFIX}${id}`,
      ttlSeconds,
      JSON.stringify(session),
    );

    return session;
  }

  /**
   * Retrieve a session by ID.
   *
   * @returns The session, or `null` if the key does not exist (e.g. expired).
   */
  async get(id: string): Promise<CheckoutSession | null> {
    const raw = await this.redis.get(`${KEY_PREFIX}${id}`);
    if (raw === null) {
      return null;
    }
    return JSON.parse(raw) as CheckoutSession;
  }

  /**
   * Update a session with partial data. The TTL is refreshed on every update
   * using the remaining time derived from `expires_at`, or falls back to the
   * default TTL when the expiry cannot be determined.
   *
   * @returns The updated session, or `null` if the session does not exist.
   */
  async update(
    id: string,
    data: UpdateSessionData,
  ): Promise<CheckoutSession | null> {
    const existing = await this.get(id);
    if (existing === null) {
      return null;
    }

    const updated: CheckoutSession = {
      ...existing,
      ...data,
      // Preserve immutable fields regardless of what was passed in `data`.
      id: existing.id,
      tenant_id: existing.tenant_id,
      created_at: existing.created_at,
    };

    const ttl = await this.redis.ttl(`${KEY_PREFIX}${id}`);
    const effectiveTtl = ttl > 0 ? ttl : DEFAULT_TTL_SECONDS;

    await this.redis.setex(
      `${KEY_PREFIX}${id}`,
      effectiveTtl,
      JSON.stringify(updated),
    );

    return updated;
  }

  /**
   * Delete a session by ID.
   *
   * @returns `true` if a session was deleted, `false` otherwise.
   */
  async delete(id: string): Promise<boolean> {
    const removed = await this.redis.del(`${KEY_PREFIX}${id}`);
    return removed > 0;
  }
}
