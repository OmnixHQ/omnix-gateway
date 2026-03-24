/**
 * Fulfillment extension logic for checkout sessions.
 *
 * Responsible for:
 * - Building fulfillment method/group/option structures
 * - Resolving customer addresses from mock data
 * - Generating shipping options based on destination country
 * - Computing fulfillment costs (including free-shipping rules)
 */

import { createHash } from 'node:crypto';
import type {
  Fulfillment,
  FulfillmentMethod,
  FulfillmentGroup,
  FulfillmentOption,
  FulfillmentDestination,
  FulfillmentOptionTotal,
  CheckoutSession,
  CheckoutSessionLineItem,
  Total,
} from '@ucp-gateway/core';
import {
  MOCK_CUSTOMERS,
  MOCK_ADDRESSES,
  MOCK_PRODUCTS,
  FREE_SHIPPING_ITEM_IDS,
  FREE_SHIPPING_THRESHOLD_CENTS,
  toFulfillmentDestination,
} from '@ucp-gateway/adapters';

function generateAddressId(dest: FulfillmentDestination): string {
  const key = JSON.stringify({
    street_address: dest.street_address ?? '',
    postal_code: dest.postal_code ?? '',
    address_country: dest.address_country ?? '',
    address_locality: dest.address_locality ?? '',
    address_region: dest.address_region ?? '',
  });
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 12);
  return `addr_${hash}`;
}

function findCustomerByEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const customer = MOCK_CUSTOMERS.find((c) => c.email.toLowerCase() === email.toLowerCase());
  return customer?.id;
}

function getStoredAddresses(email: string | undefined): readonly FulfillmentDestination[] {
  const customerId = findCustomerByEmail(email);
  return customerId
    ? MOCK_ADDRESSES.filter((a) => a.customer_id === customerId).map(toFulfillmentDestination)
    : [];
}

/**
 * Try to match a destination (without ID) against stored addresses by content.
 * Returns the stored address if matched, or undefined.
 */
function matchExistingAddress(
  dest: FulfillmentDestination,
  stored: readonly FulfillmentDestination[],
): FulfillmentDestination | undefined {
  return stored.find(
    (s) =>
      s.street_address === dest.street_address &&
      s.postal_code === dest.postal_code &&
      s.address_country === dest.address_country,
  );
}

function assignAddressId(
  dest: FulfillmentDestination,
  stored: readonly FulfillmentDestination[],
): FulfillmentDestination {
  if (dest.id) return dest;

  const matched = matchExistingAddress(dest, stored);
  if (matched) return matched;

  return { ...dest, id: generateAddressId(dest) };
}

/**
 * Process destinations from the client payload, assigning IDs to new addresses
 * and persisting them in the dynamic store.
 */
function resolveDestinations(
  clientDestinations: readonly FulfillmentDestination[] | undefined,
  email: string | undefined,
): readonly FulfillmentDestination[] | undefined {
  if (!clientDestinations || clientDestinations.length === 0) return undefined;

  const stored = getStoredAddresses(email);
  return clientDestinations.map((dest) => assignAddressId(dest, stored));
}

function resolveItemPrice(itemId: string, storedPrice: number | undefined): number {
  if (storedPrice && storedPrice > 0) return storedPrice;
  const product = MOCK_PRODUCTS.find((p) => p.id === itemId);
  return product?.price_cents ?? 0;
}

function computeSubtotal(lineItems: readonly CheckoutSessionLineItem[]): number {
  return lineItems.reduce((sum, li) => {
    const price = resolveItemPrice(li.item.id, li.item.price);
    return sum + price * li.quantity;
  }, 0);
}

function hasFreeShippingItem(lineItems: readonly CheckoutSessionLineItem[]): boolean {
  return lineItems.some((li) => FREE_SHIPPING_ITEM_IDS.includes(li.item.id));
}

function isFreeShipping(lineItems: readonly CheckoutSessionLineItem[]): boolean {
  const subtotal = computeSubtotal(lineItems);
  return subtotal > FREE_SHIPPING_THRESHOLD_CENTS || hasFreeShippingItem(lineItems);
}

function makeOptionTotals(subtotal: number, tax: number): readonly FulfillmentOptionTotal[] {
  return [
    { type: 'subtotal', amount: subtotal },
    { type: 'tax', amount: tax },
    { type: 'total', amount: subtotal + tax },
  ];
}

function generateShippingOptions(
  country: string,
  lineItems: readonly CheckoutSessionLineItem[],
): readonly FulfillmentOption[] {
  const free = isFreeShipping(lineItems);
  const isUS = country.toUpperCase() === 'US';

  if (isUS) {
    const stdCost = free ? 0 : 500;
    const expCost = free ? 0 : 1500;
    return [
      {
        id: 'std-ship',
        title: free ? 'Standard Shipping (Free)' : 'Standard Shipping',
        description: free ? 'Free standard shipping' : '5-7 business days',
        totals: makeOptionTotals(stdCost, 0),
      },
      {
        id: 'exp-ship-us',
        title: 'Express Shipping',
        description: '2-3 business days',
        totals: makeOptionTotals(expCost, 0),
      },
    ];
  }

  const stdCost = free ? 0 : 1000;
  const expCost = free ? 0 : 3000;
  return [
    {
      id: 'std-ship',
      title: free ? 'Standard Shipping (Free)' : 'Standard International Shipping',
      description: free ? 'Free standard shipping' : '10-14 business days',
      totals: makeOptionTotals(stdCost, 0),
    },
    {
      id: 'exp-ship-intl',
      title: 'Express International Shipping',
      description: '3-5 business days',
      totals: makeOptionTotals(expCost, 0),
    },
  ];
}

function resolveDestinationCountry(
  selectedDestId: string | undefined,
  destinations: readonly FulfillmentDestination[] | undefined,
): string | undefined {
  if (!selectedDestId || !destinations) return undefined;
  const selectedDest = destinations.find((d) => d.id === selectedDestId);
  return selectedDest?.address_country;
}

/**
 * Build an initial fulfillment object from a create-session request payload.
 * Returns null if no fulfillment was requested.
 */
export function buildFulfillmentForCreate(
  requestFulfillment: Record<string, unknown> | undefined,
  lineItems: readonly CheckoutSessionLineItem[],
  buyerEmail: string | undefined,
): Fulfillment | null {
  if (!requestFulfillment) return null;

  const methods = requestFulfillment['methods'] as readonly Record<string, unknown>[] | undefined;
  if (!methods || methods.length === 0) return null;

  const lineItemIds = lineItems.map((li) => li.id);

  const builtMethods: readonly FulfillmentMethod[] = methods.map((m, idx) => {
    const clientDests = m['destinations'] as readonly FulfillmentDestination[] | undefined;
    const resolvedDests = resolveDestinations(clientDests, buyerEmail);
    const selectedDestId = m['selected_destination_id'] as string | undefined;

    const country = resolveDestinationCountry(selectedDestId, resolvedDests);
    const options = country ? generateShippingOptions(country, lineItems) : undefined;

    const clientGroups = m['groups'] as readonly Record<string, unknown>[] | undefined;
    const selectedOptionId = clientGroups?.[0]?.['selected_option_id'] as string | undefined;

    const groups: readonly FulfillmentGroup[] = [
      {
        id: `group_${idx}`,
        line_item_ids: lineItemIds,
        options: options ?? undefined,
        selected_option_id: selectedOptionId,
      },
    ];

    return {
      id: `method_${idx}`,
      type: (m['type'] as string) ?? 'shipping',
      line_item_ids: lineItemIds,
      destinations: resolvedDests ?? undefined,
      selected_destination_id: selectedDestId,
      groups,
    };
  });

  return { methods: builtMethods };
}

function resolveDestinationsForUpdate(
  clientDests: readonly FulfillmentDestination[] | undefined,
  methodType: string,
  buyerEmail: string | undefined,
  existingDestinations: readonly FulfillmentDestination[] | undefined,
): readonly FulfillmentDestination[] | undefined {
  if (clientDests && clientDests.length > 0) {
    return resolveDestinations(clientDests, buyerEmail);
  }

  if (!clientDests && methodType === 'shipping') {
    const stored = getStoredAddresses(buyerEmail);
    return stored.length > 0 ? stored : undefined;
  }

  return existingDestinations;
}

function generateOptionsForSelectedDestination(
  selectedDestId: string | undefined,
  destinations: readonly FulfillmentDestination[] | undefined,
  lineItems: readonly CheckoutSessionLineItem[],
): readonly FulfillmentOption[] | undefined {
  if (!selectedDestId || !destinations) return undefined;
  const country = resolveDestinationCountry(selectedDestId, destinations);
  if (!country) return undefined;
  return generateShippingOptions(country, lineItems);
}

function mergeGroups(
  clientGroups: readonly Record<string, unknown>[] | undefined,
  existingGroups: readonly FulfillmentGroup[],
  options: readonly FulfillmentOption[] | undefined,
  lineItemIds: readonly string[],
  idx: number,
): readonly FulfillmentGroup[] {
  const selectedOptionId =
    (clientGroups?.[0]?.['selected_option_id'] as string | undefined) ??
    existingGroups[0]?.selected_option_id;

  return [
    {
      id: existingGroups[0]?.id ?? `group_${idx}`,
      line_item_ids: lineItemIds,
      options: options ?? existingGroups[0]?.options,
      selected_option_id: selectedOptionId,
    },
  ];
}

/**
 * Merge an incoming fulfillment update with the existing session fulfillment.
 * Handles address injection, option generation, and option selection.
 */
export function buildFulfillmentForUpdate(
  requestFulfillment: Record<string, unknown> | undefined,
  session: CheckoutSession,
): Fulfillment | null {
  if (!requestFulfillment) return session.fulfillment;

  const methods = requestFulfillment['methods'] as readonly Record<string, unknown>[] | undefined;
  if (!methods || methods.length === 0) return session.fulfillment;

  const lineItems = session.line_items;
  const lineItemIds = lineItems.map((li) => li.id);
  const buyerEmail = session.buyer?.email ?? undefined;

  const existingMethods = session.fulfillment?.methods ?? [];

  const builtMethods: readonly FulfillmentMethod[] = methods.map((m, idx) => {
    const existing = existingMethods[idx];
    const methodId = (m['id'] as string) ?? existing?.id ?? `method_${idx}`;
    const methodType = (m['type'] as string) ?? existing?.type ?? 'shipping';

    const clientDests = m['destinations'] as readonly FulfillmentDestination[] | undefined;
    const destinations = resolveDestinationsForUpdate(
      clientDests,
      methodType,
      buyerEmail,
      existing?.destinations,
    );

    const selectedDestId =
      (m['selected_destination_id'] as string | undefined) ?? existing?.selected_destination_id;

    const options = generateOptionsForSelectedDestination(selectedDestId, destinations, lineItems);

    const clientGroups = m['groups'] as readonly Record<string, unknown>[] | undefined;
    const existingGroups = existing?.groups ?? [];
    const groups = mergeGroups(clientGroups, existingGroups, options, lineItemIds, idx);

    return {
      id: methodId,
      type: methodType,
      line_item_ids: lineItemIds,
      destinations,
      selected_destination_id: selectedDestId,
      groups,
    };
  });

  return { methods: builtMethods };
}

/**
 * Sum the cost of all selected fulfillment options across all methods and groups.
 */
export function getSelectedFulfillmentCost(fulfillment: Fulfillment | null): number {
  if (!fulfillment) return 0;

  let cost = 0;
  for (const method of fulfillment.methods) {
    for (const group of method.groups) {
      if (group.selected_option_id && group.options) {
        const option = group.options.find((o) => o.id === group.selected_option_id);
        if (option) {
          const optTotal = option.totals.find((t) => t.type === 'total');
          cost += optTotal?.amount ?? 0;
        }
      }
    }
  }
  return cost;
}

/**
 * Compute the fulfillment cost from the selected option and add it to session totals.
 * Returns updated totals array. If no option selected, removes any existing fulfillment total.
 */
export function computeTotalsWithFulfillment(
  session: CheckoutSession,
  fulfillment: Fulfillment | null,
): readonly Total[] {
  const lineItems = session.line_items;
  const subtotal = computeSubtotal(lineItems);

  const fulfillmentCost = getSelectedFulfillmentCost(fulfillment);

  const totals: Total[] = [{ type: 'subtotal', amount: subtotal }];

  if (fulfillmentCost > 0) {
    totals.push({ type: 'fulfillment', amount: fulfillmentCost, display_text: 'Shipping' });
  }

  totals.push({ type: 'total', amount: subtotal + fulfillmentCost });

  return totals;
}
