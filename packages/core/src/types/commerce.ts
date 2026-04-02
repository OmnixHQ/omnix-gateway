/**
 * Normalised commerce domain types shared across all adapters.
 * All monetary values are integers in the smallest currency unit (cents).
 * All types are immutable.
 *
 * Types that match UCP spec are re-exported from @omnixhq/ucp-js-sdk.
 * Gateway-internal types (Product, Cart, LineItem, etc.) stay local.
 */

import type { z } from 'zod';
import type {
  PostalAddressSchema,
  BuyerSchema,
  TotalSchema,
  LinkSchema,
  MessageError as SdkMessageError,
  MessageWarning as SdkMessageWarning,
  MessageInfo as SdkMessageInfo,
  ServiceResponse,
  CapabilityResponse,
  ProductSchema,
  VariantSchema,
  CartSchema,
  CartCreateRequestSchema,
  CartUpdateRequestSchema,
  SearchFiltersSchema,
  UcpResponseCatalogSchema,
  UcpResponseCartSchema,
} from '@omnixhq/ucp-js-sdk';

/* ---------------------------------------------------------------------------
 * SDK-derived types — single source of truth from @omnixhq/ucp-js-sdk
 * ------------------------------------------------------------------------- */

export type PostalAddress = z.infer<typeof PostalAddressSchema>;

export type Buyer = z.infer<typeof BuyerSchema>;

export type Total = z.infer<typeof TotalSchema>;

export type TotalType = Total['type'];

export type CheckoutLink = z.infer<typeof LinkSchema>;

export type UCPMessage = SdkMessageError | SdkMessageWarning | SdkMessageInfo;

/* ---------------------------------------------------------------------------
 * Discovery profile — aligned with UCP spec using SDK response types
 *
 * Uses ServiceResponse and CapabilityResponse from the SDK which include
 * transport/endpoint and extends fields respectively. The hand-authored
 * UcpDiscoveryProfileSchema in the SDK uses the base UcpEntity which is
 * too strict, so we define our own profile type using the correct subtypes.
 * ------------------------------------------------------------------------- */

export interface UCPProfile {
  readonly ucp: {
    readonly version: string;
    readonly services?: Readonly<Record<string, readonly ServiceResponse[]>>;
    readonly capabilities?: Readonly<Record<string, readonly CapabilityResponse[]>>;
    readonly payment_handlers?: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  };
  readonly signing_keys: readonly JsonWebKey[];
}

export interface JsonWebKey {
  readonly kty: string;
  readonly kid: string;
  readonly [key: string]: unknown;
}

/**
 * Simplified payment handler returned by adapters.
 * Enriched to full UCP PaymentHandler in the response builder.
 */
export interface PaymentHandler {
  readonly id: string;
  readonly name: string;
  readonly type: 'offline' | 'redirect' | 'card' | 'wallet' | 'other';
}

/* ---------------------------------------------------------------------------
 * SDK-derived catalog/cart types — from draft v1.1.0-draft.3
 * ------------------------------------------------------------------------- */

export type SdkProduct = z.infer<typeof ProductSchema>;

export type SdkVariant = z.infer<typeof VariantSchema>;

export type SdkCart = z.infer<typeof CartSchema>;

export type SdkCartCreateRequest = z.infer<typeof CartCreateRequestSchema>;

export type SdkCartUpdateRequest = z.infer<typeof CartUpdateRequestSchema>;

export type SdkSearchFilters = z.infer<typeof SearchFiltersSchema>;

export type SdkCatalogResponse = z.infer<typeof UcpResponseCatalogSchema>;

export type SdkCartResponse = z.infer<typeof UcpResponseCartSchema>;

/* ---------------------------------------------------------------------------
 * Gateway-internal types — adapter contract (flat, simple)
 * ------------------------------------------------------------------------- */

export interface ProductRating {
  readonly value: number;
  readonly scale_max: number;
  readonly count: number;
}

export interface Product {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly price_cents: number;
  readonly currency: string;
  readonly in_stock: boolean;
  readonly stock_quantity: number;
  readonly images: readonly string[];
  readonly variants: readonly ProductVariant[];
  readonly categories: readonly string[];
  readonly rating?: ProductRating | undefined;
}

export interface ProductVariant {
  readonly id: string;
  readonly title: string;
  readonly price_cents: number;
  readonly in_stock: boolean;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface SearchQuery {
  readonly q: string;
  readonly category?: string | undefined;
  readonly min_price_cents?: number | undefined;
  readonly max_price_cents?: number | undefined;
  readonly in_stock?: boolean | undefined;
  readonly limit?: number | undefined;
  readonly page?: number | undefined;
}

export interface Cart {
  readonly id: string;
  readonly items: readonly LineItem[];
  readonly currency: string;
}

export interface LineItem {
  readonly product_id: string;
  readonly variant_id?: string;
  readonly title: string;
  readonly quantity: number;
  readonly unit_price_cents: number;
}

export interface CheckoutContext {
  readonly shipping_address: PostalAddress;
  readonly billing_address?: PostalAddress | undefined;
  readonly selected_shipping_method?: string | undefined;
}

export interface PlaceOrderContext {
  readonly shipping_address?: PostalAddress | undefined;
  readonly billing_address?: PostalAddress | undefined;
  readonly buyer_email?: string | undefined;
  readonly selected_shipping_method?: string | undefined;
}

export interface PaymentToken {
  readonly token: string;
  readonly provider: string;
}

export type PlatformOrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'canceled';

export interface PlatformOrder {
  readonly id: string;
  readonly status: PlatformOrderStatus;
  readonly total_cents: number;
  readonly currency: string;
  readonly created_at_iso: string;
}

/** @deprecated Use PlatformOrder instead */
export type Order = PlatformOrder;

/* ---------------------------------------------------------------------------
 * Order types — aligned with SDK OrderSchema
 * ------------------------------------------------------------------------- */

export type OrderLineItemStatus = 'processing' | 'partial' | 'fulfilled';

export interface OrderLineItemQuantity {
  readonly total: number;
  readonly fulfilled: number;
}

export interface OrderLineItem {
  readonly id: string;
  readonly item: {
    readonly id: string;
    readonly title?: string | undefined;
    readonly price?: number | undefined;
    readonly image_url?: string | undefined;
  };
  readonly quantity: OrderLineItemQuantity;
  readonly totals: readonly Total[];
  readonly status: OrderLineItemStatus;
  readonly parent_id?: string | undefined;
}

export interface OrderFulfillmentLineItemRef {
  readonly id: string;
  readonly quantity: number;
}

export interface OrderFulfillmentExpectation {
  readonly id: string;
  readonly line_items: readonly OrderFulfillmentLineItemRef[];
  readonly method_type: 'shipping' | 'pickup' | 'digital';
  readonly destination: PostalAddress;
  readonly description?: string | undefined;
  readonly fulfillable_on?: string | undefined;
}

export interface OrderFulfillmentEvent {
  readonly id: string;
  readonly occurred_at: string;
  readonly type: string;
  readonly line_items: readonly OrderFulfillmentLineItemRef[];
  readonly tracking_number?: string | undefined;
  readonly tracking_url?: string | undefined;
  readonly carrier?: string | undefined;
  readonly description?: string | undefined;
}

export interface OrderFulfillment {
  readonly expectations: readonly OrderFulfillmentExpectation[];
  readonly events: readonly OrderFulfillmentEvent[];
}

export interface OrderAdjustment {
  readonly id: string;
  readonly type: string;
  readonly occurred_at: string;
  readonly status: 'pending' | 'completed' | 'failed';
  readonly line_items?: readonly OrderFulfillmentLineItemRef[] | undefined;
  readonly amount?: number | undefined;
  readonly description?: string | undefined;
}

export interface UCPOrder {
  readonly ucp: {
    readonly version: string;
    readonly capabilities: Readonly<Record<string, readonly { readonly version: string }[]>>;
  };
  readonly id: string;
  readonly checkout_id: string;
  readonly permalink_url: string;
  readonly line_items: readonly OrderLineItem[];
  readonly totals: readonly Total[];
  readonly fulfillment: OrderFulfillment;
  readonly adjustments: readonly OrderAdjustment[];
  readonly created_at: string;
}

/** @deprecated Use UCPOrder instead */
export type OrderConfirmation = UCPOrder;

/* ---------------------------------------------------------------------------
 * Fulfillment extension types
 * Spec: https://ucp.dev/latest/specification/fulfillment/
 * ------------------------------------------------------------------------- */

export interface FulfillmentDestination {
  readonly id: string;
  readonly full_name?: string | undefined;
  readonly address_country?: string | undefined;
  readonly address?: PostalAddress | undefined;
  readonly street_address?: string | undefined;
  readonly address_locality?: string | undefined;
  readonly address_region?: string | undefined;
  readonly postal_code?: string | undefined;
}

export interface FulfillmentOptionTotal {
  readonly type: string;
  readonly amount: number;
}

export interface FulfillmentOption {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  readonly totals: readonly FulfillmentOptionTotal[];
}

export interface FulfillmentGroup {
  readonly id: string;
  readonly line_item_ids: readonly string[];
  readonly options?: readonly FulfillmentOption[] | undefined;
  readonly selected_option_id?: string | undefined;
}

export interface FulfillmentMethod {
  readonly id: string;
  readonly type: 'shipping' | 'pickup';
  readonly line_item_ids: readonly string[];
  readonly destinations?: readonly FulfillmentDestination[] | undefined;
  readonly selected_destination_id?: string | undefined;
  readonly groups: readonly FulfillmentGroup[];
}

export interface Fulfillment {
  readonly methods: readonly FulfillmentMethod[];
}

/* ---------------------------------------------------------------------------
 * Order update types — for order lifecycle (shipped/refunded/etc.)
 * ------------------------------------------------------------------------- */

export interface OrderFulfillmentEventInput {
  readonly type: string;
  readonly line_items: readonly { readonly id: string; readonly quantity: number }[];
  readonly tracking_number?: string | undefined;
  readonly tracking_url?: string | undefined;
  readonly carrier?: string | undefined;
  readonly description?: string | undefined;
}

export interface OrderAdjustmentInput {
  readonly type: string;
  readonly status: 'pending' | 'completed' | 'failed';
  readonly line_items?: readonly { readonly id: string; readonly quantity: number }[] | undefined;
  readonly amount?: number | undefined;
  readonly description?: string | undefined;
}

export interface OrderUpdateInput {
  readonly fulfillment_event?: OrderFulfillmentEventInput | undefined;
  readonly adjustment?: OrderAdjustmentInput | undefined;
}

export interface PlatformOrderDetails extends PlatformOrder {
  readonly line_items: ReadonlyArray<LineItem & { readonly _fulfilled?: number }>;
  readonly fulfillment_events: readonly OrderFulfillmentEvent[];
  readonly fulfillment_expectations: readonly OrderFulfillmentExpectation[];
  readonly adjustments: readonly OrderAdjustment[];
}

/* ---------------------------------------------------------------------------
 * Identity linking types
 * ------------------------------------------------------------------------- */

export interface IdentityLinkingMechanism {
  readonly type: 'oauth2';
  readonly issuer: string;
  readonly client_id: string;
  readonly scopes: readonly string[];
}

export interface IdentityLinkingConfig {
  readonly mechanisms: readonly IdentityLinkingMechanism[];
}

/* ---------------------------------------------------------------------------
 * Embedded checkout config
 * ------------------------------------------------------------------------- */

export interface EmbeddedCheckoutConfig {
  readonly url: string;
  readonly type?: 'iframe' | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

/* ---------------------------------------------------------------------------
 * AP2 Mandate types (autonomous agent payments)
 * ------------------------------------------------------------------------- */

export interface Ap2Mandate {
  readonly mandate: string;
  readonly agent_key?: JsonWebKey | undefined;
  readonly scope?: Readonly<Record<string, unknown>> | undefined;
}

export type MerchantAuthorization = string;

/* ---------------------------------------------------------------------------
 * Business-side profile types
 * ------------------------------------------------------------------------- */

export interface UCPBusinessProfile {
  readonly ucp: {
    readonly version: string;
    readonly services: Readonly<
      Record<string, readonly { readonly version: string; readonly transport: string }[]>
    >;
    readonly capabilities?: Readonly<Record<string, readonly { readonly version: string }[]>>;
    readonly payment_handlers: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  };
}
