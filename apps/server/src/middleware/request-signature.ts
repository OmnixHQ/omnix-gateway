import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { SigningService } from '@ucp-gateway/core';

const SKIP_PATHS = new Set(['/health', '/ready']);
const REQUEST_SIGNATURE_HEADER = 'request-signature';

function shouldSkipSignatureCheck(url: string): boolean {
  const path = url.split('?')[0]!;
  return SKIP_PATHS.has(path) || path.startsWith('/.well-known/');
}

function hasBody(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH';
}

declare module 'fastify' {
  interface FastifyInstance {
    signingService: SigningService;
  }
  interface FastifyRequest {
    signatureVerified?: boolean | undefined;
  }
}

export const requestSignaturePlugin = fp(async function requestSignature(
  app: FastifyInstance,
): Promise<void> {
  app.decorateRequest('signatureVerified', undefined);

  app.addHook('preHandler', async (request: FastifyRequest, _reply: FastifyReply) => {
    if (shouldSkipSignatureCheck(request.url)) return;
    if (!hasBody(request.method)) return;

    const signatureHeader = request.headers[REQUEST_SIGNATURE_HEADER];
    if (!signatureHeader || typeof signatureHeader !== 'string') return;

    // WHY: best-effort verification — log result but don't reject.
    // Many agents don't sign requests yet; enforcement comes in a later phase.
    try {
      const rawBody =
        typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? '');
      const bodyBytes = new TextEncoder().encode(rawBody);
      const signingKeys = app.signingService.getPublicKeys();
      const result = await app.signingService.verify(signatureHeader, bodyBytes, signingKeys);

      request.signatureVerified = result.valid;
      request.log.info(
        {
          signatureValid: result.valid,
          error: result.valid ? undefined : result.error,
          method: request.method,
          url: request.url,
        },
        'Request-Signature verification result',
      );
    } catch (err) {
      request.signatureVerified = false;
      request.log.warn(
        { err, method: request.method, url: request.url },
        'Request-Signature verification failed unexpectedly',
      );
    }
  });
});
