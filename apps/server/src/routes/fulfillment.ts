/**
 * Fulfillment extension logic for checkout sessions.
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
  PlatformAdapter,
  Total,
} from '@ucp-gateway/core';

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

function resolveSelectedOptionId(
  clientSelectedId: string | undefined,
  options: readonly FulfillmentOption[] | undefined,
): string | undefined {
  if (!clientSelectedId || !options || options.length === 0) return clientSelectedId;
  const exactMatch = options.find((o) => o.id === clientSelectedId);
  if (exactMatch) return clientSelectedId;
  return options[0]?.id;
}

function getStoredAddresses(_email: string | undefined): readonly FulfillmentDestination[] {
  return [];
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

function resolveItemPrice(_itemId: string, storedPrice: number | undefined): number {
  return storedPrice && storedPrice > 0 ? storedPrice : 0;
}

function computeSubtotal(lineItems: readonly CheckoutSessionLineItem[]): number {
  return lineItems.reduce((sum, li) => {
    const price = resolveItemPrice(li.item.id, li.item.price);
    return sum + price * li.quantity;
  }, 0);
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
  const freeShippingItemIds: readonly string[] = ['bouquet_roses'];
  const freeShippingThresholdCents = 10000;

  const subtotal = computeSubtotal(lineItems);
  const hasFreeItem = lineItems.some((li) => freeShippingItemIds.includes(li.item.id));
  const free = subtotal > freeShippingThresholdCents || hasFreeItem;
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

async function fetchFulfillmentOptionsFromAdapter(
  adapter: PlatformAdapter | undefined,
  cartId: string | undefined,
  destination: FulfillmentDestination,
): Promise<readonly FulfillmentOption[] | null> {
  if (adapter === undefined || cartId === undefined) return null;
  try {
    const fulfillment = await adapter.getFulfillmentOptions(cartId, destination);
    const firstGroup = fulfillment.methods[0]?.groups[0];
    return firstGroup?.options ?? null;
  } catch {
    return null;
  }
}

async function notifyAdapterOfSelectedOption(
  adapter: PlatformAdapter | undefined,
  cartId: string | undefined,
  selectedOptionId: string,
): Promise<void> {
  if (!adapter?.setShippingMethod || !cartId) return;
  try {
    await adapter.setShippingMethod(cartId, selectedOptionId);
  } catch {
    // fallback: selection stored locally even if adapter call fails
  }
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
export async function buildFulfillmentForCreate(
  requestFulfillment: Record<string, unknown> | undefined,
  lineItems: readonly CheckoutSessionLineItem[],
  buyerEmail: string | undefined,
  adapter?: PlatformAdapter,
  cartId?: string,
): Promise<Fulfillment | null> {
  if (!requestFulfillment) return null;

  const methods = requestFulfillment['methods'] as readonly Record<string, unknown>[] | undefined;
  if (!methods || methods.length === 0) return null;

  const lineItemIds = lineItems.map((li) => li.id);

  const builtMethods: FulfillmentMethod[] = [];
  for (let idx = 0; idx < methods.length; idx++) {
    const m = methods[idx]!;
    const clientDests =
      (m['destinations'] as readonly FulfillmentDestination[] | undefined) ??
      (requestFulfillment['destinations'] as readonly FulfillmentDestination[] | undefined);
    const resolvedDests = resolveDestinations(clientDests, buyerEmail);
    const selectedDestId = m['selected_destination_id'] as string | undefined;

    const selectedDest = selectedDestId
      ? resolvedDests?.find((d) => d.id === selectedDestId)
      : undefined;

    const adapterOptions = selectedDest
      ? await fetchFulfillmentOptionsFromAdapter(adapter, cartId, selectedDest)
      : null;

    const country = resolveDestinationCountry(selectedDestId, resolvedDests);
    const options =
      adapterOptions ?? (country ? generateShippingOptions(country, lineItems) : undefined);

    const clientGroups = m['groups'] as readonly Record<string, unknown>[] | undefined;
    const selectedOptionId = clientGroups?.[0]?.['selected_option_id'] as string | undefined;

    if (selectedOptionId) {
      await notifyAdapterOfSelectedOption(adapter, cartId, selectedOptionId);
    }

    const groups: readonly FulfillmentGroup[] = [
      {
        id: `group_${idx}`,
        line_item_ids: lineItemIds,
        options: options ?? undefined,
        selected_option_id: resolveSelectedOptionId(selectedOptionId, options),
      },
    ];

    builtMethods.push({
      id: `method_${idx}`,
      type: (m['type'] as string) ?? 'shipping',
      line_item_ids: lineItemIds,
      destinations: resolvedDests ?? undefined,
      selected_destination_id: selectedDestId,
      groups,
    });
  }

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

function normalizeDestination(dest: FulfillmentDestination): FulfillmentDestination {
  if (dest.address_country) return dest;
  const addr = dest.address;
  if (!addr) return dest;
  return {
    ...dest,
    address_country: addr.address_country,
    street_address: dest.street_address ?? addr.street_address,
    address_locality: dest.address_locality ?? addr.address_locality,
    address_region: dest.address_region ?? addr.address_region,
    postal_code: dest.postal_code ?? addr.postal_code,
  };
}

async function generateOptionsForSelectedDestination(
  selectedDestId: string | undefined,
  destinations: readonly FulfillmentDestination[] | undefined,
  lineItems: readonly CheckoutSessionLineItem[],
  adapter?: PlatformAdapter,
  cartId?: string,
): Promise<readonly FulfillmentOption[] | undefined> {
  if (!selectedDestId || !destinations) return undefined;
  const selectedDest = destinations.find((d) => d.id === selectedDestId);
  if (!selectedDest) return undefined;

  const normalizedDest = normalizeDestination(selectedDest);
  const adapterOptions = await fetchFulfillmentOptionsFromAdapter(adapter, cartId, normalizedDest);
  if (adapterOptions) return adapterOptions;

  const country = normalizedDest.address_country;
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
  const clientSelectedId =
    (clientGroups?.[0]?.['selected_option_id'] as string | undefined) ??
    existingGroups[0]?.selected_option_id;
  const effectiveOptions = options ?? existingGroups[0]?.options;

  return [
    {
      id: existingGroups[0]?.id ?? `group_${idx}`,
      line_item_ids: lineItemIds,
      options: effectiveOptions,
      selected_option_id: resolveSelectedOptionId(clientSelectedId, effectiveOptions),
    },
  ];
}

/**
 * Merge an incoming fulfillment update with the existing session fulfillment.
 * Handles address injection, option generation, and option selection.
 */
export async function buildFulfillmentForUpdate(
  requestFulfillment: Record<string, unknown> | undefined,
  session: CheckoutSession,
  adapter?: PlatformAdapter,
  cartId?: string,
): Promise<Fulfillment | null> {
  if (!requestFulfillment) return session.fulfillment;

  const methods = requestFulfillment['methods'] as readonly Record<string, unknown>[] | undefined;
  if (!methods || methods.length === 0) return session.fulfillment;

  const lineItems = session.line_items;
  const lineItemIds = lineItems.map((li) => li.id);
  const buyerEmail = session.buyer?.email ?? undefined;

  const existingMethods = session.fulfillment?.methods ?? [];

  const builtMethods: FulfillmentMethod[] = [];
  for (let idx = 0; idx < methods.length; idx++) {
    const m = methods[idx]!;
    const existing = existingMethods[idx];
    const methodId = (m['id'] as string) ?? existing?.id ?? `method_${idx}`;
    const methodType = (m['type'] as string) ?? existing?.type ?? 'shipping';

    const clientDests =
      (m['destinations'] as readonly FulfillmentDestination[] | undefined) ??
      (requestFulfillment['destinations'] as readonly FulfillmentDestination[] | undefined);
    const destinations = resolveDestinationsForUpdate(
      clientDests,
      methodType,
      buyerEmail,
      existing?.destinations,
    );

    const selectedDestId =
      (m['selected_destination_id'] as string | undefined) ?? existing?.selected_destination_id;

    const options = await generateOptionsForSelectedDestination(
      selectedDestId,
      destinations,
      lineItems,
      adapter,
      cartId,
    );

    const clientGroups = m['groups'] as readonly Record<string, unknown>[] | undefined;
    const existingGroups = existing?.groups ?? [];

    const selectedOptionId =
      (clientGroups?.[0]?.['selected_option_id'] as string | undefined) ??
      existingGroups[0]?.selected_option_id;

    if (selectedOptionId) {
      await notifyAdapterOfSelectedOption(adapter, cartId, selectedOptionId);
    }

    const groups = mergeGroups(clientGroups, existingGroups, options, lineItemIds, idx);

    builtMethods.push({
      id: methodId,
      type: methodType,
      line_item_ids: lineItemIds,
      destinations,
      selected_destination_id: selectedDestId,
      groups,
    });
  }

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
          const optTotal =
            option.totals.find((t) => t.type === 'total') ??
            option.totals.find((t) => t.type === 'fulfillment') ??
            option.totals[0];
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
