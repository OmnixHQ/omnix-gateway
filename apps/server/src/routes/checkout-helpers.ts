import { createHash } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import type { CheckoutSession, Tenant } from '@ucp-gateway/core';
import type { Redis as RedisType } from 'ioredis';

const IDEMPOTENCY_TTL_SECONDS = 86400; // 24 hours per spec
const UCP_VERSION = '2026-01-23';

export type MessageSeverity = 'recoverable' | 'requires_buyer_input' | 'requires_buyer_review';

export function sendSessionError(
  reply: FastifyReply,
  code: string,
  message: string,
  httpStatus: number,
  severity: MessageSeverity = 'recoverable',
  sessionStatus?: string,
): FastifyReply {
  return reply.status(httpStatus).send({
    status: sessionStatus ?? 'incomplete',
    messages: [{ type: 'error', code, content: message, severity }],
    ucp: {
      version: UCP_VERSION,
      capabilities: [{ name: 'dev.ucp.shopping.checkout', version: UCP_VERSION }],
    },
  });
}

export function buildUCPErrorBody(
  code: string,
  message: string,
  severity: MessageSeverity = 'recoverable',
  sessionStatus: string = 'incomplete',
): {
  readonly status: string;
  readonly messages: readonly {
    readonly type: 'error';
    readonly code: string;
    readonly content: string;
    readonly severity: string;
  }[];
  readonly ucp: {
    readonly version: string;
    readonly capabilities: readonly { readonly name: string; readonly version: string }[];
  };
} {
  return {
    status: sessionStatus,
    messages: [{ type: 'error' as const, code, content: message, severity }],
    ucp: {
      version: UCP_VERSION,
      capabilities: [{ name: 'dev.ucp.shopping.checkout', version: UCP_VERSION }],
    },
  };
}

export function isSessionExpired(session: CheckoutSession): boolean {
  return new Date(session.expires_at).getTime() < Date.now();
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
      reply: reply
        .status(409)
        .send(
          buildUCPErrorBody(
            'idempotency_conflict',
            'Idempotency key reused with different parameters',
          ),
        ),
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
