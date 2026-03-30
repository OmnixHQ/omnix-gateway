import type { PlatformAdapter } from '@ucp-gateway/core';
import { MockAdapter } from '@ucp-gateway/adapters';

export async function createAdapterForTenant(
  platform: string,
  adapterConfig: unknown,
): Promise<PlatformAdapter> {
  const config = adapterConfig as Record<string, string>;

  switch (platform) {
    case 'mock':
      return new MockAdapter();

    case 'magento': {
      const mod = await import('@omnixhq/adapter-magento').catch(() => {
        throw new Error('Magento adapter not installed. License required — getomnix.dev');
      });
      return new mod.MagentoAdapter({
        storeUrl: config['storeUrl'] ?? '',
        apiKey: config['apiKey'] ?? '',
      });
    }

    case 'shopware': {
      const mod = await import('@omnixhq/adapter-shopware').catch(() => {
        throw new Error('Shopware adapter not installed. License required — getomnix.dev');
      });
      return new mod.ShopwareAdapter({
        storeUrl: config['storeUrl'] ?? '',
        accessKey: config['accessKey'] ?? '',
      });
    }

    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}
