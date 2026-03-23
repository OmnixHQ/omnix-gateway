import type {
  Cart,
  CheckoutContext,
  LineItem,
  Order,
  PaymentToken,
  PlatformAdapter,
  Product,
  SearchQuery,
  Total,
  UCPProfile,
} from '@ucp-gateway/core';
import { AdapterError, notFound } from '@ucp-gateway/core';
import type {
  ShopwareCartResponse,
  ShopwareConfig,
  ShopwareContextResponse,
  ShopwareCountryListResponse,
  ShopwareOrderResponse,
  ShopwareProduct,
  ShopwareProductListResponse,
} from './shopware-types.js';
import {
  mapShopwareCart,
  mapShopwareCartToTotals,
  mapShopwareOrder,
  mapShopwareProduct,
  unwrapShopwareProduct,
} from './shopware-mappers.js';

export type { ShopwareConfig } from './shopware-types.js';

const DEFAULT_LIMIT = 20;
const PRODUCT_INCLUDES = [
  'id',
  'name',
  'description',
  'productNumber',
  'price',
  'calculatedPrice',
  'stock',
  'available',
  'cover',
  'translated',
] as const;

export class ShopwareAdapter implements PlatformAdapter {
  readonly name = 'shopware';

  private readonly storeUrl: string;
  private readonly accessKey: string;
  private contextToken: string | undefined;
  private cachedCurrency = 'EUR';

  constructor(config: ShopwareConfig) {
    this.storeUrl = config.storeUrl.replace(/\/+$/, '');
    this.accessKey = config.accessKey;
  }

  async getProfile(): Promise<UCPProfile> {
    const ctx = await this.request<ShopwareContextResponse>('GET', '/store-api/context');
    this.cachedCurrency = ctx.currency?.isoCode ?? 'EUR';

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
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, 100);
    const page = query.page ?? 1;

    const response = await this.request<ShopwareProductListResponse>('POST', '/store-api/product', {
      limit,
      page,
      filter: [{ type: 'contains', field: 'name', value: query.q }],
      includes: { product: [...PRODUCT_INCLUDES] },
    });

    const elements = response.elements ?? [];
    return elements.map((raw) => mapShopwareProduct(raw, this.cachedCurrency));
  }

  async getProduct(id: string): Promise<Product> {
    try {
      const response = await this.request<ShopwareProduct>('POST', `/store-api/product/${id}`);
      const product = unwrapShopwareProduct(response);
      return mapShopwareProduct(product, this.cachedCurrency);
    } catch (error: unknown) {
      if (error instanceof AdapterError && error.code === 'PRODUCT_NOT_FOUND') {
        throw notFound('PRODUCT_NOT_FOUND', id);
      }
      throw error;
    }
  }

  async createCart(): Promise<Cart> {
    const response = await this.request<ShopwareCartResponse>('GET', '/store-api/checkout/cart');
    return mapShopwareCart(response, this.cachedCurrency);
  }

  async addToCart(cartId: string, items: readonly LineItem[]): Promise<Cart> {
    const response = await this.requestWithToken<ShopwareCartResponse>(
      cartId,
      'POST',
      '/store-api/checkout/cart/line-item',
      { items: items.map(buildAddToCartPayload) },
    );
    return mapShopwareCart(response, this.cachedCurrency);
  }

  async calculateTotals(cartId: string, ctx: CheckoutContext): Promise<readonly Total[]> {
    const countryId = await this.resolveCountryId(
      cartId,
      ctx.shipping_address.address_country ?? '',
    );
    await this.requestWithToken(cartId, 'PATCH', '/store-api/context', {
      shippingAddress: buildShippingAddressPayload(ctx, countryId),
    });
    const cart = await this.requestWithToken<ShopwareCartResponse>(
      cartId,
      'GET',
      '/store-api/checkout/cart',
    );
    return mapShopwareCartToTotals(cart, this.cachedCurrency);
  }

  async placeOrder(cartId: string, _payment: PaymentToken): Promise<Order> {
    const response = await this.requestWithToken<ShopwareOrderResponse>(
      cartId,
      'POST',
      '/store-api/checkout/order',
    );
    return mapShopwareOrder(response, this.cachedCurrency);
  }

  async getOrder(_id: string): Promise<Order> {
    throw new AdapterError(
      'PLATFORM_ERROR',
      'Shopware Store API does not support retrieving orders by ID',
      501,
    );
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'sw-access-key': this.accessKey,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.contextToken !== undefined) {
      headers['sw-context-token'] = this.contextToken;
    }
    return headers;
  }

  private storeContextToken(response: Response): void {
    const token = response.headers.get('sw-context-token');
    if (token) {
      this.contextToken = token;
    }
  }

  private async resolveCountryId(contextToken: string, countryIso2: string): Promise<string> {
    const response = await this.requestWithToken<ShopwareCountryListResponse>(
      contextToken,
      'POST',
      '/store-api/country',
      {
        filter: [{ type: 'equals', field: 'iso', value: countryIso2 }],
        limit: 1,
      },
    );
    const country = response.elements[0];
    if (country === undefined) {
      throw new AdapterError(
        'PLATFORM_ERROR',
        `Country not found for ISO code: ${countryIso2}`,
        400,
      );
    }
    return country.id;
  }

  private async requestWithToken<T>(
    contextToken: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const savedToken = this.contextToken;
    this.contextToken = contextToken;
    try {
      return await this.request<T>(method, path, body);
    } finally {
      this.contextToken = savedToken;
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.storeUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: this.buildHeaders(),
    };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    this.storeContextToken(response);

    if (!response.ok) {
      if (response.status === 404) {
        throw notFound('PRODUCT_NOT_FOUND', path);
      }
      const text = await response.text();
      throw new AdapterError(
        'PLATFORM_ERROR',
        `Shopware API error ${String(response.status)}: ${text}`,
        response.status,
      );
    }

    return (await response.json()) as T;
  }
}

function buildAddToCartPayload(item: LineItem): {
  readonly type: string;
  readonly referencedId: string;
  readonly quantity: number;
} {
  return {
    type: 'product',
    referencedId: item.product_id,
    quantity: item.quantity,
  };
}

function buildShippingAddressPayload(
  ctx: CheckoutContext,
  countryId: string,
): {
  readonly firstName: string;
  readonly lastName: string;
  readonly street: string;
  readonly city: string;
  readonly zipcode: string;
  readonly countryId: string;
} {
  return {
    firstName: ctx.shipping_address.first_name ?? '',
    lastName: ctx.shipping_address.last_name ?? '',
    street: ctx.shipping_address.street_address ?? '',
    city: ctx.shipping_address.address_locality ?? '',
    zipcode: ctx.shipping_address.postal_code ?? '',
    countryId,
  };
}
