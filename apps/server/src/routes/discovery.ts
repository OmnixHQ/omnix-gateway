import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PlatformAdapter, PaymentHandler, UCPPaymentHandler } from '@ucp-gateway/core';

const UCP_VERSION = '2026-01-23';
const UCP_SPEC_URL = 'https://ucp.dev/latest/specification/overview/';

function toUCPPaymentHandler(handler: PaymentHandler): UCPPaymentHandler {
  return {
    id: handler.id,
    name: handler.name,
    version: UCP_VERSION,
    spec: 'https://ucp.dev/latest/specification/checkout/',
    config_schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/payment-handler.json`,
    instrument_schemas: [],
    config: {},
  };
}

async function resolvePaymentHandlers(
  adapter: PlatformAdapter,
): Promise<readonly UCPPaymentHandler[]> {
  if (!adapter.getSupportedPaymentMethods) return [];
  try {
    const methods = await adapter.getSupportedPaymentMethods();
    return methods.map(toUCPPaymentHandler);
  } catch {
    return [];
  }
}

export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/.well-known/ucp', async (request: FastifyRequest) => {
    const profile = await request.adapter.getProfile();
    const adapterHandlers = await resolvePaymentHandlers(request.adapter);

    const existingHandlers = profile.payment?.handlers ?? [];
    const mergedHandlers = existingHandlers.length > 0 ? existingHandlers : adapterHandlers;

    const signingKeys = app.signingService.getPublicKeys();

    return {
      ...profile,
      signing_keys: signingKeys,
      payment: {
        ...profile.payment,
        handlers: mergedHandlers,
      },
    };
  });
}
