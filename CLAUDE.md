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

- Magento: moved to private `@omnixhq/adapter-magento` repo
- Shopware: moved to private `@omnixhq/adapter-shopware` repo

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

## UCP Spec Compliance (MANDATORY)

### Reference Documents

- `docs/UCP_SPECIFICATION_REQUIREMENTS.md` — complete spec with every MUST/SHOULD/MAY
- `docs/UCP_GAP_ANALYSIS.md` — cross-reference of spec vs implementation (92 requirements)

### When to Recheck

Run `bash scripts/validate-spec-coverage.sh` in these situations:

1. **Before every release/tag** — all MUST checks must pass
2. **After implementing any spec feature** — update gap analysis + validator
3. **When UCP spec updates** — re-fetch spec pages, diff against our reference doc
4. **During PR review** — if PR touches checkout/fulfillment/order code, verify no regression

### How to Recheck

```bash
# Quick: automated spec coverage (34 checks)
bash scripts/validate-spec-coverage.sh

# Full: run UCP conformance test suite
npm run test:conformance

# Manual: review gap analysis
cat docs/UCP_GAP_ANALYSIS.md | grep MISSING
```

### Current Score (2026-04-01)

- SDK schema coverage: 150/150 (100%) — `@omnixhq/ucp-js-sdk` v1.1.0-draft.3.1
- Integration tests: 222 passing (including 18 behavioral gap tests)
- MUST/SHOULD: 60/79 (76%)
- Automated checks: 29/34 pass
- 0 MUST gaps remaining
- Spec version: 2026-01-23
