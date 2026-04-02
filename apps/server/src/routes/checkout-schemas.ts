/**
 * Zod request-validation schemas for checkout endpoints.
 *
 * Derived from the official @omnixhq/ucp-js-sdk primitives (BuyerSchema,
 * PostalAddressSchema, PaymentCredentialSchema) but kept lenient
 * (most fields optional) so that existing callers and tests continue to work.
 *
 * Response validation uses the full CheckoutResponseSchema — see
 * checkout-response.ts.
 */

import { z } from 'zod';
import { PostalAddressSchema, BuyerSchema, PaymentCredentialSchema } from '@omnixhq/ucp-js-sdk';

const postalAddressSchema = PostalAddressSchema;

const lineItemSchema = z.object({
  item: z.object({ id: z.string().min(1) }),
  quantity: z.coerce.number().int().min(1),
});

const instrumentSchema = z.object({
  id: z.string().min(1),
  handler_id: z.string().min(1),
  handler_name: z.string().optional(),
  type: z.string().min(1),
  brand: z.string().optional(),
  last_digits: z.string().optional(),
  selected: z.boolean().optional(),
  credential: PaymentCredentialSchema.partial().passthrough().optional(),
  billing_address: postalAddressSchema.optional(),
});

const paymentHandlerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    spec: z.string().optional(),
    config_schema: z.string().optional(),
    instrument_schemas: z.array(z.string()).optional(),
    config: z.record(z.unknown()).optional(),
  })
  .passthrough();

const paymentSchema = z
  .object({
    instruments: z.array(instrumentSchema).optional(),
    handlers: z.array(paymentHandlerSchema).optional(),
  })
  .passthrough()
  .optional();

const fulfillmentSchema = z
  .object({
    methods: z
      .array(
        z
          .object({
            id: z.string().optional(),
            type: z.string().optional(),
            destinations: z.array(z.record(z.unknown())).optional(),
            selected_destination_id: z.string().optional(),
            groups: z
              .array(
                z
                  .object({ id: z.string().optional(), selected_option_id: z.string().optional() })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()
  .optional();

const discountsSchema = z
  .object({
    codes: z.array(z.string()).optional(),
  })
  .passthrough()
  .optional();

export const createSessionSchema = z.object({
  line_items: z.array(lineItemSchema),
  currency: z.string().min(1).default('USD'),
  buyer: BuyerSchema.extend({
    shipping_address: postalAddressSchema.optional(),
    billing_address: postalAddressSchema.optional(),
  }).optional(),
  context: z
    .object({
      address_country: z.string().optional(),
      address_region: z.string().optional(),
      postal_code: z.string().optional(),
      intent: z.string().optional(),
      language: z.string().optional(),
      currency: z.string().optional(),
      eligibility: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),
  signals: z.record(z.unknown()).optional(),
  consent: z.record(z.boolean()).optional(),
  payment: paymentSchema.default({}),
  fulfillment: fulfillmentSchema,
  discounts: discountsSchema,
});

export const updateSessionSchema = z.object({
  id: z.string().min(1),
  line_items: z.array(lineItemSchema).optional(),
  currency: z.string().min(1).optional(),
  buyer: BuyerSchema.extend({
    shipping_address: postalAddressSchema.optional(),
    billing_address: postalAddressSchema.optional(),
  }).optional(),
  context: z
    .object({
      address_country: z.string().optional(),
      address_region: z.string().optional(),
      postal_code: z.string().optional(),
      intent: z.string().optional(),
      language: z.string().optional(),
      currency: z.string().optional(),
      eligibility: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),
  signals: z.record(z.unknown()).optional(),
  consent: z.record(z.boolean()).optional(),
  payment: paymentSchema,
  fulfillment: fulfillmentSchema,
  discounts: discountsSchema,
});

const fulfillmentEventLineItemSchema = z.object({
  id: z.string().min(1),
  quantity: z.number().int().min(1),
});

const fulfillmentEventSchema = z.object({
  type: z.string().min(1),
  line_items: z.array(fulfillmentEventLineItemSchema).default([]),
  tracking_number: z.string().optional(),
  tracking_url: z.string().optional(),
  carrier: z.string().optional(),
  description: z.string().optional(),
});

const orderAdjustmentSchema = z.object({
  type: z.string().min(1),
  status: z.enum(['pending', 'completed', 'failed']),
  line_items: z.array(fulfillmentEventLineItemSchema).optional(),
  amount: z.number().optional(),
  description: z.string().optional(),
});

export const updateOrderSchema = z.object({
  fulfillment_event: fulfillmentEventSchema.optional(),
  adjustment: orderAdjustmentSchema.optional(),
});

export const completeSessionSchema = z
  .object({
    payment: z
      .object({
        instruments: z.array(instrumentSchema).min(1),
      })
      .optional(),
    payment_data: instrumentSchema.optional(),
    risk_signals: z.record(z.string()).optional(),
    ap2_mandate: z.string().optional(),
    merchant_authorization: z.string().optional(),
  })
  .refine((data) => data.payment?.instruments?.length || data.payment_data || data.ap2_mandate, {
    message: 'Either payment.instruments, payment_data, or ap2_mandate must be provided',
  });
