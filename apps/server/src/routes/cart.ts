import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BuyerSchema } from '@omnixhq/ucp-js-sdk';
import { AdapterError, toSdkCart } from '@ucp-gateway/core';
import { buildUCPErrorBody } from './checkout-helpers.js';

const contextSchema = z.record(z.unknown()).optional();

const cartCreateSchema = z.object({
  line_items: z
    .array(
      z.object({
        item: z.object({ id: z.string().min(1) }),
        quantity: z.coerce.number().int().min(1),
      }),
    )
    .min(1),
  currency: z.string().min(1).default('USD'),
  buyer: BuyerSchema.optional(),
  context: contextSchema,
});

const cartUpdateSchema = z.object({
  line_items: z
    .array(
      z.object({
        item: z.object({ id: z.string().min(1) }),
        quantity: z.coerce.number().int().min(1),
      }),
    )
    .min(1),
  buyer: BuyerSchema.optional(),
  context: contextSchema,
});

export async function cartRoutes(app: FastifyInstance): Promise<void> {
  app.post('/ucp/cart', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = cartCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(
          buildUCPErrorBody(
            'validation_error',
            parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
          ),
        );
    }

    const { line_items, currency, buyer, context } = parsed.data;

    const cart = await request.adapter.createCart();
    const adapterLineItems = line_items.map((li) => ({
      product_id: li.item.id,
      title: li.item.id,
      quantity: li.quantity,
      unit_price_cents: 0,
    }));

    const updatedCart = await request.adapter.addToCart(cart.id, adapterLineItems);
    const sdkCart = toSdkCart({ ...updatedCart, currency }, { buyer, context });

    return reply.status(201).send(sdkCart);
  });

  app.put<{ Params: { id: string } }>('/ucp/cart/:id', async (request, reply: FastifyReply) => {
    const parsed = cartUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(
          buildUCPErrorBody(
            'validation_error',
            parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
          ),
        );
    }

    const { buyer, context } = parsed.data;
    const adapterLineItems = parsed.data.line_items.map((li) => ({
      product_id: li.item.id,
      title: li.item.id,
      quantity: li.quantity,
      unit_price_cents: 0,
    }));

    try {
      const updatedCart = await request.adapter.addToCart(request.params.id, adapterLineItems);
      return toSdkCart(updatedCart, { buyer, context });
    } catch (err: unknown) {
      if (err instanceof AdapterError && err.code === 'CART_NOT_FOUND') {
        return reply.status(404).send(buildUCPErrorBody('cart_not_found', err.message));
      }
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>('/ucp/cart/:id', async (request, reply: FastifyReply) => {
    try {
      const cart = await request.adapter.getCart(request.params.id);
      return toSdkCart(cart);
    } catch (err: unknown) {
      if (err instanceof AdapterError && err.code === 'CART_NOT_FOUND') {
        return reply.status(404).send(buildUCPErrorBody('cart_not_found', err.message));
      }
      throw err;
    }
  });

  app.delete<{ Params: { cartId: string; index: string } }>(
    '/ucp/cart/:cartId/items/:index',
    async (request, reply: FastifyReply) => {
      if (!request.adapter.removeFromCart) {
        return reply
          .status(501)
          .send(buildUCPErrorBody('not_supported', 'Removing items is not supported'));
      }

      try {
        const index = Number(request.params.index);
        if (!Number.isInteger(index) || index < 0) {
          return reply
            .status(400)
            .send(
              buildUCPErrorBody('validation_error', 'Item index must be a non-negative integer'),
            );
        }

        const cart = await request.adapter.removeFromCart(request.params.cartId, index);
        return toSdkCart(cart);
      } catch (err: unknown) {
        if (err instanceof AdapterError && err.code === 'CART_NOT_FOUND') {
          return reply.status(404).send(buildUCPErrorBody('cart_not_found', err.message));
        }
        throw err;
      }
    },
  );
}
