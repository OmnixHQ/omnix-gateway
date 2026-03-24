# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- UCP-compliant checkout flow (create, update, complete, cancel)
- Fulfillment extension with shipping methods, destinations, groups, options
- Discount extension with coupon code support
- Server-side authoritative pricing
- MockAdapter for development and testing
- Magento 2.x adapter (catalog, cart, checkout)
- Shopware 6.x adapter (catalog, cart, checkout)
- UCP conformance test integration (32/47 passing)
- 74-check UCP spec compliance validator
- Version negotiation middleware
- Idempotency-Key with SHA-256 hash verification
- Docker Compose for local development
- CI pipeline with TypeScript, ESLint, Prettier, tests, UCP validation
