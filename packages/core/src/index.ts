/**
 * @ucp-gateway/core
 *
 * UCP Engine — types, routing, normalisation, and adapter interfaces.
 */

export type { PlatformAdapter } from './types/adapter.js';

export type {
  UCPProfile,
  UCPService,
  UCPCapability,
  UCPPaymentHandler,
  PaymentHandler,
  JsonWebKey,
  Product,
  ProductVariant,
  SearchQuery,
  Cart,
  LineItem,
  CheckoutContext,
  PlaceOrderContext,
  Total,
  TotalType,
  PostalAddress,
  PaymentToken,
  PlatformOrder,
  PlatformOrderStatus,
  Order,
  Buyer,
  CheckoutLink,
  UCPOrder,
  OrderConfirmation,
  OrderLineItem,
  OrderLineItemStatus,
  OrderLineItemQuantity,
  OrderFulfillment,
  OrderFulfillmentExpectation,
  OrderFulfillmentEvent,
  OrderFulfillmentLineItemRef,
  OrderAdjustment,
  UCPMessage,
  FulfillmentDestination,
  FulfillmentOptionTotal,
  FulfillmentOption,
  FulfillmentGroup,
  FulfillmentMethod,
  Fulfillment,
} from './types/commerce.js';

export { AdapterError, notFound, outOfStock, EscalationRequiredError } from './types/errors.js';
export type { AdapterErrorCode, EscalationDetails } from './types/errors.js';

export { AdapterRegistry } from './adapter-registry.js';

export { tenants, identityLinks } from './infra/schema.js';
export { createDb, buildDbConfig } from './infra/db.js';
export type { Database, DbConfig } from './infra/db.js';
export { TenantRepository } from './infra/TenantRepository.js';
export type { Tenant, CreateTenantInput, UpdateTenantInput } from './infra/TenantRepository.js';

export { SigningService, type SigningServiceConfig } from './signing/index.js';
export {
  generateSigningKeyPair,
  importPrivateKey,
  importPublicKeyFromJwk,
  buildKeyId,
  signDetachedJws,
  verifyDetachedJws,
  extractKidFromSignature,
  ALG,
  CRV,
  type SigningKeyPair,
} from './signing/index.js';

export { SessionStore } from './session/SessionStore.js';
export type {
  CheckoutSession,
  CheckoutSessionLineItem,
  CheckoutDiscounts,
  AppliedDiscount,
  SessionStatus,
  UpdateSessionData,
} from './session/SessionStore.js';
