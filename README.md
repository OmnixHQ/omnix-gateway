# UCP Gateway

> Universal Commerce Protocol gateway — connect any e-commerce store to any AI agent.

[![CI](https://github.com/GetMomentumToday/ucp-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/GetMomentumToday/ucp-gateway/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/GetMomentumToday/ucp-gateway/graph/badge.svg)](https://codecov.io/gh/GetMomentumToday/ucp-gateway)
[![License: ELv2](https://img.shields.io/badge/License-ELv2-blue.svg)](LICENSE.md)
[![UCP Spec](https://img.shields.io/badge/UCP-2026--01--23-purple.svg)](https://ucp.dev/latest/specification/overview/)
[![Node.js 22](https://img.shields.io/badge/node-22-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

---

## Overview

**UCP Gateway** is an [ELv2-licensed](LICENSE.md) server implementing the [Universal Commerce Protocol](https://ucp.dev). It translates between e-commerce platforms (Magento, Shopware) and AI agents via a standardised checkout API.

| Problem                        | Solution                                 |
| ------------------------------ | ---------------------------------------- |
| Every shop has a different API | One UCP adapter per platform             |
| AI agents need structured data | UCP normalises products, carts, checkout |
| N x M integration hell         | N adapters + 1 UCP contract              |

## Features

- **UCP spec compliant** — 150/150 SDK schemas covered (`@omnixhq/ucp-js-sdk` v1.1.0-draft.3.1)
- **3 built-in adapters** — Magento 2.x (REST), Shopware 6.x (Store API), MockAdapter
- **Full checkout flow** — discovery, search, create/update/complete/cancel sessions
- **Catalog & cart** — product search with categories/filters, cart CRUD, SDK-shaped responses
- **Order lifecycle** — line items, fulfillment events, adjustments, fulfilled tracking
- **Multi-tenant** — Host-based routing with Redis-cached tenant resolution
- **Payment instruments** — 4 handler types (card, wallet, redirect, offline) with instruments in responses
- **Fulfillment** — destination-aware shipping (US/intl), free thresholds, pickup, `line_item_ids`
- **Escalation flow** — `requires_escalation` + `continue_url` + embedded checkout config
- **Extensions** — buyer consent, signals, identity linking, AP2 mandates, version negotiation
- **Structured errors** — UCP `messages[]` with type, code, content, severity

## Quick Start

```bash
git clone git@github.com:GetMomentumToday/ucp-gateway.git
cd ucp-gateway
npm install
docker compose -f docker-compose.dev.yml up -d
cp .env.example .env
npm run dev
```

```bash
curl http://localhost:3000/.well-known/ucp | jq
curl -H "UCP-Agent: my-agent/1.0" 'http://localhost:3000/ucp/products?q=shoes' | jq
```

## API Endpoints

### Discovery

| Method | Path               | Description                                                |
| ------ | ------------------ | ---------------------------------------------------------- |
| `GET`  | `/.well-known/ucp` | UCP profile (capabilities, payment handlers, signing keys) |

### Catalog

| Method | Path                        | Description                                   |
| ------ | --------------------------- | --------------------------------------------- |
| `GET`  | `/ucp/catalog/search?q=...` | Catalog search with UCP envelope + pagination |
| `GET`  | `/ucp/catalog/lookup/{id}`  | Single product lookup in UCP envelope         |
| `GET`  | `/ucp/products?q=...`       | Product search (legacy)                       |
| `GET`  | `/ucp/products/{id}`        | Product detail (legacy)                       |

### Cart

| Method   | Path                               | Description                                 |
| -------- | ---------------------------------- | ------------------------------------------- |
| `POST`   | `/ucp/cart`                        | Create cart with line items, buyer, context |
| `GET`    | `/ucp/cart/{id}`                   | Get cart                                    |
| `PUT`    | `/ucp/cart/{id}`                   | Update cart items                           |
| `DELETE` | `/ucp/cart/{cartId}/items/{index}` | Remove item from cart                       |

### Checkout

| Method | Path                               | Description                                                       |
| ------ | ---------------------------------- | ----------------------------------------------------------------- |
| `POST` | `/checkout-sessions`               | Create checkout session                                           |
| `GET`  | `/checkout-sessions/{id}`          | Get checkout session                                              |
| `PUT`  | `/checkout-sessions/{id}`          | Update checkout (buyer, fulfillment, discounts, consent, signals) |
| `POST` | `/checkout-sessions/{id}/complete` | Place order (payment instruments or AP2 mandate)                  |
| `POST` | `/checkout-sessions/{id}/cancel`   | Cancel checkout                                                   |

### Orders

| Method | Path           | Description                                         |
| ------ | -------------- | --------------------------------------------------- |
| `GET`  | `/orders/{id}` | Get order with line items, fulfillment, adjustments |
| `PUT`  | `/orders/{id}` | Update order (fulfillment events, adjustments)      |

### Identity Linking

| Method   | Path                              | Description                     |
| -------- | --------------------------------- | ------------------------------- |
| `GET`    | `/ucp/identity/config`            | Get identity linking mechanisms |
| `POST`   | `/ucp/identity/link`              | Create identity link            |
| `GET`    | `/ucp/identity/link/{externalId}` | Look up linked account          |
| `DELETE` | `/ucp/identity/link/{id}`         | Remove identity link            |

## Adapters

| Adapter          | Catalog                          | Cart                     | Checkout                                        | Order Lifecycle     |
| ---------------- | -------------------------------- | ------------------------ | ----------------------------------------------- | ------------------- |
| **MockAdapter**  | Search, get, categories, ratings | Create, get, add, remove | Totals, fulfillment (US/intl/pickup), discounts | Events, adjustments |
| **Magento 2.x**  | REST API                         | Guest cart, get          | Shipping, totals, order                         | Read                |
| **Shopware 6.x** | Store API                        | Store API, get           | Context, totals, order                          | Read                |
| Shopify          | Planned                          | —                        | —                                               | —                   |

## UCP Spec Compliance

```bash
npm run validate:ucp   # Automated spec checks
```

SDK: `@omnixhq/ucp-js-sdk` v1.1.0-draft.3.1 — 150/150 schemas covered.

See [UCP_SPEC.md](UCP_SPEC.md) for specification links.

## Development

```bash
npm run build          # Build all packages (core → adapters → server)
npm test               # 222 unit + integration tests
npm run validate:ucp   # UCP spec compliance checks
npm run lint           # ESLint
npm run typecheck      # TypeScript
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All contributors must sign the [CLA](CLA.md).

## License

[Elastic License 2.0 (ELv2)](LICENSE.md) — free to use, modify, and self-host. Cannot be offered as a hosted service.

For commercial licensing, contact [Momentum Group s. r. o.](https://getmomentum.today) (momentum.group139@gmail.com)
