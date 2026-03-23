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
} from '@ucp-gateway/core';
import { AdapterError, notFound } from '@ucp-gateway/core';
import { httpGet, httpPost } from '../shared/http-client.js';
import {
  mapMagentoProduct,
  mapMagentoCartItems,
  mapMagentoTotals,
  mapMagentoOrder,
  buildMagentoShippingAddress,
} from './magento-mappers.js';
import type {
  MagentoAdapterConfig,
  MagentoStoreConfig,
  MagentoSearchResult,
  MagentoProduct,
  MagentoCartItem,
  MagentoShippingInfoResponse,
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
          'dev.ucp.shopping': [
            {
              version: '2026-01-23',
              spec: 'https://ucp.dev/latest/specification/checkout/',
              endpoint: '/checkout-sessions',
              schema: 'https://ucp.dev/2026-01-23/schemas/shopping/checkout.json',
              transport: 'rest',
            },
          ],
        },
        capabilities: {
          'dev.ucp.shopping.checkout': [{ version: '2026-01-23' }],
        },
        payment_handlers: {},
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

  async calculateTotals(cartId: string, ctx: CheckoutContext): Promise<readonly Total[]> {
    const shippingAddress = buildMagentoShippingAddress(ctx.shipping_address);
    const billingAddress = ctx.billing_address
      ? buildMagentoShippingAddress(ctx.billing_address)
      : shippingAddress;

    const response = await this.post<MagentoShippingInfoResponse>(
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

    return mapMagentoTotals(response.totals);
  }

  private async setBillingAddressWithEmail(
    cartId: string,
    address: Record<string, unknown>,
  ): Promise<void> {
    await this.post<number>(`/rest/V1/guest-carts/${encodeURIComponent(cartId)}/billing-address`, {
      address: { ...address, email: 'guest@ucp-gateway.local' },
    });
  }

  async placeOrder(cartId: string, _payment: PaymentToken): Promise<Order> {
    const orderId = await this.put<number>(
      `/rest/V1/guest-carts/${encodeURIComponent(cartId)}/order`,
      {
        paymentMethod: { method: 'checkmo' },
      },
    );

    return mapMagentoOrder(String(orderId), 0, 'USD');
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

  private async get<T>(path: string): Promise<T> {
    return httpGet<T>(this.httpConfig(), path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return httpPost<T>(this.httpConfig(), path, body);
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.config.storeUrl}${path}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new AdapterError(
        'PLATFORM_ERROR',
        `Magento API error ${response.status}: ${text}`,
        response.status,
      );
    }

    return (await response.json()) as T;
  }

  private httpConfig() {
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
