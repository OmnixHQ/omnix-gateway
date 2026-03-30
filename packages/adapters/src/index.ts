/**
 * @ucp-gateway/adapters
 *
 * Free adapter implementations shipped with the public UCP Gateway.
 * Pro adapters (Magento, Shopware, Shopify) are available as separate
 * licensed packages from @omnixhq — see getomnix.dev
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
