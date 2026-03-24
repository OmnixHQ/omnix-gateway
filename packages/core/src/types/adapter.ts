import type {
  Cart,
  CheckoutContext,
  Fulfillment,
  FulfillmentDestination,
  LineItem,
  Order,
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
 */
export interface PlatformAdapter {
  readonly name: string;

  getProfile(): Promise<UCPProfile>;
  searchProducts(query: SearchQuery): Promise<readonly Product[]>;
  getProduct(id: string): Promise<Product>;
  createCart(): Promise<Cart>;
  addToCart(cartId: string, items: readonly LineItem[]): Promise<Cart>;
  calculateTotals(cartId: string, ctx: CheckoutContext): Promise<readonly Total[]>;
  placeOrder(cartId: string, payment: PaymentToken): Promise<Order>;
  getOrder(id: string): Promise<Order>;
  getFulfillmentOptions?(cartId: string, destination: FulfillmentDestination): Promise<Fulfillment>;
  setShippingMethod?(cartId: string, methodId: string): Promise<void>;
  getSupportedPaymentMethods?(): Promise<readonly PaymentHandler[]>;
}
