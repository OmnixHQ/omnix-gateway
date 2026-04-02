import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  UcpDiscoveryPlatformProfileSchema,
  PaymentHandlerResponseSchema,
  type UcpDiscoveryPlatformProfile,
  type PaymentHandlerResponse,
} from '@omnixhq/ucp-js-sdk';
import type { PlatformAdapter, PaymentHandler } from '@ucp-gateway/core';

const UCP_VERSION = '2026-01-23';
const PAYMENT_HANDLER_DOMAIN = 'dev.ucp.shopping.checkout';

function toUCPPaymentHandlerEntry(handler: PaymentHandler): PaymentHandlerResponse {
  const input = {
    id: handler.id,
    version: UCP_VERSION,
    spec: 'https://ucp.dev/latest/specification/checkout/',
    schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/payment-handler.json`,
    config: { name: handler.name, type: handler.type },
  };
  const result = PaymentHandlerResponseSchema.safeParse(input);
  return result.success ? result.data : (input as unknown as PaymentHandlerResponse);
}

async function resolvePaymentHandlers(
  adapter: PlatformAdapter,
): Promise<Record<string, readonly PaymentHandlerResponse[]>> {
  if (!adapter.getSupportedPaymentMethods) return {};
  try {
    const methods = await adapter.getSupportedPaymentMethods();
    if (methods.length === 0) return {};
    return { [PAYMENT_HANDLER_DOMAIN]: methods.map(toUCPPaymentHandlerEntry) };
  } catch {
    return {};
  }
}

export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/.well-known/ucp', async (request: FastifyRequest) => {
    const profile = await request.adapter.getProfile();
    const paymentHandlers = await resolvePaymentHandlers(request.adapter);
    const signingKeys = app.signingService.getPublicKeys();

    const profileHandlers = profile.ucp.payment_handlers ?? {};
    const mergedHandlers =
      Object.keys(profileHandlers).length > 0 ? profileHandlers : paymentHandlers;

    const profileCapabilities = profile.ucp.capabilities ?? {};
    const gatewayCapabilities = {
      'dev.ucp.shopping.catalog': [{ version: UCP_VERSION }],
      'dev.ucp.shopping.cart': [{ version: UCP_VERSION }],
      'dev.ucp.shopping.buyer_consent': [{ version: UCP_VERSION }],
      'dev.ucp.shopping.embedded_checkout': [{ version: UCP_VERSION }],
      'dev.ucp.shopping.identity_linking': [{ version: UCP_VERSION }],
      'dev.ucp.shopping.ap2_mandate': [{ version: UCP_VERSION }],
    };

    const input = {
      ucp: {
        ...profile.ucp,
        capabilities: { ...profileCapabilities, ...gatewayCapabilities },
        payment_handlers: mergedHandlers,
      },
      signing_keys: signingKeys,
    };

    const result = UcpDiscoveryPlatformProfileSchema.safeParse(input);
    if (result.success) return result.data;
    return input as unknown as UcpDiscoveryPlatformProfile;
  });
}
