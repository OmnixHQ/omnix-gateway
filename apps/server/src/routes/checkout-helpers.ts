import type { FastifyReply } from 'fastify';
import type { CheckoutSession, Tenant } from '@ucp-gateway/core';
import type { Redis as RedisType } from 'ioredis';

const IDEMPOTENCY_TTL_SECONDS = 1800;

export function sendSessionError(
  reply: FastifyReply,
  code: string,
  message: string,
  httpStatus: number,
): FastifyReply {
  return reply.status(httpStatus).send({
    messages: [{ type: 'error', code, content: message, severity: 'recoverable' }],
  });
}

export function isSessionExpired(session: CheckoutSession): boolean {
  return session.status === 'expired';
}

export function isSessionOwnedByTenant(session: CheckoutSession, tenant: Tenant): boolean {
  return session.tenant_id === tenant.id;
}

export function hasSessionAlreadyCompleted(session: CheckoutSession): boolean {
  return session.status === 'completed' && session.order !== null;
}

export async function findExistingSessionByIdempotencyKey(
  redis: RedisType,
  tenantId: string,
  idempotencyKey: string,
): Promise<string | null> {
  const cacheKey = buildIdempotencyKey(tenantId, idempotencyKey);
  return redis.get(cacheKey);
}

export async function storeIdempotencyMapping(
  redis: RedisType,
  tenantId: string,
  idempotencyKey: string,
  sessionId: string,
): Promise<void> {
  const cacheKey = buildIdempotencyKey(tenantId, idempotencyKey);
  await redis.setex(cacheKey, IDEMPOTENCY_TTL_SECONDS, sessionId);
}

function buildIdempotencyKey(tenantId: string, idempotencyKey: string): string {
  return `idempotency:${tenantId}:${idempotencyKey}`;
}
