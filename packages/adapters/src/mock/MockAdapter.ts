import type {
  PlatformAdapter,
  UCPProfile,
  SearchQuery,
  Product,
  Cart,
  LineItem,
  CheckoutContext,
  Total,
  PaymentHandler,
  PaymentToken,
  PlatformOrder,
  PlatformOrderDetails,
  OrderUpdateInput,
  Fulfillment,
  FulfillmentDestination,
  IdentityLinkingConfig,
  EmbeddedCheckoutConfig,
  OrderFulfillmentEvent,
  OrderFulfillmentExpectation,
  OrderAdjustment,
} from '@ucp-gateway/core';
import { AdapterError, notFound, outOfStock } from '@ucp-gateway/core';
import {
  MOCK_PRODUCTS,
  MOCK_PROFILE,
  MOCK_DISCOUNTS,
  FREE_SHIPPING_THRESHOLD_CENTS,
  FREE_SHIPPING_ITEM_IDS,
} from './mock-data.js';

const MAX_STOCK_QUANTITY = 10;
const TAX_RATE = 0.1;

const STANDARD_US_CENTS = 500;
const EXPRESS_US_CENTS = 1500;
const STANDARD_INTL_CENTS = 1000;
const EXPRESS_INTL_CENTS = 3000;

const MOCK_PAYMENT_HANDLERS: readonly PaymentHandler[] = [
  { id: 'mock_card', name: 'Mock Card', type: 'card' },
  { id: 'mock_wallet', name: 'Mock Wallet', type: 'wallet' },
  { id: 'mock_redirect', name: 'Mock Redirect', type: 'redirect' },
  { id: 'mock_offline', name: 'Mock Offline', type: 'offline' },
];

interface CartState {
  readonly id: string;
  readonly items: readonly LineItem[];
  readonly currency: string;
}

interface ShippingSelection {
  readonly methodId: string;
  readonly isInternational: boolean;
}

interface OrderState {
  readonly id: string;
  readonly status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'canceled';
  readonly total_cents: number;
  readonly currency: string;
  readonly created_at_iso: string;
  readonly cart_items: readonly LineItem[];
  readonly fulfillment_events: readonly OrderFulfillmentEvent[];
  readonly fulfillment_expectations: readonly OrderFulfillmentExpectation[];
  readonly adjustments: readonly OrderAdjustment[];
}

export class MockAdapter implements PlatformAdapter {
  readonly name = 'mock';

  private readonly carts = new Map<string, CartState>();
  private readonly orders = new Map<string, OrderState>();
  private readonly selectedMethods = new Map<string, ShippingSelection>();
  private nextCartId = 1;
  private nextOrderId = 1;
  private nextEventId = 1;
  private nextAdjustmentId = 1;

  async getProfile(): Promise<UCPProfile> {
    return MOCK_PROFILE;
  }

  async getSupportedPaymentMethods(): Promise<readonly PaymentHandler[]> {
    return MOCK_PAYMENT_HANDLERS;
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
      const matchesCategory = !query.category || p.categories.includes(query.category);
      return matchesText && matchesStock && matchesMinPrice && matchesMaxPrice && matchesCategory;
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

  async getCart(id: string): Promise<Cart> {
    const cart = this.carts.get(id);
    if (!cart) {
      throw notFound('CART_NOT_FOUND', id);
    }
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

  async removeFromCart(cartId: string, lineItemIndex: number): Promise<Cart> {
    const cart = this.carts.get(cartId);
    if (!cart) {
      throw notFound('CART_NOT_FOUND', cartId);
    }
    const updatedItems = cart.items.filter((_, i) => i !== lineItemIndex);
    const updatedCart: CartState = { ...cart, items: updatedItems };
    this.carts.set(cartId, updatedCart);
    return updatedCart;
  }

  async calculateTotals(cartId: string, ctx: CheckoutContext): Promise<readonly Total[]> {
    const cart = this.carts.get(cartId);
    if (!cart) {
      throw notFound('CART_NOT_FOUND', cartId);
    }

    const subtotalCents = cart.items.reduce(
      (sum, item) => sum + item.unit_price_cents * item.quantity,
      0,
    );

    const isInternational =
      !!ctx.shipping_address?.address_country && ctx.shipping_address.address_country !== 'US';
    const shippingCents = this.computeShippingCost(
      cartId,
      subtotalCents,
      cart.items,
      isInternational,
    );
    const taxCents = Math.round(subtotalCents * TAX_RATE);
    const totalCents = subtotalCents + shippingCents + taxCents;

    return [
      { type: 'subtotal', amount: subtotalCents },
      { type: 'fulfillment', amount: shippingCents, display_text: 'Shipping' },
      { type: 'tax', amount: taxCents },
      { type: 'total', amount: totalCents },
    ];
  }

  async placeOrder(
    cartId: string,
    payment: PaymentToken,
    _context?: import('@ucp-gateway/core').PlaceOrderContext,
  ): Promise<PlatformOrder> {
    if (!payment.token) {
      throw new Error('Payment token is required');
    }

    if (payment.token === 'fail_token') {
      throw new AdapterError('INVALID_PAYMENT', 'Payment processing failed', 402);
    }

    const cart = this.carts.get(cartId);
    const cartItems = cart?.items ?? [];
    const subtotalCents = cartItems.reduce(
      (sum, item) => sum + item.unit_price_cents * item.quantity,
      0,
    );
    const selection = this.selectedMethods.get(cartId);
    const shippingCents = this.computeShippingCost(
      cartId,
      subtotalCents,
      cartItems,
      selection?.isInternational ?? false,
    );
    const totalCents = subtotalCents + shippingCents + Math.round(subtotalCents * TAX_RATE);

    const lineItemIds = cartItems.map((_, i) => `li-${i}`);
    const methodType = selection?.methodId === 'mock-store-pickup' ? 'pickup' : 'shipping';
    const expectations: readonly OrderFulfillmentExpectation[] = [
      {
        id: `exp-${cartId}`,
        line_items: lineItemIds.map((liId, i) => ({
          id: liId,
          quantity: cartItems[i]?.quantity ?? 1,
        })),
        method_type: methodType as 'shipping' | 'pickup' | 'digital',
        destination:
          _context?.shipping_address ?? ({} as import('@ucp-gateway/core').PostalAddress),
      },
    ];

    const id = `mock-order-${String(this.nextOrderId++).padStart(4, '0')}`;
    const order: OrderState = {
      id,
      status: 'processing',
      total_cents: totalCents,
      currency: cart?.currency ?? 'USD',
      created_at_iso: new Date().toISOString(),
      cart_items: cartItems,
      fulfillment_events: [],
      fulfillment_expectations: expectations,
      adjustments: [],
    };
    this.orders.set(id, order);

    return order;
  }

  async getOrder(id: string): Promise<PlatformOrder> {
    const order = this.orders.get(id);
    if (!order) {
      throw notFound('ORDER_NOT_FOUND', id);
    }
    return order;
  }

  async getOrderWithDetails(id: string): Promise<PlatformOrderDetails> {
    const order = this.orders.get(id);
    if (!order) {
      throw notFound('ORDER_NOT_FOUND', id);
    }

    const fulfilledCounts = new Map<string, number>();
    for (const event of order.fulfillment_events) {
      for (const li of event.line_items) {
        fulfilledCounts.set(li.id, (fulfilledCounts.get(li.id) ?? 0) + li.quantity);
      }
    }

    const lineItemsWithFulfillment = order.cart_items.map((li, i) => ({
      ...li,
      _fulfilled: fulfilledCounts.get(`li-${i}`) ?? 0,
    }));

    return {
      ...order,
      line_items: lineItemsWithFulfillment,
      fulfillment_events: [...order.fulfillment_events],
      fulfillment_expectations: [...order.fulfillment_expectations],
      adjustments: [...order.adjustments],
    };
  }

  async updateOrder(id: string, update: OrderUpdateInput): Promise<PlatformOrder> {
    const order = this.orders.get(id);
    if (!order) {
      throw notFound('ORDER_NOT_FOUND', id);
    }

    let updatedOrder = { ...order };

    if (update.fulfillment_event) {
      const eventId = `evt-${String(this.nextEventId++).padStart(4, '0')}`;
      const newEvent: OrderFulfillmentEvent = {
        id: eventId,
        occurred_at: new Date().toISOString(),
        type: update.fulfillment_event.type,
        line_items: [...update.fulfillment_event.line_items],
        tracking_number: update.fulfillment_event.tracking_number,
        tracking_url: update.fulfillment_event.tracking_url,
        carrier: update.fulfillment_event.carrier,
        description: update.fulfillment_event.description,
      };
      updatedOrder = {
        ...updatedOrder,
        fulfillment_events: [...updatedOrder.fulfillment_events, newEvent],
      };
    }

    if (update.adjustment) {
      const adjId = `adj-${String(this.nextAdjustmentId++).padStart(4, '0')}`;
      const newAdj: OrderAdjustment = {
        id: adjId,
        type: update.adjustment.type,
        occurred_at: new Date().toISOString(),
        status: update.adjustment.status,
        line_items: update.adjustment.line_items ? [...update.adjustment.line_items] : undefined,
        amount: update.adjustment.amount,
        description: update.adjustment.description,
      };
      updatedOrder = {
        ...updatedOrder,
        adjustments: [...updatedOrder.adjustments, newAdj],
      };
    }

    this.orders.set(id, updatedOrder);
    return updatedOrder;
  }

  private validateProductExists(productId: string): void {
    const product = MOCK_PRODUCTS.find((p) => p.id === productId);
    if (!product) {
      throw notFound('PRODUCT_NOT_FOUND', productId);
    }
  }

  async applyCoupon(
    _cartId: string,
    code: string,
  ): Promise<{ amount: number; type: string; description: string }> {
    const discountDef = MOCK_DISCOUNTS.find((d) => d.code === code);
    if (!discountDef) {
      throw new AdapterError('COUPON_NOT_FOUND', `Unknown coupon code: ${code}`, 404);
    }
    return {
      amount: discountDef.value,
      type: discountDef.type,
      description: discountDef.description,
    };
  }

  async getFulfillmentOptions(
    cartId: string,
    destination: FulfillmentDestination,
  ): Promise<Fulfillment> {
    const isUS = !destination.address_country || destination.address_country === 'US';
    const cart = this.carts.get(cartId);
    const cartItems = cart?.items ?? [];
    const subtotal = cartItems.reduce(
      (sum, item) => sum + item.unit_price_cents * item.quantity,
      0,
    );
    const hasFreeItem = cartItems.some((item) => FREE_SHIPPING_ITEM_IDS.includes(item.product_id));
    const freeShipping = subtotal >= FREE_SHIPPING_THRESHOLD_CENTS || hasFreeItem;

    const standardCost = freeShipping ? 0 : isUS ? STANDARD_US_CENTS : STANDARD_INTL_CENTS;
    const expressCost = freeShipping ? 0 : isUS ? EXPRESS_US_CENTS : EXPRESS_INTL_CENTS;
    const lineItemIds = cartItems.map((_, i) => `li-${i}`);

    return {
      methods: [
        {
          id: 'mock-shipping',
          type: 'shipping',
          line_item_ids: lineItemIds,
          groups: [
            {
              id: 'mock-shipping-group',
              line_item_ids: lineItemIds,
              options: [
                {
                  id: 'mock-standard',
                  title: isUS ? 'Standard Shipping' : 'Standard International',
                  totals: [{ type: 'fulfillment', amount: standardCost }],
                },
                {
                  id: 'mock-express',
                  title: isUS ? 'Express Shipping' : 'Express International',
                  totals: [{ type: 'fulfillment', amount: expressCost }],
                },
              ],
            },
          ],
        },
        {
          id: 'mock-pickup',
          type: 'pickup',
          line_item_ids: lineItemIds,
          groups: [
            {
              id: 'mock-pickup-group',
              line_item_ids: lineItemIds,
              options: [
                {
                  id: 'mock-store-pickup',
                  title: 'In-Store Pickup',
                  description: 'Pick up at our downtown location',
                  totals: [{ type: 'fulfillment', amount: 0 }],
                },
              ],
            },
          ],
        },
      ],
    };
  }

  async setShippingMethod(
    cartId: string,
    methodId: string,
    destination?: FulfillmentDestination,
  ): Promise<void> {
    const isInternational = !!destination?.address_country && destination.address_country !== 'US';
    this.selectedMethods.set(cartId, { methodId, isInternational });
  }

  async getIdentityConfig(): Promise<IdentityLinkingConfig> {
    return {
      mechanisms: [
        {
          type: 'oauth2',
          issuer: 'https://mock.store/oauth',
          client_id: 'mock_client_id',
          scopes: ['openid', 'profile', 'email'],
        },
      ],
    };
  }

  async getEmbeddedCheckoutConfig(): Promise<EmbeddedCheckoutConfig | null> {
    return {
      url: 'https://mock.store/checkout/embed',
      type: 'iframe',
      width: 480,
      height: 640,
    };
  }

  private computeShippingCost(
    cartId: string,
    subtotal: number,
    items: readonly LineItem[],
    isInternational: boolean = false,
  ): number {
    const selection = this.selectedMethods.get(cartId);
    const hasFreeItem = items.some((item) => FREE_SHIPPING_ITEM_IDS.includes(item.product_id));
    const freeShipping = subtotal >= FREE_SHIPPING_THRESHOLD_CENTS || hasFreeItem;

    if (freeShipping) return 0;

    const methodId = selection?.methodId;
    const intl = selection?.isInternational ?? isInternational;

    if (methodId === 'mock-store-pickup') return 0;
    if (methodId === 'mock-express') return intl ? EXPRESS_INTL_CENTS : EXPRESS_US_CENTS;

    return intl ? STANDARD_INTL_CENTS : STANDARD_US_CENTS;
  }
}
