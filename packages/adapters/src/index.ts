/**
 * @ucp-gateway/adapters
 *
 * Platform-specific adapter implementations.
 * Each adapter implements PlatformAdapter from @ucp-gateway/core.
 */

export { MockAdapter } from './mock/MockAdapter.js';
export { MagentoAdapter } from './magento/MagentoAdapter.js';
export type { MagentoAdapterConfig } from './magento/MagentoAdapter.js';
export { ShopwareAdapter } from './shopware/ShopwareAdapter.js';
export type { ShopwareConfig } from './shopware/ShopwareAdapter.js';
