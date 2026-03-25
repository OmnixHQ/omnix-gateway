/**
 * Zod request-validation schemas for checkout endpoints.
 *
 * Derived from the official @ucp-js/sdk primitives (BuyerClassSchema,
 * BillingAddressClassSchema, PaymentCredentialSchema) but kept lenient
 * (most fields optional) so that existing callers and tests continue to work.
 *
 * Response validation uses the full ExtendedCheckoutResponseSchema — see
 * checkout-response.ts.
 */

import { z } from 'zod';
import { BillingAddressClassSchema, BuyerClassSchema, PaymentCredentialSchema } from '@ucp-js/sdk';

const postalAddressSchema = BillingAddressClassSchema;

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
  currency: z.string().min(1).optional(),
  buyer: BuyerClassSchema.extend({
    shipping_address: postalAddressSchema.optional(),
    billing_address: postalAddressSchema.optional(),
  }).optional(),
  context: z
    .object({
      address_country: z.string().optional(),
      address_region: z.string().optional(),
      postal_code: z.string().optional(),
    })
    .optional(),
  payment: paymentSchema,
  fulfillment: fulfillmentSchema,
  discounts: discountsSchema,
});

export const updateSessionSchema = z.object({
  id: z.string().optional(),
  line_items: z.array(lineItemSchema).optional(),
  currency: z.string().min(1).optional(),
  buyer: BuyerClassSchema.extend({
    shipping_address: postalAddressSchema.optional(),
    billing_address: postalAddressSchema.optional(),
  }).optional(),
  context: z
    .object({
      address_country: z.string().optional(),
      address_region: z.string().optional(),
      postal_code: z.string().optional(),
    })
    .optional(),
  payment: paymentSchema,
  fulfillment: fulfillmentSchema,
  discounts: discountsSchema,
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
  })
  .refine((data) => data.payment?.instruments?.length || data.payment_data, {
    message: 'Either payment.instruments or payment_data must be provided',
  });
