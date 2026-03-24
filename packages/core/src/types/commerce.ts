/**
 * Normalised commerce domain types shared across all adapters.
 * All monetary values are integers in the smallest currency unit (cents).
 * All types are immutable.
 * Field names follow UCP spec at https://ucp.dev/latest/specification/
 */

export interface UCPProfile {
  readonly ucp: {
    readonly version: string;
    readonly services: Readonly<Record<string, UCPService>>;
    readonly capabilities: readonly UCPCapability[];
  };
  readonly payment?:
    | {
        readonly handlers?: readonly UCPPaymentHandler[];
      }
    | undefined;
  readonly signing_keys?: readonly JsonWebKey[] | undefined;
}

export interface UCPService {
  readonly version: string;
  readonly spec: string;
  readonly rest?: { readonly schema: string; readonly endpoint: string } | undefined;
  readonly mcp?: { readonly schema: string; readonly endpoint: string } | undefined;
  readonly a2a?: { readonly endpoint: string } | undefined;
  readonly embedded?: { readonly schema: string } | undefined;
}

export interface UCPCapability {
  readonly name: string;
  readonly version: string;
  readonly spec?: string | undefined;
  readonly schema?: string | undefined;
  readonly extends?: string | undefined;
  readonly config?: Readonly<Record<string, unknown>> | undefined;
}

export interface UCPPaymentHandler {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly spec: string;
  readonly config_schema: string;
  readonly instrument_schemas?: readonly string[] | undefined;
  readonly config?: Readonly<Record<string, unknown>> | undefined;
}

export interface PaymentHandler {
  readonly id: string;
  readonly name: string;
  readonly type: 'offline' | 'redirect' | 'card' | 'wallet' | 'other';
}

export interface JsonWebKey {
  readonly kty: string;
  readonly kid: string;
  readonly [key: string]: unknown;
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
}

export interface Total {
  readonly type: TotalType;
  readonly amount: number;
  readonly display_text?: string | undefined;
}

export type TotalType =
  | 'items_discount'
  | 'subtotal'
  | 'discount'
  | 'fulfillment'
  | 'tax'
  | 'fee'
  | 'total';

export interface PostalAddress {
  readonly first_name?: string | undefined;
  readonly last_name?: string | undefined;
  readonly street_address?: string | undefined;
  readonly extended_address?: string | undefined;
  readonly address_locality?: string | undefined;
  readonly address_region?: string | undefined;
  readonly postal_code?: string | undefined;
  readonly address_country?: string | undefined;
  readonly phone_number?: string | undefined;
}

export interface PaymentToken {
  readonly token: string;
  readonly provider: string;
}

export interface Order {
  readonly id: string;
  readonly status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'canceled';
  readonly total_cents: number;
  readonly currency: string;
  readonly created_at_iso: string;
}

export interface Buyer {
  readonly first_name?: string | undefined;
  readonly last_name?: string | undefined;
  readonly email?: string | undefined;
  readonly phone_number?: string | undefined;
}

export interface CheckoutLink {
  readonly type: string;
  readonly url: string;
  readonly title?: string | undefined;
}

export interface OrderLineItem {
  readonly id: string;
  readonly item: {
    readonly id: string;
    readonly title?: string | undefined;
    readonly price?: number | undefined;
    readonly image_url?: string | undefined;
  };
  readonly quantity: number;
  readonly totals: readonly Total[];
}

export interface OrderFulfillmentExpectation {
  readonly method_id: string;
  readonly destination_id: string;
  readonly line_item_ids: readonly string[];
  readonly estimated_arrival?: string | undefined;
}

export interface OrderFulfillmentEvent {
  readonly id: string;
  readonly occurred_at: string;
  readonly type: 'shipped' | 'delivered' | 'in_transit' | 'returned' | 'canceled';
  readonly line_item_ids?: readonly string[] | undefined;
  readonly tracking_number?: string | undefined;
  readonly tracking_url?: string | undefined;
  readonly carrier?: string | undefined;
}

export interface OrderFulfillment {
  readonly expectations: readonly OrderFulfillmentExpectation[];
  readonly events: readonly OrderFulfillmentEvent[];
}

export interface OrderAdjustment {
  readonly id: string;
  readonly type: 'refund' | 'return' | 'credit' | 'price_adjustment' | 'dispute' | 'cancellation';
  readonly occurred_at: string;
  readonly status: 'pending' | 'completed' | 'failed';
  readonly amount?: number | undefined;
  readonly description?: string | undefined;
  readonly line_item_ids?: readonly string[] | undefined;
}

export interface OrderConfirmation {
  readonly id: string;
  readonly checkout_id: string;
  readonly permalink_url: string;
  readonly line_items: readonly OrderLineItem[];
  readonly totals: readonly Total[];
  readonly fulfillment: OrderFulfillment | null;
  readonly adjustments: readonly OrderAdjustment[];
  readonly created_at: string;
}

export interface UCPMessage {
  readonly type: 'error' | 'warning' | 'info';
  readonly code: string;
  readonly content: string;
  readonly severity?: 'recoverable' | 'requires_buyer_input' | 'requires_buyer_review' | undefined;
  readonly path?: string | undefined;
  readonly content_type?: 'plain' | 'markdown' | undefined;
}

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
  readonly type: string;
  readonly line_item_ids: readonly string[];
  readonly destinations?: readonly FulfillmentDestination[] | undefined;
  readonly selected_destination_id?: string | undefined;
  readonly groups: readonly FulfillmentGroup[];
}

export interface Fulfillment {
  readonly methods: readonly FulfillmentMethod[];
}
