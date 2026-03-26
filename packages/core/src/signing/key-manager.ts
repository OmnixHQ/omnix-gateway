import crypto from 'node:crypto';
import { generateKeyPair, exportJWK, importJWK, type CryptoKey } from 'jose';
import { z } from 'zod';
import type { JsonWebKey } from '../types/commerce.js';

export interface SigningKeyPair {
  readonly privateKey: CryptoKey;
  readonly publicJwk: JsonWebKey;
}

const ALG = 'ES256';
const CRV = 'P-256';

const ecPrivateKeyJwkSchema = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  d: z.string().min(1),
  x: z.string().min(1),
  y: z.string().min(1),
  kid: z.string().optional(),
  alg: z.string().optional(),
});

export async function generateSigningKeyPair(kid: string): Promise<SigningKeyPair> {
  const { privateKey, publicKey } = await generateKeyPair(ALG, { extractable: true });
  const jwk = await exportJWK(publicKey);
  const publicJwk: JsonWebKey = {
    kty: jwk['kty']!,
    kid,
    crv: jwk['crv']!,
    x: jwk['x']!,
    y: jwk['y']!,
    use: 'sig',
    alg: ALG,
  };
  return { privateKey, publicJwk };
}

export async function importPrivateKey(jwkJson: string): Promise<CryptoKey> {
  const raw = JSON.parse(jwkJson) as unknown;
  const parsed = ecPrivateKeyJwkSchema.parse(raw);
  if (parsed.alg && parsed.alg !== ALG) {
    throw new Error(`Expected alg ${ALG}, got ${parsed.alg}`);
  }
  const jwk: Record<string, unknown> = {
    kty: parsed.kty,
    crv: parsed.crv,
    d: parsed.d,
    x: parsed.x,
    y: parsed.y,
  };
  if (parsed.kid) jwk['kid'] = parsed.kid;
  if (parsed.alg) jwk['alg'] = parsed.alg;
  return importJWK(jwk, ALG) as Promise<CryptoKey>;
}

export async function importPublicKeyFromJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  if (jwk.kty !== 'EC') {
    throw new Error(`Expected kty EC, got ${jwk.kty}`);
  }
  const algValue = jwk['alg'] as string | undefined;
  if (algValue && algValue !== ALG) {
    throw new Error(`Expected alg ${ALG}, got ${algValue}`);
  }
  return importJWK(
    { kty: jwk.kty, crv: jwk['crv'] as string, x: jwk['x'] as string, y: jwk['y'] as string },
    ALG,
  ) as Promise<CryptoKey>;
}

export function buildKeyId(prefix: string): string {
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${prefix}_${timestamp}_${suffix}`;
}

export { ALG, CRV };
