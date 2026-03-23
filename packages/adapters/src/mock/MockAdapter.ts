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
import { notFound, outOfStock } from '@ucp-gateway/core';
import { MOCK_PRODUCTS, MOCK_PROFILE } from './mock-data.js';

const MAX_STOCK_QUANTITY = 10;
const FLAT_SHIPPING_CENTS = 999;
const TAX_RATE = 0.1;

interface CartState {
  readonly id: string;
  readonly items: readonly LineItem[];
  readonly currency: string;
}

interface OrderState {
  readonly id: string;
  readonly status: 'processing';
  readonly total_cents: number;
  readonly currency: string;
  readonly created_at_iso: string;
}

/**
 * MockAdapter — fake platform adapter for local development and CI.
 * Purely in-memory, deterministic, no external HTTP calls or DB queries.
 */
export class MockAdapter implements PlatformAdapter {
  readonly name = 'mock';

  private readonly carts = new Map<string, CartState>();
  private readonly orders = new Map<string, OrderState>();
  private nextCartId = 1;
  private nextOrderId = 1;

  async getProfile(): Promise<UCPProfile> {
    return MOCK_PROFILE;
  }

  async searchProducts(query: SearchQuery): Promise<readonly Product[]> {
    const q = query.q.toLowerCase();
    const limit = Math.min(query.limit ?? 20, 100);
    const page = query.page ?? 1;

    let filtered = MOCK_PRODUCTS.filter((p) => {
      const matchesText =
        p.title.toLowerCase().includes(q) || (p.description?.toLowerCase().includes(q) ?? false);
      const matchesStock = query.in_stock === undefined || p.in_stock === query.in_stock;
      const matchesMinPrice =
        query.min_price_cents === undefined || p.price_cents >= query.min_price_cents;
      const matchesMaxPrice =
        query.max_price_cents === undefined || p.price_cents <= query.max_price_cents;
      return matchesText && matchesStock && matchesMinPrice && matchesMaxPrice;
    });

    const start = (page - 1) * limit;
    filtered = filtered.slice(start, start + limit);

    return filtered;
  }

  async getProduct(id: string): Promise<Product> {
    const product = MOCK_PRODUCTS.find((p) => p.id === id);
    if (!product) {
      throw notFound('PRODUCT_NOT_FOUND', id);
    }
    return product;
  }

  async createCart(): Promise<Cart> {
    const id = `mock-cart-${String(this.nextCartId++).padStart(4, '0')}`;
    const cart: CartState = { id, items: [], currency: 'USD' };
    this.carts.set(id, cart);
    return cart;
  }

  async addToCart(cartId: string, items: readonly LineItem[]): Promise<Cart> {
    const cart = this.carts.get(cartId);
    if (!cart) {
      throw notFound('CART_NOT_FOUND', cartId);
    }

    for (const item of items) {
      if (item.quantity > MAX_STOCK_QUANTITY) {
        throw outOfStock(item.product_id);
      }
      this.validateProductExists(item.product_id);
    }

    const updatedCart: CartState = {
      ...cart,
      items: [...cart.items, ...items],
    };
    this.carts.set(cartId, updatedCart);
    return updatedCart;
  }

  async calculateTotals(cartId: string, _ctx: CheckoutContext): Promise<readonly Total[]> {
    const cart = this.carts.get(cartId);
    if (!cart) {
      throw notFound('CART_NOT_FOUND', cartId);
    }

    const subtotalCents = cart.items.reduce(
      (sum, item) => sum + item.unit_price_cents * item.quantity,
      0,
    );
    const shippingCents = FLAT_SHIPPING_CENTS;
    const taxCents = Math.round(subtotalCents * TAX_RATE);
    const totalCents = subtotalCents + shippingCents + taxCents;

    return [
      { type: 'subtotal', amount: subtotalCents },
      { type: 'fulfillment', amount: shippingCents, display_text: 'Shipping' },
      { type: 'tax', amount: taxCents },
      { type: 'total', amount: totalCents },
    ];
  }

  async placeOrder(cartId: string, payment: PaymentToken): Promise<Order> {
    if (!payment.token) {
      throw new Error('Payment token is required');
    }

    const cart = this.carts.get(cartId);
    const subtotalCents = cart
      ? cart.items.reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0)
      : 0;
    const totalCents = subtotalCents + FLAT_SHIPPING_CENTS + Math.round(subtotalCents * TAX_RATE);

    const id = `mock-order-${String(this.nextOrderId++).padStart(4, '0')}`;
    const order: OrderState = {
      id,
      status: 'processing',
      total_cents: totalCents,
      currency: cart?.currency ?? 'USD',
      created_at_iso: new Date().toISOString(),
    };
    this.orders.set(id, order);

    return order;
  }

  private validateProductExists(productId: string): void {
    const product = MOCK_PRODUCTS.find((p) => p.id === productId);
    if (!product) {
      throw notFound('PRODUCT_NOT_FOUND', productId);
    }
  }

  async getOrder(id: string): Promise<Order> {
    const order = this.orders.get(id);
    if (!order) {
      throw notFound('ORDER_NOT_FOUND', id);
    }
    return order;
  }
}
