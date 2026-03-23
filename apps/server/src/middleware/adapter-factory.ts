import type { PlatformAdapter } from '@ucp-gateway/core';
import { MockAdapter, MagentoAdapter, ShopwareAdapter } from '@ucp-gateway/adapters';

export function createAdapterForTenant(platform: string, adapterConfig: unknown): PlatformAdapter {
  const config = adapterConfig as Record<string, string>;

  switch (platform) {
    case 'mock':
      return new MockAdapter();

    case 'magento':
      return new MagentoAdapter({
        storeUrl: config['storeUrl'] ?? '',
        apiKey: config['apiKey'] ?? '',
      });

    case 'shopware':
      return new ShopwareAdapter({
        storeUrl: config['storeUrl'] ?? '',
        accessKey: config['accessKey'] ?? '',
      });

    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}
