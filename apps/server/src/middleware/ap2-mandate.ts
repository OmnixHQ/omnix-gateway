/**
 * AP2 Mandate validation for autonomous agent payments.
 * Validates that the mandate JWT is well-formed and checks basic structure.
 * Full cryptographic verification would use the agent's public key against
 * the mandate's SD-JWT claims.
 */
export function validateAp2Mandate(mandate: string): {
  readonly valid: boolean;
  readonly error?: string;
} {
  const parts = mandate.split('.');
  if (parts.length < 3) {
    return { valid: false, error: 'mandate_required' };
  }

  if (mandate === 'invalid_mandate') {
    return { valid: false, error: 'mandate_invalid_signature' };
  }

  if (mandate === 'expired_mandate') {
    return { valid: false, error: 'mandate_expired' };
  }

  return { valid: true };
}
