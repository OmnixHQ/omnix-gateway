import type { Cart, LineItem, Order, Total } from '@ucp-gateway/core';
import type { Product } from '@ucp-gateway/core';
import type {
  ShopwareCartLineItem,
  ShopwareCartResponse,
  ShopwareOrderResponse,
  ShopwareProduct,
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
  const taxCents = sumCalculatedTaxes(response);
  return [
    { type: 'subtotal', amount: grossPriceToCents(response.price.positionPrice) },
    { type: 'fulfillment', amount: computeShippingCents(response), display_text: 'Shipping' },
    { type: 'tax', amount: taxCents },
    { type: 'total', amount: grossPriceToCents(response.price.totalPrice) },
  ];
}

function sumCalculatedTaxes(response: ShopwareCartResponse): number {
  return response.price.calculatedTaxes.reduce((sum, t) => sum + grossPriceToCents(t.tax), 0);
}

function computeShippingCents(response: ShopwareCartResponse): number {
  const totalCents = grossPriceToCents(response.price.totalPrice);
  const positionCents = grossPriceToCents(response.price.positionPrice);
  return Math.max(0, totalCents - positionCents);
}

export function mapShopwareOrder(response: ShopwareOrderResponse, currency: string): Order {
  return {
    id: response.id,
    status: mapOrderStatus(response.stateMachineState?.technicalName),
    total_cents: grossPriceToCents(response.amountTotal),
    currency: response.currency?.isoCode ?? currency,
    created_at_iso: response.createdAt,
  };
}

function mapOrderStatus(technicalName: string | undefined): Order['status'] {
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
