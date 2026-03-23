# UCP Middleware

> Universal Commerce Protocol — connect any e-commerce store to any AI agent.

[![CI](https://github.com/GetMomentumToday/ucp-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/GetMomentumToday/ucp-gateway/actions/workflows/ci.yml)
[![License: BSL 1.1](https://img.shields.io/badge/License-BSL%201.1-blue.svg)](LICENSE)
[![Node.js 22](https://img.shields.io/badge/node-22-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Features](#2-features)
3. [Architecture](#3-architecture)
4. [Quick Start](#4-quick-start)
5. [Configuration](#5-configuration)
6. [Adapters](#6-adapters)
7. [API Reference](#7-api-reference)
8. [Development](#8-development)
9. [Contributing](#9-contributing)
10. [License](#10-license)

---

## 1. Overview

**UCP Middleware** is a BSL-licensed open-source middleware layer that implements the Universal Commerce Protocol (UCP). It acts as a translation and orchestration hub between heterogeneous e-commerce platforms and AI agent runtimes (MCP, OpenAI function-calling, Anthropic tool-use, and more).

**Why UCP Middleware?**

| Problem                               | Solution                                                  |
| ------------------------------------- | --------------------------------------------------------- |
| Every shop has a different API        | One UCP adapter per platform                              |
| AI agents need structured, typed data | UCP normalises products, orders, carts                    |
| N × M integration hell                | N adapters + M agent bridges, not N × M custom connectors |

**Supported platforms out of the box:**

- Magento 2.x
- Shopware 6.x
- Shopify (REST + GraphQL Storefront)

---

## 2. Features

- **Unified REST API** — one endpoint schema regardless of the backend shop
- **Adapter system** — plug in any e-commerce platform via a typed `IShopAdapter` interface
- **AI-agent ready** — exposes a UCP tool manifest consumable by MCP hosts and OpenAI-compatible runtimes
- **Job queues** — async order processing with BullMQ + Redis; retries and dead-letter queues included
- **Observability** — structured JSON logs (Pino), health-check endpoints, Prometheus-compatible metrics
- **Multi-tenant** — route requests to different shop backends per API key / subdomain
- **Schema-first** — Zod validation at every system boundary; no silent data corruption
- **Type-safe throughout** — strict TypeScript 5 with NodeNext module resolution

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        AI Agent / MCP Host                       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ UCP Tool calls (HTTP / SSE)
┌───────────────────────────▼─────────────────────────────────────┐
│                     apps/server  (Fastify)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │  Auth / JWT  │  │  Rate Limit  │  │  Request Validation    │ │
│  └──────────────┘  └──────────────┘  └────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │               packages/core  (UCP Engine)                │   │
│  │  Router → Adapter Selector → Normaliser → Response       │   │
│  └───────────────────────┬──────────────────────────────────┘   │
│                          │                                       │
│  ┌───────────────────────▼──────────────────────────────────┐   │
│  │          packages/adapters  (Platform Bridges)           │   │
│  │   MagentoAdapter │ ShopwareAdapter │ ShopifyAdapter      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
          │ Postgres (Drizzle ORM)       │ Redis (BullMQ)
```

**Monorepo layout:**

```
ucp-gateway/
├── apps/
│   └── server/          # Fastify HTTP server
├── packages/
│   ├── core/            # UCP engine, types, routing, normalisation
│   └── adapters/        # Platform-specific adapter implementations
├── docker-compose.yml   # Full stack (app + Postgres + Redis)
└── docker-compose.dev.yml  # Infra only (Postgres + Redis)
```

---

## 4. Quick Start

**Prerequisites:** Node.js ≥ 22, Docker

```bash
# 1. Clone
git clone git@github.com:GetMomentumToday/ucp-gateway.git
cd ucp-gateway

# 2. Install dependencies
npm install

# 3. Start backing services
docker compose -f docker-compose.dev.yml up -d

# 4. Configure environment
cp .env.example .env
# Edit .env with your shop credentials

# 5. Start the dev server
npm run dev -w apps/server
```

The API is now available at `http://localhost:3000`.

Health check: `GET /health` → `{"status":"ok"}`

---

## 5. Configuration

Copy `.env.example` to `.env` and fill in the values:

| Variable       | Description                             | Default                                   |
| -------------- | --------------------------------------- | ----------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string            | `postgresql://ucp:ucp@localhost:5432/ucp` |
| `REDIS_URL`    | Redis connection string                 | `redis://localhost:6379`                  |
| `PORT`         | HTTP server port                        | `3000`                                    |
| `SECRET_KEY`   | JWT signing secret (≥ 32 chars)         | —                                         |
| `NODE_ENV`     | `development` \| `production` \| `test` | `development`                             |
| `LOG_LEVEL`    | Pino log level                          | `info`                                    |

---

## 6. Adapters

Adapters implement the `IShopAdapter` interface from `@ucp-gateway/core`:

```typescript
import type { IShopAdapter } from '@ucp-gateway/core';

export class MyShopAdapter implements IShopAdapter {
  async getProduct(id: string) {
    /* ... */
  }
  async listProducts(query: ProductQuery) {
    /* ... */
  }
  async getCart(cartId: string) {
    /* ... */
  }
  async createOrder(payload: OrderPayload) {
    /* ... */
  }
  // ...
}
```

**Built-in adapters** (in `packages/adapters`):

| Adapter      | Status  | Notes              |
| ------------ | ------- | ------------------ |
| Magento 2.x  | Planned | REST API v1        |
| Shopware 6.x | Planned | Store API          |
| Shopify      | Planned | Storefront GraphQL |

**Community adapters:** see [CONTRIBUTING.md](CONTRIBUTING.md) for the adapter request process.

---

## 7. API Reference

All endpoints are prefixed with `/api/v1`.

| Method | Path                   | Description                  |
| ------ | ---------------------- | ---------------------------- |
| `GET`  | `/health`              | Liveness check               |
| `GET`  | `/ready`               | Readiness check (DB + Redis) |
| `GET`  | `/api/v1/products`     | List products                |
| `GET`  | `/api/v1/products/:id` | Get product by ID            |
| `GET`  | `/api/v1/cart/:id`     | Get cart                     |
| `POST` | `/api/v1/cart`         | Create/update cart           |
| `POST` | `/api/v1/orders`       | Place order                  |
| `GET`  | `/api/v1/orders/:id`   | Get order status             |

Full OpenAPI spec is served at `/docs` when `NODE_ENV=development`.

---

## 8. Development

```bash
# Build all packages
npm run build

# Run all tests
npm test

# Lint
npm run lint

# Type-check
npm run typecheck

# Database migrations
npm run db:migrate -w apps/server
```

**Branch strategy:** `main` is always production-ready. Feature work goes to `feat/<ticket>` branches and merges via PR after CI passes and code review.

---

## 9. Contributing

We welcome contributions! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

- Bug reports → use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) template
- New adapter proposals → use the [Adapter Request](.github/ISSUE_TEMPLATE/adapter_request.md) template
- Feature requests → use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) template

All contributors must sign the [Contributor License Agreement](CLA.md).

---

## 10. License

UCP Middleware is licensed under the [Business Source License 1.1](LICENSE).

- **Change Date:** Four years from the date of each release
- **Change License:** Apache 2.0
- **Additional Use Grant:** You may use the software for non-production, evaluation, and development purposes free of charge.

For commercial production use, contact [Momentum Group s. r. o.](https://getmomentum.today).
