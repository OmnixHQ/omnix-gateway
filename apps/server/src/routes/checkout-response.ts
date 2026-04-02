import {
  CheckoutResponseStatusSchema,
  CheckoutResponseSchema,
  type CheckoutResponse,
} from '@omnixhq/ucp-js-sdk';
import type { CheckoutSession, CheckoutLink, PaymentHandler } from '@ucp-gateway/core';

const UCP_VERSION = '2026-01-23';

const TERMINAL_STATUSES = new Set(['completed', 'canceled']);

function resolveContinueUrl(session: CheckoutSession, tenantDomain?: string): string | undefined {
  if (session.continue_url) return session.continue_url;
  if (TERMINAL_STATUSES.has(session.status)) return undefined;
  if (!tenantDomain) return undefined;
  return `https://${tenantDomain}/checkout/${session.id}`;
}

/** Settings shape expected on the tenant object (subset of tenant.settings). */
export interface TenantLinkSettings {
  readonly privacy_policy_url?: string;
  readonly terms_of_service_url?: string;
  readonly domain?: string;
}

function resolveDefaultLinks(tenantSettings?: TenantLinkSettings): readonly CheckoutLink[] {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const devFallback = nodeEnv !== 'production';

  const privacyUrl =
    tenantSettings?.privacy_policy_url ||
    process.env['PRIVACY_POLICY_URL'] ||
    (devFallback ? 'https://example.com/privacy' : undefined);

  const termsUrl =
    tenantSettings?.terms_of_service_url ||
    process.env['TERMS_OF_SERVICE_URL'] ||
    (devFallback ? 'https://example.com/terms' : undefined);

  const links: CheckoutLink[] = [];
  if (privacyUrl) links.push({ type: 'privacy_policy', url: privacyUrl });
  if (termsUrl) links.push({ type: 'terms_of_service', url: termsUrl });
  return links;
}

export interface CheckoutResponseOptions {
  readonly tenantSettings?: TenantLinkSettings | undefined;
  readonly paymentHandlers?: readonly PaymentHandler[] | undefined;
  readonly embeddedConfig?:
    | {
        readonly url: string;
        readonly type?: string;
        readonly width?: number;
        readonly height?: number;
      }
    | null
    | undefined;
}

function buildCheckoutResponse(
  session: CheckoutSession,
  options?: CheckoutResponseOptions,
): CheckoutResponse {
  const tenantSettings = options?.tenantSettings;
  const links = session.links.length > 0 ? session.links : resolveDefaultLinks(tenantSettings);
  const statusResult = CheckoutResponseStatusSchema.safeParse(session.status);

  const input = {
    ucp: {
      version: UCP_VERSION,
      status: 'success' as const,
      capabilities: {
        'dev.ucp.shopping.checkout': [{ version: UCP_VERSION }],
        'dev.ucp.shopping.fulfillment': [
          {
            version: UCP_VERSION,
            spec: 'https://ucp.dev/latest/specification/fulfillment/',
            schema: 'https://ucp.dev/2026-01-23/schemas/shopping/fulfillment.json',
            extends: 'dev.ucp.shopping.checkout',
          },
        ],
        'dev.ucp.shopping.discounts': [
          {
            version: UCP_VERSION,
            spec: 'https://ucp.dev/latest/specification/discounts/',
            schema: 'https://ucp.dev/2026-01-23/schemas/shopping/discounts.json',
            extends: 'dev.ucp.shopping.checkout',
          },
        ],
      },
      payment_handlers: Object.fromEntries(
        (options?.paymentHandlers ?? []).map((h) => [
          h.id,
          [
            {
              id: h.id,
              version: UCP_VERSION,
              spec: 'https://ucp.dev/latest/specification/checkout/',
              schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/payment-handler.json`,
              config: { name: h.name, type: h.type },
            },
          ],
        ]),
      ),
    },
    id: session.id,
    status: statusResult.success ? statusResult.data : session.status,
    line_items: session.line_items.map((li) => ({
      id: li.id,
      item: {
        id: li.item.id,
        title: li.item.title ?? '',
        price: li.item.price ?? 0,
        image_url: li.item.image_url,
      },
      quantity: li.quantity,
      totals: li.totals ?? [],
    })),
    currency: session.currency ?? 'USD',
    totals: session.totals ?? [],
    links,
    messages: session.messages ?? [],
    ...(session.buyer ? { buyer: session.buyer } : {}),
    ...(session.shipping_address ? { shipping_address: session.shipping_address } : {}),
    ...(session.billing_address ? { billing_address: session.billing_address } : {}),
    ...(session.order
      ? { order: { id: session.order.id, permalink_url: session.order.permalink_url } }
      : {}),
    ...(resolveContinueUrl(session, tenantSettings?.domain)
      ? { continue_url: resolveContinueUrl(session, tenantSettings?.domain) }
      : {}),
    ...(session.expires_at ? { expires_at: session.expires_at } : {}),
    ...(session.fulfillment ? { fulfillment: session.fulfillment } : {}),
    ...(session.discounts ? { discounts: session.discounts } : {}),
    ...(session.consent ? { consent: session.consent } : {}),
    ...(session.signals ? { signals: session.signals } : {}),
    ...(session.status === 'requires_escalation' && options?.embeddedConfig
      ? { embedded: options.embeddedConfig }
      : {}),
    payment: {
      instruments: (options?.paymentHandlers ?? []).map((h) => ({
        id: `instr_${h.id}`,
        handler_id: h.id,
        type: h.type,
        selected: false,
      })),
    },
  };

  const result = CheckoutResponseSchema.safeParse(input);
  if (result.success) return result.data;

  if (process.env['NODE_ENV'] !== 'test') {
    console.warn(
      '[checkout-response] SDK validation failed, returning unvalidated:',
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return input as unknown as CheckoutResponse;
}

export function toPublicCheckoutResponse(
  session: CheckoutSession,
  tenantSettingsOrOptions?: TenantLinkSettings | CheckoutResponseOptions,
): CheckoutResponse {
  const isOptionsObject =
    tenantSettingsOrOptions !== undefined &&
    tenantSettingsOrOptions !== null &&
    ('paymentHandlers' in tenantSettingsOrOptions || 'tenantSettings' in tenantSettingsOrOptions);
  const options: CheckoutResponseOptions = isOptionsObject
    ? tenantSettingsOrOptions
    : { tenantSettings: tenantSettingsOrOptions as TenantLinkSettings | undefined };
  return buildCheckoutResponse(session, options);
}
