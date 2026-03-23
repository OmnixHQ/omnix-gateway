import crypto from 'node:crypto';
import type { CheckoutSession, UpdateSessionData } from '@ucp-gateway/core';

const DEFAULT_TTL_SECONDS = 21600;

export class MockSessionStore {
  private readonly sessions = new Map<string, CheckoutSession>();

  async create(tenantId: string, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<CheckoutSession> {
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
      continue_url: null,
      messages: [],
      escalation: null,
      idempotency_key: null,
      expires_at: expiresAt.toISOString(),
      created_at: now.toISOString(),
    };

    this.sessions.set(id, session);
    return session;
  }

  async get(id: string): Promise<CheckoutSession | null> {
    return this.sessions.get(id) ?? null;
  }

  async update(id: string, data: UpdateSessionData): Promise<CheckoutSession | null> {
    const existing = this.sessions.get(id);
    if (!existing) return null;

    const updated: CheckoutSession = {
      ...existing,
      ...data,
      id: existing.id,
      tenant_id: existing.tenant_id,
      created_at: existing.created_at,
    };

    this.sessions.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.sessions.delete(id);
  }
}
