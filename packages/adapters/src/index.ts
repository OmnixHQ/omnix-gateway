/**
 * @ucp-gateway/adapters
 *
 * Platform-specific adapter implementations.
 * Each adapter implements PlatformAdapter from @ucp-gateway/core.
 */

export { MockAdapter } from './mock/MockAdapter.js';
export {
  MOCK_CUSTOMERS,
  MOCK_ADDRESSES,
  MOCK_PRODUCTS,
  MOCK_DISCOUNTS,
  FREE_SHIPPING_ITEM_IDS,
  FREE_SHIPPING_THRESHOLD_CENTS,
  toFulfillmentDestination,
} from './mock/mock-data.js';
export type { MockCustomer, MockAddress, MockDiscount } from './mock/mock-data.js';
export { MagentoAdapter } from './magento/MagentoAdapter.js';
export type { MagentoAdapterConfig } from './magento/MagentoAdapter.js';
export { ShopwareAdapter } from './shopware/ShopwareAdapter.js';
export type { ShopwareConfig } from './shopware/ShopwareAdapter.js';
