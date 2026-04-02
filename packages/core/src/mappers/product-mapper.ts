import type { Product, ProductVariant, SdkProduct } from '../types/commerce.js';

function mapVariant(variant: ProductVariant, currency: string): SdkProduct['variants'][number] {
  const selectedOptions = Object.entries(variant.attributes).map(([name, label]) => ({
    name,
    label,
  }));

  return {
    id: variant.id,
    title: variant.title,
    description: { plain: variant.title },
    price: { amount: variant.price_cents, currency },
    availability: { available: variant.in_stock },
    ...(selectedOptions.length > 0 ? { selected_options: selectedOptions } : {}),
  };
}

function deriveProductOptions(
  variants: readonly ProductVariant[],
): SdkProduct['options'] | undefined {
  if (variants.length === 0) return undefined;

  const optionMap = new Map<string, Set<string>>();
  for (const v of variants) {
    for (const [name, value] of Object.entries(v.attributes)) {
      const existing = optionMap.get(name) ?? new Set<string>();
      existing.add(value);
      optionMap.set(name, existing);
    }
  }

  if (optionMap.size === 0) return undefined;

  return [...optionMap.entries()].map(([name, values]) => ({
    name,
    values: [...values].map((label) => ({ label })),
  }));
}

export function toSdkProduct(product: Product): SdkProduct {
  const currency = product.currency;

  const minPrice =
    product.variants.length > 0
      ? Math.min(product.price_cents, ...product.variants.map((v) => v.price_cents))
      : product.price_cents;

  const maxPrice =
    product.variants.length > 0
      ? Math.max(product.price_cents, ...product.variants.map((v) => v.price_cents))
      : product.price_cents;

  const media: SdkProduct['media'] = product.images.map((url) => ({
    type: 'image' as const,
    url,
  }));

  const categories =
    product.categories.length > 0
      ? product.categories.map((value) => ({ value, taxonomy: 'custom' as const }))
      : undefined;

  const options = deriveProductOptions(product.variants);

  return {
    id: product.id,
    title: product.title,
    description: { plain: product.description ?? '' },
    price_range: {
      min: { amount: minPrice, currency },
      max: { amount: maxPrice, currency },
    },
    variants:
      product.variants.length > 0
        ? product.variants.map((v) => mapVariant(v, currency))
        : [
            {
              id: product.id,
              title: product.title,
              description: { plain: product.description ?? '' },
              price: { amount: product.price_cents, currency },
              availability: {
                available: product.in_stock,
                ...(product.stock_quantity > 0 ? { quantity: product.stock_quantity } : {}),
              },
            },
          ],
    ...(media.length > 0 ? { media } : {}),
    ...(categories ? { categories } : {}),
    ...(options ? { options } : {}),
    ...(product.rating
      ? {
          rating: {
            value: product.rating.value,
            scale_min: 1,
            scale_max: product.rating.scale_max,
            count: product.rating.count,
          },
        }
      : {}),
  };
}
