import type { Cart, FulfillmentOption, LineItem, PlatformOrder, Total } from '@ucp-gateway/core';
import type { Product } from '@ucp-gateway/core';
import type {
  ShopwareCartLineItem,
  ShopwareCartResponse,
  ShopwareOrderResponse,
  ShopwareProduct,
  ShopwareShippingMethod,
} from './shopware-types.js';
import { grossPriceToCents } from '../shared/price.js';

export function mapShopwareProduct(raw: ShopwareProduct, currency: string): Product {
  return {
    id: raw.id,
    title: extractTitle(raw),
    description: extractDescription(raw),
    price_cents: extractPrice(raw),
    currency,
    in_stock: raw.available ?? false,
    stock_quantity: raw.stock ?? 0,
    images: extractCoverImageUrl(raw.cover),
    variants: [],
  };
}

export function unwrapShopwareProduct(response: unknown): ShopwareProduct {
  const wrapped = response as { product?: ShopwareProduct | undefined };
  return wrapped.product ?? (response as ShopwareProduct);
}

function extractTitle(product: ShopwareProduct): string {
  return product.translated?.name ?? product.name ?? product.productNumber;
}

function extractDescription(product: ShopwareProduct): string | null {
  return product.translated?.description ?? product.description ?? null;
}

function extractCoverImageUrl(cover: ShopwareProduct['cover']): readonly string[] {
  const url = cover?.media?.url;
  return url ? [url] : [];
}

function extractPrice(product: ShopwareProduct): number {
  if (product.calculatedPrice) {
    return grossPriceToCents(product.calculatedPrice.unitPrice);
  }
  const firstPrice = product.price?.[0];
  return firstPrice ? grossPriceToCents(firstPrice.gross) : 0;
}

export function mapShopwareCart(response: ShopwareCartResponse, currency: string): Cart {
  return {
    id: response.token,
    items: response.lineItems.map(mapCartLineItem),
    currency,
  };
}

function mapCartLineItem(item: ShopwareCartLineItem): LineItem {
  return {
    product_id: item.referencedId,
    title: item.label,
    quantity: item.quantity,
    unit_price_cents: extractLineItemUnitPrice(item),
  };
}

function extractLineItemUnitPrice(item: ShopwareCartLineItem): number {
  return item.price ? grossPriceToCents(item.price.unitPrice) : 0;
}

export function mapShopwareCartToTotals(
  response: ShopwareCartResponse,
  _currency: string,
): readonly Total[] {
  const discountCents = sumPromotionDiscounts(response);
  const taxCents = sumCalculatedTaxes(response);
  const baseTotals: readonly Total[] = [
    { type: 'subtotal', amount: grossPriceToCents(response.price.positionPrice) },
    { type: 'fulfillment', amount: computeShippingCents(response), display_text: 'Shipping' },
  ];
  const discountTotals: readonly Total[] =
    discountCents !== 0
      ? [{ type: 'discount', amount: discountCents, display_text: 'Promotion' }]
      : [];
  return [
    ...baseTotals,
    ...discountTotals,
    { type: 'tax', amount: taxCents },
    { type: 'total', amount: grossPriceToCents(response.price.totalPrice) },
  ];
}

function sumCalculatedTaxes(response: ShopwareCartResponse): number {
  return response.price.calculatedTaxes.reduce((sum, t) => sum + grossPriceToCents(t.tax), 0);
}

function computeShippingCents(response: ShopwareCartResponse): number {
  const deliveryPrice = response.deliveries?.[0]?.shippingCosts?.totalPrice;
  if (deliveryPrice !== undefined) return grossPriceToCents(deliveryPrice);
  // NOTE: fallback for carts without delivery data — approximate from totals diff
  return Math.max(
    0,
    grossPriceToCents(response.price.totalPrice) - grossPriceToCents(response.price.positionPrice),
  );
}

export function mapShopwareOrder(response: ShopwareOrderResponse, currency: string): PlatformOrder {
  return {
    id: response.id,
    status: mapOrderStatus(response.stateMachineState?.technicalName),
    total_cents: grossPriceToCents(response.amountTotal),
    currency: response.currency?.isoCode ?? currency,
    created_at_iso: response.createdAt,
  };
}

function mapOrderStatus(technicalName: string | undefined): PlatformOrder['status'] {
  switch (technicalName) {
    case 'completed':
      return 'delivered';
    case 'in_progress':
      return 'processing';
    case 'canceled':
      return 'canceled';
    default:
      return 'pending';
  }
}

function sumPromotionDiscounts(response: ShopwareCartResponse): number {
  return response.lineItems
    .filter((item) => item.type === 'promotion')
    .reduce((sum, item) => sum + grossPriceToCents(item.price?.totalPrice ?? 0), 0);
}

export function mapShopwareShippingMethod(method: ShopwareShippingMethod): FulfillmentOption {
  const label = method.translated?.name ?? method.name ?? method.id;
  const amountCents = extractShippingMethodPrice(method);
  return {
    id: method.id,
    title: label,
    totals: [{ type: 'fulfillment', amount: amountCents }],
  };
}

function extractShippingMethodPrice(method: ShopwareShippingMethod): number {
  const prices = method.prices ?? [];
  if (prices.length === 0) return 0;
  const bestPrice = prices.reduce((best, current) =>
    (current.quantityStart ?? 0) > (best.quantityStart ?? 0) ? current : best,
  );
  const currencyGross = bestPrice.currencyPrice?.[0];
  if (currencyGross) return grossPriceToCents(currencyGross.gross);
  return 0;
}
