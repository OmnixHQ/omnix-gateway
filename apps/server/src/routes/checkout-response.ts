import { CheckoutResponseStatusSchema, ExtendedCheckoutResponseSchema } from '@ucp-js/sdk';
import type { CheckoutSession, CheckoutLink, PaymentHandler } from '@ucp-gateway/core';

const UCP_VERSION = '2026-01-23';

const TERMINAL_STATUSES = new Set(['completed', 'canceled']);

function resolveContinueUrl(session: CheckoutSession, tenantDomain?: string): string | null {
  if (session.continue_url) return session.continue_url;
  if (TERMINAL_STATUSES.has(session.status)) return null;
  if (!tenantDomain) return null;
  return `https://${tenantDomain}/checkout/${session.id}`;
}

/** Settings shape expected on the tenant object (subset of tenant.settings). */
export interface TenantLinkSettings {
  readonly privacy_policy_url?: string;
  readonly terms_of_service_url?: string;
  readonly domain?: string;
}

/**
 * Resolve privacy/terms links from tenant settings, then env vars,
 * then example.com only in non-production mode.
 */
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
}

function buildRawResponse(
  session: CheckoutSession,
  options?: CheckoutResponseOptions,
): Record<string, unknown> {
  const tenantSettings = options?.tenantSettings;
  const links = session.links.length > 0 ? session.links : resolveDefaultLinks(tenantSettings);

  const status = CheckoutResponseStatusSchema.safeParse(session.status);

  return {
    id: session.id,
    status: status.success ? status.data : session.status,
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
    buyer: session.buyer,
    shipping_address: session.shipping_address,
    billing_address: session.billing_address,
    order: session.order ?? null,
    continue_url: resolveContinueUrl(session, tenantSettings?.domain),
    messages: session.messages,
    expires_at: session.expires_at,
    fulfillment: session.fulfillment ?? undefined,
    discounts: session.discounts ?? undefined,
    payment: {
      handlers: (options?.paymentHandlers ?? []).map((h) => ({
        id: h.id,
        name: h.name,
        version: UCP_VERSION,
        spec: 'https://ucp.dev/latest/specification/checkout/',
        config_schema: `https://ucp.dev/${UCP_VERSION}/schemas/shopping/payment-handler.json`,
        instrument_schemas: [],
        config: {},
      })),
      instruments: [],
    },
    ucp: {
      version: UCP_VERSION,
      capabilities: [
        { name: 'dev.ucp.shopping.checkout', version: UCP_VERSION },
        {
          name: 'dev.ucp.shopping.fulfillment',
          version: UCP_VERSION,
          spec: 'https://ucp.dev/latest/specification/fulfillment/',
          schema: 'https://ucp.dev/2026-01-23/schemas/shopping/fulfillment.json',
          extends: 'dev.ucp.shopping.checkout',
        },
        {
          name: 'dev.ucp.shopping.discounts',
          version: UCP_VERSION,
          spec: 'https://ucp.dev/latest/specification/discounts/',
          schema: 'https://ucp.dev/2026-01-23/schemas/shopping/discounts.json',
          extends: 'dev.ucp.shopping.checkout',
        },
      ],
    },
  };
}

/**
 * Transforms an internal CheckoutSession into the public API response shape.
 *
 * We attempt to validate against ExtendedCheckoutResponseSchema so that
 * any drift between our internal model and the SDK is caught early.
 * If validation fails we still return the raw response (graceful degradation)
 * but log a warning so we can fix the mismatch.
 */
export function toPublicCheckoutResponse(
  session: CheckoutSession,
  tenantSettingsOrOptions?: TenantLinkSettings | CheckoutResponseOptions,
): Record<string, unknown> {
  const isOptionsObject =
    tenantSettingsOrOptions !== undefined &&
    tenantSettingsOrOptions !== null &&
    ('paymentHandlers' in tenantSettingsOrOptions || 'tenantSettings' in tenantSettingsOrOptions);
  const options: CheckoutResponseOptions = isOptionsObject
    ? tenantSettingsOrOptions
    : { tenantSettings: tenantSettingsOrOptions as TenantLinkSettings | undefined };
  const raw = buildRawResponse(session, options);

  const result = ExtendedCheckoutResponseSchema.safeParse(raw);
  if (!result.success) {
    // NOTE: Graceful degradation — return unvalidated response but log the mismatch
    // so we can tighten the internal model over time.
    if (process.env['NODE_ENV'] !== 'test') {
      console.warn(
        '[checkout-response] SDK response validation drift:',
        result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }
  }

  return raw;
}
