# UCP Gateway — Project Rules

## Platform Adapter E2E Testing (MANDATORY)

Every platform adapter MUST have a corresponding E2E CI workflow that:

1. Starts the platform (Docker Compose or equivalent)
2. Seeds test products
3. Seeds a UCP tenant pointing to the platform
4. Starts the UCP Gateway
5. Runs a full checkout flow: search → create → update → complete → verify order
6. Runs on every PR that touches adapter code or checkout routes

No adapter PR can be merged without a passing E2E test.

### Current E2E workflows:

- Magento: `.github/workflows/test-magento-e2e.yml` + `tests/e2e-magento/`
- Shopware: TODO

## Code Style Rules

### No Descriptive Comments

Comments that describe WHAT code does are forbidden. Use function names instead.

- Enforced by: `scripts/no-descriptive-comments.sh` (runs in CI)
- Allowed: JSDoc, TODO/FIXME/NOTE/HACK, WHY-comments

### Thin Route Handlers (max 15 lines)

Route handlers do ONLY: parse request → call service → send response.
All business logic lives in service functions (`checkout-service.ts`).

### Build Order

Workspaces must build in dependency order: `core` → `adapters` → `server`.
The root `npm run build` handles this automatically.
