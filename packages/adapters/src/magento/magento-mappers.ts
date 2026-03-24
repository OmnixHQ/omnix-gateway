import type {
  Product,
  Cart,
  LineItem,
  Total,
  Order,
  PostalAddress,
  Fulfillment,
  FulfillmentOption,
} from '@ucp-gateway/core';
import type {
  MagentoProduct,
  MagentoCartItem,
  MagentoTotals,
  MagentoShippingMethod,
  MagentoTotalsResponse,
} from './magento-types.js';
import { dollarsToCents } from '../shared/price.js';

export function mapMagentoProduct(item: MagentoProduct, storeUrl: string): Product {
  const description =
    getCustomAttribute(item, 'description') ?? getCustomAttribute(item, 'short_description');
  const stockItem = item.extension_attributes?.stock_item;
  const images = extractProductImages(item, storeUrl);

  return {
    id: item.sku,
    title: item.name,
    description: description ?? null,
    price_cents: dollarsToCents(item.price),
    currency: 'USD',
    in_stock: stockItem?.is_in_stock ?? true,
    stock_quantity: stockItem?.qty ?? 0,
    images,
    variants: [],
  };
}

function getCustomAttribute(item: MagentoProduct, code: string): string | undefined {
  return item.custom_attributes?.find((a) => a.attribute_code === code)?.value;
}

function extractProductImages(item: MagentoProduct, storeUrl: string): readonly string[] {
  return (item.media_gallery_entries ?? [])
    .filter((e) => e.media_type === 'image')
    .map((e) => `${storeUrl}/pub/media/catalog/product${e.file}`);
}

export function mapMagentoCartItems(cartId: string, items: readonly MagentoCartItem[]): Cart {
  const lineItems: readonly LineItem[] = items.map((item) => ({
    product_id: item.sku,
    title: item.name,
    quantity: item.qty,
    unit_price_cents: dollarsToCents(item.price),
  }));

  return {
    id: cartId,
    items: lineItems,
    currency: 'USD',
  };
}

export function mapMagentoTotals(totals: MagentoTotals): readonly Total[] {
  return [
    { type: 'subtotal', amount: dollarsToCents(totals.subtotal) },
    {
      type: 'fulfillment',
      amount: dollarsToCents(totals.shipping_amount),
      display_text: 'Shipping',
    },
    { type: 'tax', amount: dollarsToCents(totals.tax_amount) },
    { type: 'total', amount: dollarsToCents(totals.grand_total) },
  ];
}

export function mapMagentoOrder(orderId: string, total: number, currency: string): Order {
  return {
    id: orderId,
    status: 'processing',
    total_cents: dollarsToCents(total),
    currency,
    created_at_iso: new Date().toISOString(),
  };
}

export function buildMagentoShippingAddress(address: PostalAddress): Record<string, unknown> {
  return {
    firstname: address.first_name,
    lastname: address.last_name,
    street: [address.street_address, address.extended_address].filter(Boolean),
    city: address.address_locality,
    postcode: address.postal_code,
    region_code: address.address_region ?? '',
    country_id: address.address_country,
    telephone: address.phone_number ?? '0000000000',
  };
}

export function mapShippingMethodToFulfillmentOption(
  method: MagentoShippingMethod,
): FulfillmentOption {
  return {
    id: `${method.carrier_code}_${method.method_code}`,
    title: `${method.carrier_title} — ${method.method_title}`,
    totals: [{ type: 'fulfillment', amount: dollarsToCents(method.price_incl_tax) }],
  };
}

export function mapShippingMethodsToFulfillment(
  methods: readonly MagentoShippingMethod[],
): Fulfillment {
  const availableMethods = methods.filter((m) => m.available);
  const options = availableMethods.map(mapShippingMethodToFulfillmentOption);

  return {
    methods: [
      {
        id: 'shipping',
        type: 'shipping',
        line_item_ids: [],
        groups: [
          {
            id: 'default',
            line_item_ids: [],
            options,
          },
        ],
      },
    ],
  };
}

export function mapMagentoTotalsWithDiscount(totals: MagentoTotalsResponse): readonly Total[] {
  const result: Total[] = [{ type: 'subtotal', amount: dollarsToCents(totals.subtotal) }];

  if (totals.discount_amount && totals.discount_amount !== 0) {
    result.push({
      type: 'discount',
      amount: dollarsToCents(totals.discount_amount),
      display_text: totals.coupon_code ? `Coupon: ${totals.coupon_code}` : 'Discount',
    });
  }

  result.push({
    type: 'fulfillment',
    amount: dollarsToCents(totals.shipping_amount),
    display_text: 'Shipping',
  });

  result.push({ type: 'tax', amount: dollarsToCents(totals.tax_amount) });
  result.push({ type: 'total', amount: dollarsToCents(totals.grand_total) });

  return result;
}

const PAYMENT_METHOD_MAP: Readonly<Record<string, string>> = {
  checkmo: 'checkmo',
  check_money_order: 'checkmo',
  cashondelivery: 'cashondelivery',
  cod: 'cashondelivery',
  banktransfer: 'banktransfer',
  free: 'free',
};

export function mapPaymentHandlerToMagentoMethod(handlerId: string): string {
  return PAYMENT_METHOD_MAP[handlerId] ?? 'checkmo';
}
