export interface ShopwareConfig {
  readonly storeUrl: string;
  readonly accessKey: string;
}

export interface ShopwarePrice {
  readonly gross: number;
  readonly net: number;
  readonly currencyId: string;
}

export interface ShopwareCalculatedPrice {
  readonly unitPrice: number;
  readonly totalPrice: number;
}

export interface ShopwareCover {
  readonly media?: ShopwareMedia | undefined;
}

export interface ShopwareMedia {
  readonly url?: string | undefined;
}

export interface ShopwareTranslated {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
}

export interface ShopwareProduct {
  readonly id: string;
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly productNumber: string;
  readonly price: readonly ShopwarePrice[] | null;
  readonly calculatedPrice?: ShopwareCalculatedPrice | null | undefined;
  readonly stock?: number | undefined;
  readonly available?: boolean | undefined;
  readonly cover?: ShopwareCover | null | undefined;
  readonly translated?: ShopwareTranslated | undefined;
}

export interface ShopwareProductListResponse {
  readonly elements: readonly ShopwareProduct[];
}

export interface ShopwareContextResponse {
  readonly salesChannel?: ShopwareSalesChannel | undefined;
  readonly currency?: ShopwareCurrency | undefined;
}

export interface ShopwareSalesChannel {
  readonly name?: string | undefined;
  readonly id?: string | undefined;
}

export interface ShopwareCurrency {
  readonly isoCode?: string | undefined;
}

export interface ShopwareCartPrice {
  readonly totalPrice: number;
  readonly netPrice: number;
  readonly positionPrice: number;
  readonly taxStatus: string;
  readonly calculatedTaxes: readonly ShopwareCalculatedTax[];
}

export interface ShopwareCalculatedTax {
  readonly tax: number;
  readonly taxRate: number;
  readonly price: number;
}

export interface ShopwareCartLineItem {
  readonly id: string;
  readonly referencedId: string;
  readonly label: string;
  readonly quantity: number;
  readonly type: string;
  readonly price: ShopwareCalculatedPrice | null;
}

export interface ShopwareCartResponse {
  readonly token: string;
  readonly lineItems: readonly ShopwareCartLineItem[];
  readonly price: ShopwareCartPrice;
}

export interface ShopwareOrderResponse {
  readonly id: string;
  readonly orderNumber: string;
  readonly stateMachineState?: ShopwareStateMachineState | undefined;
  readonly amountTotal: number;
  readonly currency?: ShopwareCurrency | undefined;
  readonly createdAt: string;
}

export interface ShopwareStateMachineState {
  readonly technicalName: string;
}

export interface ShopwareCountry {
  readonly id: string;
  readonly iso: string;
}

export interface ShopwareCountryListResponse {
  readonly elements: readonly ShopwareCountry[];
}

export interface ShopwareShippingMethodTranslated {
  readonly name?: string | undefined;
}

export interface ShopwareCurrencyPrice {
  readonly gross: number;
  readonly net: number;
  readonly currencyId: string;
}

export interface ShopwareShippingMethodPrice {
  readonly currencyPrice?: readonly ShopwareCurrencyPrice[] | null | undefined;
  readonly price?: number | undefined;
  readonly quantityStart?: number | undefined;
}

export interface ShopwareShippingMethod {
  readonly id: string;
  readonly name?: string | undefined;
  readonly translated?: ShopwareShippingMethodTranslated | undefined;
  readonly prices?: readonly ShopwareShippingMethodPrice[] | undefined;
  readonly position?: number | undefined;
}

export interface ShopwareShippingMethodListResponse {
  readonly elements: readonly ShopwareShippingMethod[];
}
