/**
 * Typed domain errors used across adapters and core services.
 */

export type AdapterErrorCode =
  | 'PRODUCT_NOT_FOUND'
  | 'ORDER_NOT_FOUND'
  | 'CART_NOT_FOUND'
  | 'COUPON_NOT_FOUND'
  | 'OUT_OF_STOCK'
  | 'INVALID_PAYMENT'
  | 'PLATFORM_ERROR'
  | 'NOT_FOUND'
  | 'COUNTRY_NOT_FOUND'
  | 'SHIPPING_METHOD_NOT_FOUND';

export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly statusCode: number;

  constructor(code: AdapterErrorCode, message: string, statusCode = 500) {
    super(message);
    this.name = 'AdapterError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function notFound(code: AdapterErrorCode, id: string): AdapterError {
  return new AdapterError(code, `${code}: ${id}`, 404);
}

export function outOfStock(productId: string): AdapterError {
  return new AdapterError('OUT_OF_STOCK', `Product ${productId} is out of stock`, 409);
}

export interface EscalationDetails {
  readonly reason: string;
  readonly message: string;
  readonly continue_url: string;
}

export class EscalationRequiredError extends Error {
  readonly escalation: EscalationDetails;

  constructor(escalation: EscalationDetails) {
    super(escalation.message);
    this.name = 'EscalationRequiredError';
    this.escalation = escalation;
  }
}
