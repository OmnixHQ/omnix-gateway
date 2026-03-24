# Contributing to UCP Gateway

Thank you for your interest in contributing! This guide covers everything you need to get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Contributor License Agreement](#contributor-license-agreement)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Submitting Changes](#submitting-changes)
- [Proposing a New Adapter](#proposing-a-new-adapter)
- [Coding Standards](#coding-standards)
- [Testing Requirements](#testing-requirements)
- [Commit Message Format](#commit-message-format)

---

## Code of Conduct

All contributors must follow our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold a respectful and inclusive community.

## Contributor License Agreement

Before your first pull request can be merged, you must sign the [Contributor License Agreement](CLA.md). The CLA ensures that Momentum Group s. r. o. can continue to distribute the project under the Elastic License 2.0.

Sign the CLA by opening a PR and adding your name to `CLA.md` in the contributors section.

## Getting Started

1. **Fork** the repository on GitHub.
2. **Clone** your fork:
   ```bash
   git clone git@github.com:<your-handle>/ucp-gateway.git
   cd ucp-gateway
   ```
3. **Install** dependencies:
   ```bash
   npm install
   ```
4. **Start** backing services:
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```
5. **Configure** environment:
   ```bash
   cp .env.example .env
   # Edit .env as needed
   ```
6. **Run** the dev server:
   ```bash
   npm run dev -w apps/server
   ```

## Development Workflow

We follow **Test-Driven Development**:

1. Write a failing test (RED)
2. Implement the minimal code to pass it (GREEN)
3. Refactor (IMPROVE)
4. Ensure coverage stays ≥ 80 %

Branch naming:

- `feat/<ticket-id>-short-description`
- `fix/<ticket-id>-short-description`
- `chore/<description>`

## Submitting Changes

1. Create a feature branch from `main`.
2. Make your changes, including tests.
3. Run the full check suite:
   ```bash
   npm run typecheck && npm run lint && npm test
   ```
4. Push your branch and open a Pull Request against `main`.
5. Fill in the PR template and ensure CI is green.
6. Await review from a maintainer.

All PRs require at least **one approving review** before merge.

## Proposing a New Adapter

Use the [Adapter Request](.github/ISSUE_TEMPLATE/adapter_request.md) issue template. Include:

- Platform name and version range
- Link to the platform's public API documentation
- Your intended implementation approach
- Whether you are willing to maintain the adapter long-term

After the issue is approved, follow the adapter implementation guide in `packages/adapters/README.md` (coming soon).

## Coding Standards

- **TypeScript strict mode** — no `any`, no suppressed errors
- **Immutability** — never mutate objects; return new copies
- **Small files** — 200–400 lines typical; 800 lines maximum
- **Small functions** — fewer than 50 lines
- **Error handling** — explicit at every level; no silent swallowing
- **No hardcoded values** — use environment variables or constants

Run linting and formatting:

```bash
npm run lint:fix
npm run format
```

## Testing Requirements

- **Minimum coverage: 80 %**
- Required test types: unit, integration, and E2E for critical flows
- Test files live alongside source files: `src/foo.ts` → `src/foo.test.ts`

## Commit Message Format

```
<type>: <description>

<optional body>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

Examples:

```
feat: add Shopify Storefront GraphQL adapter
fix: handle empty cart in order creation
docs: update adapter contribution guide
```
