import type {
  Cart,
  CheckoutContext,
  EmbeddedCheckoutConfig,
  Fulfillment,
  FulfillmentDestination,
  IdentityLinkingConfig,
  LineItem,
  OrderUpdateInput,
  PlaceOrderContext,
  PlatformOrder,
  PlatformOrderDetails,
  PaymentHandler,
  PaymentToken,
  Product,
  SearchQuery,
  Total,
  UCPProfile,
} from './commerce.js';

/**
 * The contract every platform adapter must satisfy.
 * All Core Services call only these methods.
 * Optional methods (marked with ?) are for extension capabilities.
 */
export interface PlatformAdapter {
  readonly name: string;

  getProfile(): Promise<UCPProfile>;
  searchProducts(query: SearchQuery): Promise<readonly Product[]>;
  getProduct(id: string): Promise<Product>;
  createCart(): Promise<Cart>;
  getCart(id: string): Promise<Cart>;
  addToCart(cartId: string, items: readonly LineItem[]): Promise<Cart>;
  removeFromCart?(cartId: string, lineItemIndex: number): Promise<Cart>;
  calculateTotals(cartId: string, ctx: CheckoutContext): Promise<readonly Total[]>;
  placeOrder(
    cartId: string,
    payment: PaymentToken,
    context?: PlaceOrderContext,
  ): Promise<PlatformOrder>;
  getOrder(id: string): Promise<PlatformOrder>;
  getOrderWithDetails?(id: string): Promise<PlatformOrderDetails>;
  updateOrder?(id: string, update: OrderUpdateInput): Promise<PlatformOrder>;
  getFulfillmentOptions(cartId: string, destination: FulfillmentDestination): Promise<Fulfillment>;
  setShippingMethod(
    cartId: string,
    methodId: string,
    destination?: FulfillmentDestination,
  ): Promise<void>;
  getSupportedPaymentMethods(): Promise<readonly PaymentHandler[]>;
  applyCoupon(
    cartId: string,
    code: string,
  ): Promise<{ amount: number; type: string; description: string }>;
  getIdentityConfig?(): Promise<IdentityLinkingConfig>;
  getEmbeddedCheckoutConfig?(): Promise<EmbeddedCheckoutConfig | null>;
}
