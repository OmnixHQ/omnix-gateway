/**
 * Validation helpers for checkout session operations.
 */

import type { CheckoutSession, Fulfillment } from '@ucp-gateway/core';

/**
 * Check whether the session has a fulfillment destination and option selected.
 */
export function validateFulfillmentSelected(session: CheckoutSession): boolean {
  return (
    session.fulfillment?.methods.some(
      (m) => m.selected_destination_id && m.groups.some((g) => g.selected_option_id),
    ) ?? false
  );
}

/**
 * Resolve the payment instrument from the complete request body.
 * Prefers payment_data, then the selected instrument, then the first instrument.
 */
export function resolvePaymentInstrument(body: {
  readonly payment_data?: Record<string, unknown> & {
    readonly id: string;
    readonly selected?: boolean;
  };
  readonly payment?: {
    readonly instruments: readonly (Record<string, unknown> & {
      readonly id: string;
      readonly selected?: boolean;
    })[];
  };
}): (Record<string, unknown> & { readonly id: string; readonly selected?: boolean }) | undefined {
  return (
    body.payment_data ??
    body.payment?.instruments.find((i) => i.selected) ??
    body.payment?.instruments[0]
  );
}

/**
 * Determine if a session has all required data for completion.
 * Checks: line items present, buyer info, fulfillment option selected.
 */
export function shouldMarkReadyForComplete(
  session: CheckoutSession,
  fulfillment?: Fulfillment,
): boolean {
  const hasLineItems = session.line_items.length > 0;
  const hasBuyerInfo = session.buyer !== null;
  const ff = fulfillment ?? session.fulfillment;
  const hasFulfillmentSelected =
    ff?.methods.some((m) => m.groups.some((g) => g.selected_option_id)) ?? false;
  return hasLineItems && hasBuyerInfo && hasFulfillmentSelected;
}

/**
 * Determine the correct session status based on current data.
 * Allows backward transitions from ready_for_complete to incomplete.
 */
export function computeSessionStatus(
  session: CheckoutSession,
  fulfillment?: Fulfillment,
): 'incomplete' | 'ready_for_complete' {
  return shouldMarkReadyForComplete(session, fulfillment) ? 'ready_for_complete' : 'incomplete';
}
