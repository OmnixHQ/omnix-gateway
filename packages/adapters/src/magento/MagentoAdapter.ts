import type {
  PlatformAdapter,
  UCPProfile,
  SearchQuery,
  Product,
  Cart,
  LineItem,
  CheckoutContext,
  Total,
  PaymentToken,
  Order,
  Fulfillment,
  FulfillmentDestination,
} from '@ucp-gateway/core';
import { AdapterError, notFound } from '@ucp-gateway/core';
import type { HttpClientConfig } from '../shared/http-client.js';
import { httpGet, httpPost, httpPut, httpDelete } from '../shared/http-client.js';
import {
  mapMagentoProduct,
  mapMagentoCartItems,
  mapMagentoOrder,
  buildMagentoShippingAddress,
  mapShippingMethodsToFulfillment,
  mapMagentoTotalsWithDiscount,
  mapPaymentHandlerToMagentoMethod,
} from './magento-mappers.js';
import type {
  MagentoAdapterConfig,
  MagentoStoreConfig,
  MagentoSearchResult,
  MagentoProduct,
  MagentoCartItem,
  MagentoShippingInfoResponse,
  MagentoShippingMethod,
  MagentoTotalsResponse,
} from './magento-types.js';

export type { MagentoAdapterConfig } from './magento-types.js';

export class MagentoAdapter implements PlatformAdapter {
  readonly name = 'magento';
  private readonly config: MagentoAdapterConfig;

  constructor(config: MagentoAdapterConfig) {
    this.config = config;
  }

  async getProfile(): Promise<UCPProfile> {
    await this.get<MagentoStoreConfig[]>('/rest/V1/store/storeConfigs');

    return {
      ucp: {
        version: '2026-01-23',
        services: {
          'dev.ucp.shopping': {
            version: '2026-01-23',
            spec: 'https://ucp.dev/latest/specification/checkout/',
            rest: {
              schema: 'https://ucp.dev/2026-01-23/schemas/shopping/checkout.json',
              endpoint: this.config.storeUrl,
            },
          },
        },
        capabilities: [
          {
            name: 'dev.ucp.shopping.checkout',
            version: '2026-01-23',
            spec: 'https://ucp.dev/latest/specification/checkout/',
            schema: 'https://ucp.dev/2026-01-23/schemas/shopping/checkout.json',
          },
        ],
      },
      signing_keys: [],
    };
  }

  async searchProducts(query: SearchQuery): Promise<readonly Product[]> {
    const limit = Math.min(query.limit ?? 20, 100);
    const page = query.page ?? 1;

    const params = buildSearchCriteriaParams(query.q, limit, page);
    const result = await this.get<MagentoSearchResult>(`/rest/V1/products?${params.toString()}`);

    return result.items.map((item) => mapMagentoProduct(item, this.config.storeUrl));
  }

  async getProduct(id: string): Promise<Product> {
    try {
      const item = await this.get<MagentoProduct>(`/rest/V1/products/${encodeURIComponent(id)}`);
      return mapMagentoProduct(item, this.config.storeUrl);
    } catch (err: unknown) {
      if (err instanceof AdapterError && err.statusCode === 404) {
        throw notFound('PRODUCT_NOT_FOUND', id);
      }
      throw err;
    }
  }

  async createCart(): Promise<Cart> {
    const cartId = await this.post<string>('/rest/V1/guest-carts', {});
    return { id: cartId, items: [], currency: 'USD' };
  }

  async addToCart(cartId: string, items: readonly LineItem[]): Promise<Cart> {
    const addedItems: MagentoCartItem[] = [];

    for (const item of items) {
      const result = await this.post<MagentoCartItem>(
        `/rest/V1/guest-carts/${encodeURIComponent(cartId)}/items`,
        {
          cartItem: {
            sku: item.product_id,
            qty: item.quantity,
            quote_id: cartId,
          },
        },
      );
      addedItems.push(result);
    }

    const allItems = await this.get<MagentoCartItem[]>(
      `/rest/V1/guest-carts/${encodeURIComponent(cartId)}/items`,
    );

    return mapMagentoCartItems(cartId, allItems);
  }

  /* -----------------------------------------------------------------------
   * Fulfillment — Real Shipping Methods
   * --------------------------------------------------------------------- */

  async getFulfillmentOptions(
    cartId: string,
    destination: FulfillmentDestination,
  ): Promise<Fulfillment> {
    const address = buildEstimateAddress(destination);
    const methods = await this.post<readonly MagentoShippingMethod[]>(
      `/rest/V1/guest-carts/${encodeURIComponent(cartId)}/estimate-shipping-methods`,
      { address },
    );

    return mapShippingMethodsToFulfillment(methods);
  }

  async setShippingMethod(cartId: string, carrierCode: string, methodCode: string): Promise<void> {
    const defaultAddress = {
      firstname: 'Guest',
      lastname: 'Checkout',
      street: ['123 Main St'],
      city: 'New York',
      postcode: '10001',
      region_code: 'NY',
      country_id: 'US',
      telephone: '0000000000',
    };

    await this.post<MagentoShippingInfoResponse>(
      `/rest/V1/guest-carts/${encodeURIComponent(cartId)}/shipping-information`,
      {
        addressInformation: {
          shipping_address: defaultAddress,
          billing_address: defaultAddress,
          shipping_carrier_code: carrierCode,
          shipping_method_code: methodCode,
        },
      },
    );
  }

  /* -----------------------------------------------------------------------
   * Discount — Coupon Codes
   * --------------------------------------------------------------------- */

  async applyCoupon(cartId: string, code: string): Promise<boolean> {
    try {
      return await this.put<boolean>(
        `/rest/V1/guest-carts/${encodeURIComponent(cartId)}/coupons/${encodeURIComponent(code)}`,
        {},
      );
    } catch (err: unknown) {
      if (err instanceof AdapterError && err.statusCode === 404) {
        throw new AdapterError('PLATFORM_ERROR', `Invalid coupon code: ${code}`, 404);
      }
      throw err;
    }
  }

  async removeCoupon(cartId: string): Promise<boolean> {
    return this.delete<boolean>(`/rest/V1/guest-carts/${encodeURIComponent(cartId)}/coupons`);
  }

  /* -----------------------------------------------------------------------
   * Calculate Totals (with shipping context + discount support)
   * --------------------------------------------------------------------- */

  async calculateTotals(cartId: string, ctx: CheckoutContext): Promise<readonly Total[]> {
    const shippingAddress = buildMagentoShippingAddress(ctx.shipping_address);
    const billingAddress = ctx.billing_address
      ? buildMagentoShippingAddress(ctx.billing_address)
      : shippingAddress;

    await this.post<MagentoShippingInfoResponse>(
      `/rest/V1/guest-carts/${encodeURIComponent(cartId)}/shipping-information`,
      {
        addressInformation: {
          shipping_address: shippingAddress,
          billing_address: billingAddress,
          shipping_carrier_code: 'flatrate',
          shipping_method_code: 'flatrate',
        },
      },
    );

    await this.setBillingAddressWithEmail(cartId, billingAddress);

    const totals = await this.get<MagentoTotalsResponse>(
      `/rest/V1/guest-carts/${encodeURIComponent(cartId)}/totals`,
    );

    return mapMagentoTotalsWithDiscount(totals);
  }

  private async setBillingAddressWithEmail(
    cartId: string,
    address: Record<string, unknown>,
  ): Promise<void> {
    await this.post<number>(`/rest/V1/guest-carts/${encodeURIComponent(cartId)}/billing-address`, {
      address: { ...address, email: 'guest@ucp-gateway.local' },
    });
  }

  /* -----------------------------------------------------------------------
   * Place Order (with payment method mapping + failure handling)
   * --------------------------------------------------------------------- */

  /**
   * Place an order on Magento.
   * Magento requires: shipping address -> shipping method -> billing -> payment -> order.
   */
  async placeOrder(cartId: string, payment: PaymentToken): Promise<Order> {
    const magentoMethod = mapPaymentHandlerToMagentoMethod(payment.provider);

    const defaultAddress = {
      firstname: 'Guest',
      lastname: 'Checkout',
      street: ['N/A'],
      city: 'New York',
      region_code: 'NY',
      postcode: '10001',
      country_id: 'US',
      telephone: '0000000000',
    };

    try {
      await this.post(`/rest/V1/guest-carts/${encodeURIComponent(cartId)}/shipping-information`, {
        addressInformation: {
          shipping_address: { ...defaultAddress, email: 'guest@ucp-gateway.local' },
          billing_address: { ...defaultAddress, email: 'guest@ucp-gateway.local' },
          shipping_carrier_code: 'flatrate',
          shipping_method_code: 'flatrate',
        },
      });
    } catch {
      // NOTE: Shipping info may already be set from calculateTotals — continue
    }

    await this.setPaymentMethod(cartId, magentoMethod);

    const orderId = await this.put<number>(
      `/rest/V1/guest-carts/${encodeURIComponent(cartId)}/order`,
      {
        paymentMethod: { method: magentoMethod },
      },
    );

    return mapMagentoOrder(String(orderId), 0, 'USD');
  }

  private async setPaymentMethod(cartId: string, method: string): Promise<void> {
    try {
      await this.put<string>(
        `/rest/V1/guest-carts/${encodeURIComponent(cartId)}/selected-payment-method`,
        { method: { method } },
      );
    } catch (err: unknown) {
      if (err instanceof AdapterError && err.statusCode === 400) {
        throw new AdapterError('INVALID_PAYMENT', `Unsupported payment method: ${method}`, 402);
      }
      throw err;
    }
  }

  async getOrder(id: string): Promise<Order> {
    try {
      const order = await this.get<{
        entity_id: number;
        status: string;
        grand_total: number;
        base_currency_code: string;
        created_at: string;
      }>(`/rest/V1/orders/${encodeURIComponent(id)}`);
      return {
        id: String(order.entity_id),
        status: mapMagentoOrderStatus(order.status),
        total_cents: Math.round(order.grand_total * 100),
        currency: order.base_currency_code,
        created_at_iso: order.created_at,
      };
    } catch (err: unknown) {
      if (err instanceof AdapterError && err.statusCode === 404) {
        throw notFound('ORDER_NOT_FOUND', id);
      }
      throw err;
    }
  }

  /* -----------------------------------------------------------------------
   * HTTP helpers
   * --------------------------------------------------------------------- */

  private async get<T>(path: string): Promise<T> {
    return httpGet<T>(this.httpConfig(), path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return httpPost<T>(this.httpConfig(), path, body);
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    return httpPut<T>(this.httpConfig(), path, body);
  }

  private async delete<T>(path: string): Promise<T> {
    return httpDelete<T>(this.httpConfig(), path);
  }

  private httpConfig(): HttpClientConfig {
    return {
      baseUrl: this.config.storeUrl,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        Accept: 'application/json',
      },
    };
  }
}

function buildSearchCriteriaParams(query: string, limit: number, page: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set('searchCriteria[filterGroups][0][filters][0][field]', 'name');
  params.set('searchCriteria[filterGroups][0][filters][0][value]', `%${query}%`);
  params.set('searchCriteria[filterGroups][0][filters][0][conditionType]', 'like');
  params.set('searchCriteria[pageSize]', String(limit));
  params.set('searchCriteria[currentPage]', String(page));
  return params;
}

function buildEstimateAddress(destination: FulfillmentDestination): Record<string, unknown> {
  const addr = destination.address;
  return {
    country_id: destination.address_country ?? addr?.address_country ?? 'US',
    postcode: destination.postal_code ?? addr?.postal_code ?? '10001',
    region_code: destination.address_region ?? addr?.address_region ?? '',
    city: destination.address_locality ?? addr?.address_locality ?? '',
    street: addr?.street_address ? [addr.street_address] : [],
  };
}

function mapMagentoOrderStatus(magentoStatus: string): Order['status'] {
  const statusMap: Record<string, Order['status']> = {
    pending: 'pending',
    processing: 'processing',
    complete: 'delivered',
    closed: 'canceled',
    canceled: 'canceled',
    holded: 'pending',
  };
  return statusMap[magentoStatus] ?? 'processing';
}
