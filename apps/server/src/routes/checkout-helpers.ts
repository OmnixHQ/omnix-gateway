import { createHash } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import type { CheckoutSession, Tenant } from '@ucp-gateway/core';
import type { Redis as RedisType } from 'ioredis';

const IDEMPOTENCY_TTL_SECONDS = 86400; // 24 hours per spec

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

export function computeRequestHash(body: unknown): string {
  const sortedJson = JSON.stringify(body, (_key, value) =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.keys(value as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>((sorted, k) => {
            sorted[k] = (value as Record<string, unknown>)[k];
            return sorted;
          }, {})
      : (value as unknown),
  );
  return createHash('sha256').update(sortedJson).digest('hex');
}

interface IdempotencyRecord {
  readonly hash: string;
  readonly status: number;
  readonly body: string;
}

export async function checkIdempotencyKey(
  redis: RedisType,
  tenantId: string,
  idempotencyKey: string,
  requestBody: unknown,
  reply: FastifyReply,
): Promise<{ cached: true; reply: FastifyReply } | { cached: false; hash: string } | null> {
  const cacheKey = buildIdempotencyKey(tenantId, idempotencyKey);
  const raw = await redis.get(cacheKey);

  if (!raw) {
    return { cached: false, hash: computeRequestHash(requestBody) };
  }

  const record = JSON.parse(raw) as IdempotencyRecord;
  const currentHash = computeRequestHash(requestBody);

  if (record.hash !== currentHash) {
    return {
      cached: true,
      reply: reply.status(409).send({
        messages: [
          {
            type: 'error',
            code: 'idempotency_conflict',
            content: 'Idempotency key reused with different parameters',
            severity: 'recoverable',
          },
        ],
      }),
    };
  }

  return {
    cached: true,
    reply: reply.status(record.status).send(JSON.parse(record.body)),
  };
}

export async function storeIdempotencyRecord(
  redis: RedisType,
  tenantId: string,
  idempotencyKey: string,
  hash: string,
  status: number,
  responseBody: string,
): Promise<void> {
  const cacheKey = buildIdempotencyKey(tenantId, idempotencyKey);
  const record: IdempotencyRecord = { hash, status, body: responseBody };
  await redis.setex(cacheKey, IDEMPOTENCY_TTL_SECONDS, JSON.stringify(record));
}

function buildIdempotencyKey(tenantId: string, idempotencyKey: string): string {
  return `idempotency:${tenantId}:${idempotencyKey}`;
}
