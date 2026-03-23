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
  JsonWebKey,
  Product,
  ProductVariant,
  SearchQuery,
  Cart,
  LineItem,
  CheckoutContext,
  Total,
  TotalType,
  PostalAddress,
  PaymentToken,
  Order,
  Buyer,
  CheckoutLink,
  OrderConfirmation,
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

export { SessionStore } from './session/SessionStore.js';
export type {
  CheckoutSession,
  CheckoutSessionLineItem,
  SessionStatus,
  UpdateSessionData,
} from './session/SessionStore.js';
