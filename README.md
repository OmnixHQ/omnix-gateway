# UCP Gateway

> Universal Commerce Protocol gateway — connect any e-commerce store to any AI agent.

[![CI](https://github.com/GetMomentumToday/ucp-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/GetMomentumToday/ucp-gateway/actions/workflows/ci.yml)
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

- **UCP spec compliant** — `dev.ucp.shopping.checkout` v2026-01-23 with 74 automated checks
- **3 built-in adapters** — Magento 2.x (REST), Shopware 6.x (Store API), MockAdapter
- **Full checkout flow** — discovery, search, create/update/complete/cancel sessions
- **Multi-tenant** — Host-based routing with Redis-cached tenant resolution
- **Payment instruments** — spec-compliant `instruments[]` model
- **Escalation flow** — `requires_escalation` + `continue_url` for 3DS/CAPTCHA
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

| Method | Path                               | Description                    |
| ------ | ---------------------------------- | ------------------------------ |
| `GET`  | `/.well-known/ucp`                 | Business profile discovery     |
| `POST` | `/checkout-sessions`               | Create checkout                |
| `GET`  | `/checkout-sessions/{id}`          | Get checkout                   |
| `PUT`  | `/checkout-sessions/{id}`          | Update checkout (full replace) |
| `POST` | `/checkout-sessions/{id}/complete` | Place order                    |
| `POST` | `/checkout-sessions/{id}/cancel`   | Cancel                         |
| `GET`  | `/ucp/products?q=...`              | Product search                 |
| `GET`  | `/ucp/products/{id}`               | Product detail                 |

## Adapters

| Adapter          | Catalog     | Cart        | Checkout                |
| ---------------- | ----------- | ----------- | ----------------------- |
| **MockAdapter**  | Search, get | Create, add | Totals, order           |
| **Magento 2.x**  | REST API    | Guest cart  | Shipping, totals, order |
| **Shopware 6.x** | Store API   | Store API   | Context, totals, order  |
| Shopify          | Planned     | —           | —                       |

## UCP Spec Compliance

```bash
npm run validate:ucp   # 74 automated checks
```

See [UCP_SPEC.md](UCP_SPEC.md) for specification links.

## Development

```bash
npm run build          # Build all packages
npm test               # 20 unit + integration tests
npm run validate:ucp   # 74 UCP spec compliance checks
npm run lint           # ESLint
npm run typecheck      # TypeScript
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All contributors must sign the [CLA](CLA.md).

## License

[Elastic License 2.0 (ELv2)](LICENSE.md) — free to use, modify, and self-host. Cannot be offered as a hosted service.

For commercial licensing, contact [Momentum Group s. r. o.](https://getmomentum.today) (momentum.group139@gmail.com)
