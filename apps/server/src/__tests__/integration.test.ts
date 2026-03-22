/**
 * UCPM-22 + UCPM-33: Integration tests vs MockAdapter.
 *
 * These tests exercise the full Fastify request pipeline (middleware + routes)
 * against the MockAdapter, using Fastify's inject() for speed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './test-helpers.js';

const AGENT_HEADER = { 'ucp-agent': 'test-agent/1.0' };
const HOST_HEADER = { host: 'mock-store.localhost' };
const HEADERS = { ...HOST_HEADER, ...AGENT_HEADER };

describe('Integration: MockAdapter endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const result = await buildTestApp();
    app = result.app;
  });

  afterAll(async () => {
    await app.close();
  });

  // ── GET /.well-known/ucp ───────────────────────────────────────────────

  describe('GET /.well-known/ucp', () => {
    it('returns a valid UCP profile (no agent header required)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/.well-known/ucp',
        headers: HOST_HEADER,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      expect(body).toHaveProperty('ucp', '2026-01-11');
      expect(body).toHaveProperty('name', 'Mock Store');
      expect(body).toHaveProperty('capabilities');
      expect(body).toHaveProperty('links');
      expect(body).toHaveProperty('signing_keys');
      expect(Array.isArray(body['capabilities'])).toBe(true);
      expect(Array.isArray(body['links'])).toBe(true);
    });
  });

  // ── UCP-Agent header validation ───────────────────────────────────────

  describe('UCP-Agent header validation', () => {
    it('returns 401 when UCP-Agent header is missing on /ucp/* routes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ucp/products?q=shoes',
        headers: HOST_HEADER,
      });

      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      const error = body['error'] as Record<string, unknown>;
      expect(error).toHaveProperty('code', 'INVALID_AGENT');
    });

    it('allows requests with valid UCP-Agent header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ucp/products?q=shoes',
        headers: HEADERS,
      });

      expect(res.statusCode).toBe(200);
    });
  });

  // ── GET /ucp/products ─────────────────────────────────────────────────

  describe('GET /ucp/products', () => {
    it('returns product list for q=shoes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ucp/products?q=shoes',
        headers: HEADERS,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      expect(body).toHaveProperty('products');
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('page', 1);
      expect(body).toHaveProperty('limit', 20);
      const products = body['products'] as unknown[];
      expect(products.length).toBeGreaterThan(0);
    });

    it('returns empty results for unknown query', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ucp/products?q=nonexistent_xyz',
        headers: HEADERS,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      expect(body['products']).toEqual([]);
      expect(body['total']).toBe(0);
    });

    it('returns 400 when q param is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ucp/products',
        headers: HEADERS,
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      expect(body).toHaveProperty('error');
    });

    it('returns 400 when limit exceeds 100', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ucp/products?q=shoes&limit=200',
        headers: HEADERS,
      });

      expect(res.statusCode).toBe(400);
    });

    it('respects pagination params', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ucp/products?q=shoes&limit=2&page=1',
        headers: HEADERS,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      expect(body['limit']).toBe(2);
      expect(body['page']).toBe(1);
      const products = body['products'] as unknown[];
      expect(products.length).toBeLessThanOrEqual(2);
    });
  });

  // ── GET /ucp/products/:id ─────────────────────────────────────────────

  describe('GET /ucp/products/:id', () => {
    it('returns a product for a valid ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ucp/products/prod-001',
        headers: HEADERS,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      expect(body).toHaveProperty('id', 'prod-001');
      expect(body).toHaveProperty('title');
      expect(body).toHaveProperty('price');
      expect(body).toHaveProperty('in_stock');
      expect(body).toHaveProperty('variants');
    });

    it('returns 404 for an unknown product ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ucp/products/unknown-id',
        headers: HEADERS,
      });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      const error = body['error'] as Record<string, unknown>;
      expect(error).toHaveProperty('code', 'PRODUCT_NOT_FOUND');
    });
  });

  // ── Health endpoints (no tenant/agent resolution) ─────────────────────

  describe('Health endpoints', () => {
    it('GET /health returns 200 without Host or Agent header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as Record<string, unknown>;
      expect(body).toEqual({ status: 'ok', version: '0.1.0' });
    });

    it('GET /ready returns 200 without Host or Agent header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/ready',
      });

      expect(res.statusCode).toBe(200);
    });
  });
});
