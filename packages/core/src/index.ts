/**
 * @ucp-middleware/core
 *
 * UCP Engine — types, routing, normalisation, and adapter interfaces.
 */

// Adapter contract
export type { PlatformAdapter } from './types/adapter.js';

// Commerce domain types
export type {
  UCPProfile,
  Capability,
  ProfileLink,
  JsonWebKey,
  Product,
  ProductVariant,
  SearchQuery,
  Cart,
  LineItem,
  CheckoutContext,
  Totals,
  Address,
  PaymentToken,
  Order,
} from './types/commerce.js';

// Errors
export { AdapterError, notFound, outOfStock } from './types/errors.js';
export type { AdapterErrorCode } from './types/errors.js';

// Registry
export { AdapterRegistry } from './adapter-registry.js';

// ─── Infrastructure ─────────────────────────────────────────────────────────

export { tenants, identityLinks } from './infra/schema.js';
export { createDb, buildDbConfig } from './infra/db.js';
export type { Database, DbConfig } from './infra/db.js';
export { TenantRepository } from './infra/TenantRepository.js';
export type {
  Tenant,
  CreateTenantInput,
  UpdateTenantInput,
} from './infra/TenantRepository.js';

// ─── Session ────────────────────────────────────────────────────────────────

export { SessionStore } from './session/SessionStore.js';
export type {
  CheckoutSession,
  SessionStatus,
  UpdateSessionData,
} from './session/SessionStore.js';
