# UCP Specification References

This middleware implements the **Universal Commerce Protocol (UCP)**.

## Specification Links

| Document | URL |
|---|---|
| **Overview** | https://ucp.dev/latest/specification/overview/ |
| **Checkout Capability** | https://ucp.dev/latest/specification/checkout/ |
| **Checkout REST Binding** | https://ucp.dev/latest/specification/checkout-rest/ |
| **Order Capability** | https://ucp.dev/latest/specification/order/ |
| **Identity Linking** | https://ucp.dev/latest/specification/identity-linking/ |
| **Payment Handler Guide** | https://ucp.dev/latest/specification/payment-handler-guide/ |
| **Fulfillment Extension** | https://ucp.dev/latest/specification/fulfillment/ |
| **Discount Extension** | https://ucp.dev/latest/specification/discount/ |
| **AP2 Mandates Extension** | https://ucp.dev/latest/specification/ap2-mandates/ |

## Spec Version

This implementation targets UCP version **2026-01-23**.

## Compliance Validation

```bash
npm run validate:ucp
```

Runs automated checks against a live server (default `http://localhost:3000`).

## Schema URLs

| Schema | URL |
|---|---|
| Checkout | https://ucp.dev/2026-01-23/schemas/shopping/checkout.json |
| Order | https://ucp.dev/2026-01-23/schemas/shopping/order.json |
