import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AdapterError } from '@ucp-gateway/core';

const searchQuerySchema = z.object({
  q: z.string().min(1, 'q is required'),
  category: z.string().optional(),
  min_price_cents: z.coerce
    .number()
    .int('min_price_cents must be an integer')
    .nonnegative()
    .optional(),
  max_price_cents: z.coerce
    .number()
    .int('max_price_cents must be an integer')
    .nonnegative()
    .optional(),
  in_stock: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  page: z.coerce.number().int().min(1).default(1),
});

/**
 * UCPM-15: Product search and detail endpoints.
 */
export async function productRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ucp/products', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({
        messages: [
          {
            type: 'error',
            code: 'VALIDATION_ERROR',
            content: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
            severity: 'recoverable',
          },
        ],
      });
    }

    const query = parsed.data;
    const products = await request.adapter.searchProducts({
      q: query.q,
      category: query.category,
      min_price_cents: query.min_price_cents,
      max_price_cents: query.max_price_cents,
      in_stock: query.in_stock,
      limit: query.limit,
      page: query.page,
    });

    return {
      products,
      total: products.length,
      page: query.page,
      limit: query.limit,
    };
  });

  app.get<{ Params: { id: string } }>('/ucp/products/:id', async (request, reply: FastifyReply) => {
    try {
      const product = await request.adapter.getProduct(request.params.id);
      return product;
    } catch (err: unknown) {
      if (err instanceof AdapterError && err.code === 'PRODUCT_NOT_FOUND') {
        return reply.status(404).send({
          messages: [
            {
              type: 'error',
              code: 'PRODUCT_NOT_FOUND',
              content: err.message,
              severity: 'recoverable',
            },
          ],
        });
      }
      throw err;
    }
  });
}
