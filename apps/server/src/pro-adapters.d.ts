/**
 * Ambient type declarations for optional pro adapter packages.
 * These packages are dynamically imported at runtime and may not be installed.
 * Install via licensed npm token from getomnix.dev
 */

declare module '@omnixhq/adapter-magento' {
  import type { PlatformAdapter } from '@ucp-gateway/core';

  export class MagentoAdapter implements PlatformAdapter {
    readonly name: string;
    constructor(config: MagentoAdapterConfig);
    getProfile(): Promise<import('@ucp-gateway/core').UCPProfile>;
    getSupportedPaymentMethods(): Promise<readonly import('@ucp-gateway/core').PaymentHandler[]>;
    searchProducts(
      query: import('@ucp-gateway/core').SearchQuery,
    ): Promise<readonly import('@ucp-gateway/core').Product[]>;
    getProduct(id: string): Promise<import('@ucp-gateway/core').Product>;
    createCart(): Promise<import('@ucp-gateway/core').Cart>;
    addToCart(
      cartId: string,
      items: readonly import('@ucp-gateway/core').LineItem[],
    ): Promise<import('@ucp-gateway/core').Cart>;
    getFulfillmentOptions(
      cartId: string,
      destination: import('@ucp-gateway/core').FulfillmentDestination,
    ): Promise<import('@ucp-gateway/core').Fulfillment>;
    setShippingMethod(
      cartId: string,
      methodId: string,
      destination?: import('@ucp-gateway/core').FulfillmentDestination,
    ): Promise<void>;
    applyCoupon(
      cartId: string,
      code: string,
    ): Promise<{ amount: number; type: string; description: string }>;
    removeCoupon(cartId: string): Promise<boolean>;
    calculateTotals(
      cartId: string,
      ctx: import('@ucp-gateway/core').CheckoutContext,
    ): Promise<readonly import('@ucp-gateway/core').Total[]>;
    placeOrder(
      cartId: string,
      payment: import('@ucp-gateway/core').PaymentToken,
      context?: import('@ucp-gateway/core').PlaceOrderContext,
    ): Promise<import('@ucp-gateway/core').PlatformOrder>;
    getOrder(id: string): Promise<import('@ucp-gateway/core').PlatformOrder>;
  }

  export interface MagentoAdapterConfig {
    readonly storeUrl: string;
    readonly apiKey: string;
  }
}

declare module '@omnixhq/adapter-shopware' {
  import type { PlatformAdapter } from '@ucp-gateway/core';

  export class ShopwareAdapter implements PlatformAdapter {
    readonly name: string;
    constructor(config: ShopwareConfig);
    getProfile(): Promise<import('@ucp-gateway/core').UCPProfile>;
    getSupportedPaymentMethods(): Promise<readonly import('@ucp-gateway/core').PaymentHandler[]>;
    searchProducts(
      query: import('@ucp-gateway/core').SearchQuery,
    ): Promise<readonly import('@ucp-gateway/core').Product[]>;
    getProduct(id: string): Promise<import('@ucp-gateway/core').Product>;
    createCart(): Promise<import('@ucp-gateway/core').Cart>;
    addToCart(
      cartId: string,
      items: readonly import('@ucp-gateway/core').LineItem[],
    ): Promise<import('@ucp-gateway/core').Cart>;
    getFulfillmentOptions(
      cartId: string,
      destination: import('@ucp-gateway/core').FulfillmentDestination,
    ): Promise<import('@ucp-gateway/core').Fulfillment>;
    setShippingMethod(cartId: string, methodId: string, destination?: unknown): Promise<void>;
    applyCoupon(
      cartId: string,
      code: string,
    ): Promise<{ amount: number; type: string; description: string }>;
    removeCoupon(cartId: string, code: string): Promise<import('@ucp-gateway/core').Cart>;
    calculateTotals(
      cartId: string,
      ctx: import('@ucp-gateway/core').CheckoutContext,
    ): Promise<readonly import('@ucp-gateway/core').Total[]>;
    placeOrder(
      cartId: string,
      payment: import('@ucp-gateway/core').PaymentToken,
      context?: import('@ucp-gateway/core').PlaceOrderContext,
    ): Promise<import('@ucp-gateway/core').PlatformOrder>;
    getOrder(id: string): Promise<import('@ucp-gateway/core').PlatformOrder>;
  }

  export interface ShopwareConfig {
    readonly storeUrl: string;
    readonly accessKey: string;
  }
}
