export interface MagentoStoreConfig {
  readonly id: number;
  readonly code: string;
  readonly website_id: number;
  readonly locale: string;
  readonly base_currency_code: string;
  readonly default_display_currency_code: string;
  readonly timezone: string;
  readonly weight_unit: string;
  readonly base_url: string;
  readonly base_link_url: string;
  readonly secure_base_url: string;
  readonly secure_base_link_url: string;
}

export interface MagentoProduct {
  readonly id: number;
  readonly sku: string;
  readonly name: string;
  readonly price: number;
  readonly status: number;
  readonly visibility: number;
  readonly type_id: string;
  readonly weight: number;
  readonly extension_attributes: {
    readonly stock_item?: {
      readonly qty: number;
      readonly is_in_stock: boolean;
    };
  };
  readonly custom_attributes?: readonly {
    readonly attribute_code: string;
    readonly value: string;
  }[];
  readonly media_gallery_entries?: readonly {
    readonly id: number;
    readonly media_type: string;
    readonly label: string | null;
    readonly file: string;
    readonly types: readonly string[];
  }[];
}

export interface MagentoSearchResult {
  readonly items: readonly MagentoProduct[];
  readonly total_count: number;
}

export interface MagentoAdapterConfig {
  readonly storeUrl: string;
  readonly apiKey: string;
}

export interface MagentoCartItem {
  readonly item_id: number;
  readonly sku: string;
  readonly qty: number;
  readonly name: string;
  readonly price: number;
  readonly product_type: string;
  readonly quote_id: string;
}

export interface MagentoTotals {
  readonly subtotal: number;
  readonly grand_total: number;
  readonly shipping_amount: number;
  readonly tax_amount: number;
  readonly base_currency_code: string;
}

export interface MagentoShippingInfoResponse {
  readonly totals: MagentoTotals;
  readonly payment_methods: readonly { readonly code: string; readonly title: string }[];
}

export interface MagentoOrderResponse {
  readonly entity_id: number;
  readonly increment_id: string;
  readonly status: string;
  readonly grand_total: number;
  readonly base_currency_code: string;
  readonly created_at: string;
}

export interface MagentoShippingMethod {
  readonly carrier_code: string;
  readonly method_code: string;
  readonly carrier_title: string;
  readonly method_title: string;
  readonly amount: number;
  readonly base_amount: number;
  readonly available: boolean;
  readonly price_excl_tax: number;
  readonly price_incl_tax: number;
}

export interface MagentoTotalsResponse {
  readonly subtotal: number;
  readonly grand_total: number;
  readonly shipping_amount: number;
  readonly tax_amount: number;
  readonly discount_amount: number;
  readonly base_currency_code: string;
  readonly coupon_code?: string | null;
}
