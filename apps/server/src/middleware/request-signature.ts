import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { SigningService, extractKidFromSignature } from '@ucp-gateway/core';

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
    signatureKid?: string | undefined;
  }
}

export const requestSignaturePlugin = fp(async function requestSignature(
  app: FastifyInstance,
): Promise<void> {
  app.decorateRequest('signatureKid', undefined);

  app.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    if (shouldSkipSignatureCheck(request.url)) return;
    if (!hasBody(request.method)) return;

    const signatureHeader = request.headers[REQUEST_SIGNATURE_HEADER];
    if (!signatureHeader || typeof signatureHeader !== 'string') return;

    // WHY: best-effort — agents rarely sign yet; enforcement deferred to later phase
    const kid = extractKidFromSignature(signatureHeader);
    request.signatureKid = kid ?? undefined;
    request.log.info(
      { kid, method: request.method, url: request.url },
      'Request-Signature header present',
    );
  });
});
