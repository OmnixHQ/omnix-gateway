import type { SearchQuery, SdkSearchFilters } from '../types/commerce.js';

interface SearchPagination {
  readonly limit?: number;
  readonly page?: number;
}

export function fromSdkSearchFilters(
  filters: SdkSearchFilters,
  q?: string,
  pagination?: SearchPagination,
): SearchQuery {
  const price = filters.price as { min?: number; max?: number } | undefined;
  const categories = filters.categories;

  return {
    q: q ?? '',
    category: categories?.[0],
    min_price_cents: price?.min,
    max_price_cents: price?.max,
    limit: pagination?.limit,
    page: pagination?.page,
  };
}
