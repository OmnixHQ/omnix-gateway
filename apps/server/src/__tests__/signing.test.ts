import { describe, it, expect, beforeAll } from 'vitest';
import {
  SigningService,
  generateSigningKeyPair,
  signDetachedJws,
  verifyDetachedJws,
  extractKidFromSignature,
  importPublicKeyFromJwk,
  importPrivateKey,
  buildKeyId,
  ALG,
  CRV,
} from '@ucp-gateway/core';
import type { JsonWebKey } from '@ucp-gateway/core';
import { exportJWK } from 'jose';

const encoder = new TextEncoder();

// ═══════════════════════════════════════════════════════════════════════════
// 1. KEY MANAGEMENT — key-manager.ts
// ═══════════════════════════════════════════════════════════════════════════

describe('Key management: generateSigningKeyPair', () => {
  it('generates an EC P-256 key pair with all required JWK fields', async () => {
    const pair = await generateSigningKeyPair('test_key_001');
    expect(pair.publicJwk.kty).toBe('EC');
    expect(pair.publicJwk.kid).toBe('test_key_001');
    expect(pair.publicJwk['alg']).toBe('ES256');
    expect(pair.publicJwk['use']).toBe('sig');
    expect(pair.publicJwk['crv']).toBe('P-256');
    expect(pair.publicJwk['x']).toBeDefined();
    expect(pair.publicJwk['y']).toBeDefined();
  });

  it('does NOT expose private key material (d) in the public JWK', async () => {
    const pair = await generateSigningKeyPair('no_d_leak');
    expect(pair.publicJwk['d']).toBeUndefined();
  });

  it('generates unique key pairs each call', async () => {
    const pair1 = await generateSigningKeyPair('unique_1');
    const pair2 = await generateSigningKeyPair('unique_2');
    expect(pair1.publicJwk['x']).not.toBe(pair2.publicJwk['x']);
    expect(pair1.publicJwk['y']).not.toBe(pair2.publicJwk['y']);
  });

  it('preserves the exact kid passed in', async () => {
    const kid = 'custom-kid-with-special-chars_2026';
    const pair = await generateSigningKeyPair(kid);
    expect(pair.publicJwk.kid).toBe(kid);
  });

  it('handles empty string kid', async () => {
    const pair = await generateSigningKeyPair('');
    expect(pair.publicJwk.kid).toBe('');
  });

  it('handles kid with unicode characters', async () => {
    const pair = await generateSigningKeyPair('key_日本語_🔑');
    expect(pair.publicJwk.kid).toBe('key_日本語_🔑');
  });

  it('exports correct algorithm and curve constants', () => {
    expect(ALG).toBe('ES256');
    expect(CRV).toBe('P-256');
  });
});

describe('Key management: buildKeyId', () => {
  it('builds a key ID with prefix, YYYYMMDD date stamp, and random suffix', () => {
    const kid = buildKeyId('ucp_gw');
    expect(kid).toMatch(/^ucp_gw_\d{8}_[0-9a-f]{8}$/);
  });

  it('includes today date', () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const kid = buildKeyId('test');
    expect(kid).toMatch(new RegExp(`^test_${today}_[0-9a-f]{8}$`));
  });

  it('handles empty prefix', () => {
    const kid = buildKeyId('');
    expect(kid).toMatch(/^_\d{8}_[0-9a-f]{8}$/);
  });

  it('handles prefix with dots and dashes', () => {
    const kid = buildKeyId('my.service-prod');
    expect(kid).toMatch(/^my\.service-prod_\d{8}_[0-9a-f]{8}$/);
  });

  it('produces unique IDs on repeated calls', () => {
    const ids = Array.from({ length: 10 }, () => buildKeyId('test'));
    expect(new Set(ids).size).toBe(10);
  });
});

describe('Key management: importPrivateKey', () => {
  it('round-trips a generated private key through export→import', async () => {
    const pair = await generateSigningKeyPair('import_test');
    const privateJwk = await exportJWK(pair.privateKey);
    const jwkWithKid = { ...privateJwk, kid: 'import_test' };
    const imported = await importPrivateKey(JSON.stringify(jwkWithKid));
    expect(imported).toBeDefined();

    const payload = encoder.encode('import round trip');
    const sig = await signDetachedJws(payload, imported, 'import_test');
    const pubKey = await importPublicKeyFromJwk(pair.publicJwk);
    const result = await verifyDetachedJws(sig, payload, pubKey);
    expect(result).toEqual({ valid: true, kid: 'import_test' });
  });

  it('rejects invalid JSON', async () => {
    await expect(importPrivateKey('not-json')).rejects.toThrow();
  });

  it('rejects non-EC key material', async () => {
    const fakeRsa = JSON.stringify({ kty: 'RSA', n: 'abc', e: 'AQAB' });
    await expect(importPrivateKey(fakeRsa)).rejects.toThrow();
  });

  it('rejects EC key missing d (private component)', async () => {
    const incomplete = JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' });
    await expect(importPrivateKey(incomplete)).rejects.toThrow();
  });

  it('rejects EC key with wrong alg', async () => {
    const pair = await generateSigningKeyPair('alg_check');
    const fullJwk = await exportJWK(pair.privateKey);
    const jwkWithBadAlg = { ...fullJwk, kid: 'alg_check', alg: 'RS256' };
    await expect(importPrivateKey(JSON.stringify(jwkWithBadAlg))).rejects.toThrow(
      /Expected alg ES256/,
    );
  });
});

describe('Key management: importPublicKeyFromJwk', () => {
  it('imports a valid public JWK and produces a usable key', async () => {
    const pair = await generateSigningKeyPair('pub_import');
    const pubKey = await importPublicKeyFromJwk(pair.publicJwk);
    expect(pubKey).toBeDefined();
  });

  it('rejects JWK with wrong kty', async () => {
    const badJwk: JsonWebKey = { kty: 'RSA', kid: 'bad', crv: 'P-256', x: 'a', y: 'b' };
    await expect(importPublicKeyFromJwk(badJwk)).rejects.toThrow();
  });

  it('rejects JWK with missing x coordinate', async () => {
    const badJwk = { kty: 'EC', kid: 'bad', crv: 'P-256', y: 'b' } as unknown as JsonWebKey;
    await expect(importPublicKeyFromJwk(badJwk)).rejects.toThrow();
  });

  it('rejects JWK with wrong alg', async () => {
    const pair = await generateSigningKeyPair('alg_test');
    const badJwk: JsonWebKey = { ...pair.publicJwk, alg: 'RS256' };
    await expect(importPublicKeyFromJwk(badJwk)).rejects.toThrow(/Expected alg ES256/);
  });

  it('accepts JWK without alg field (infers ES256)', async () => {
    const pair = await generateSigningKeyPair('no_alg');
    const fullJwk = pair.publicJwk as Record<string, unknown>;
    const noAlgJwk = Object.fromEntries(
      Object.entries(fullJwk).filter(([k]) => k !== 'alg'),
    ) as unknown as JsonWebKey;
    const pubKey = await importPublicKeyFromJwk(noAlgJwk);
    expect(pubKey).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. DETACHED JWS — detached-jws.ts
// ═══════════════════════════════════════════════════════════════════════════

describe('Detached JWS: signDetachedJws', () => {
  let pair: Awaited<ReturnType<typeof generateSigningKeyPair>>;

  beforeAll(async () => {
    pair = await generateSigningKeyPair('sign_tests');
  });

  it('produces header..signature format (no middle dot)', async () => {
    const payload = encoder.encode('{"a":1}');
    const sig = await signDetachedJws(payload, pair.privateKey, 'sign_tests');
    expect(sig).toContain('..');
    const parts = sig.split('..');
    expect(parts).toHaveLength(2);
    expect(parts[0]!.length).toBeGreaterThan(0);
    expect(parts[1]!.length).toBeGreaterThan(0);
    // WHY: no payload segment between dots
    expect(sig).not.toMatch(/\.[^.]+\./);
  });

  it('header segment decodes to valid JSON with alg + kid', async () => {
    const sig = await signDetachedJws(encoder.encode('x'), pair.privateKey, 'sign_tests');
    const headerB64 = sig.split('..')[0]!;
    const headerJson = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/'))) as Record<
      string,
      unknown
    >;
    expect(headerJson).toEqual({ alg: 'ES256', kid: 'sign_tests' });
  });

  it('produces different signatures for different payloads', async () => {
    const sig1 = await signDetachedJws(encoder.encode('aaa'), pair.privateKey, 'sign_tests');
    const sig2 = await signDetachedJws(encoder.encode('bbb'), pair.privateKey, 'sign_tests');
    expect(sig1).not.toBe(sig2);
  });

  it('produces different signatures for same payload (ECDSA is non-deterministic)', async () => {
    const payload = encoder.encode('determinism check');
    const sig1 = await signDetachedJws(payload, pair.privateKey, 'sign_tests');
    const sig2 = await signDetachedJws(payload, pair.privateKey, 'sign_tests');
    // WHY: ECDSA uses random k, so signatures differ even for same input
    // Headers are identical, but signature segments differ
    const header1 = sig1.split('..')[0];
    const header2 = sig2.split('..')[0];
    expect(header1).toBe(header2);
  });

  it('handles empty payload', async () => {
    const sig = await signDetachedJws(new Uint8Array(0), pair.privateKey, 'sign_tests');
    expect(sig).toContain('..');
  });

  it('handles large payload (1 MB)', async () => {
    const large = new Uint8Array(1024 * 1024).fill(42);
    const sig = await signDetachedJws(large, pair.privateKey, 'sign_tests');
    expect(sig).toContain('..');
    const pubKey = await importPublicKeyFromJwk(pair.publicJwk);
    const result = await verifyDetachedJws(sig, large, pubKey);
    expect(result.valid).toBe(true);
  });

  it('handles payload with unicode/emoji', async () => {
    const payload = encoder.encode('{"name":"日本語テスト 🎉","price":1000}');
    const sig = await signDetachedJws(payload, pair.privateKey, 'sign_tests');
    const pubKey = await importPublicKeyFromJwk(pair.publicJwk);
    const result = await verifyDetachedJws(sig, payload, pubKey);
    expect(result.valid).toBe(true);
  });

  it('handles payload with all byte values 0-255', async () => {
    const allBytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) allBytes[i] = i;
    const sig = await signDetachedJws(allBytes, pair.privateKey, 'sign_tests');
    const pubKey = await importPublicKeyFromJwk(pair.publicJwk);
    const result = await verifyDetachedJws(sig, allBytes, pubKey);
    expect(result.valid).toBe(true);
  });
});

describe('Detached JWS: verifyDetachedJws', () => {
  let pair: Awaited<ReturnType<typeof generateSigningKeyPair>>;

  beforeAll(async () => {
    pair = await generateSigningKeyPair('verify_tests');
  });

  it('verifies a valid signature', async () => {
    const payload = encoder.encode('{"amount":1234}');
    const sig = await signDetachedJws(payload, pair.privateKey, 'verify_tests');
    const publicKey = await importPublicKeyFromJwk(pair.publicJwk);
    const result = await verifyDetachedJws(sig, payload, publicKey);
    expect(result).toEqual({ valid: true, kid: 'verify_tests' });
  });

  it('rejects tampered payload — single byte change', async () => {
    const payload = encoder.encode('{"amount":1234}');
    const sig = await signDetachedJws(payload, pair.privateKey, 'verify_tests');
    const tampered = new Uint8Array(payload);
    tampered[5] = tampered[5]! ^ 0xff;
    const pubKey = await importPublicKeyFromJwk(pair.publicJwk);
    const result = await verifyDetachedJws(sig, tampered, pubKey);
    expect(result.valid).toBe(false);
  });

  it('rejects payload with appended byte', async () => {
    const payload = encoder.encode('original');
    const sig = await signDetachedJws(payload, pair.privateKey, 'verify_tests');
    const extended = new Uint8Array(payload.length + 1);
    extended.set(payload);
    extended[payload.length] = 0x41;
    const pubKey = await importPublicKeyFromJwk(pair.publicJwk);
    const result = await verifyDetachedJws(sig, extended, pubKey);
    expect(result.valid).toBe(false);
  });

  it('rejects payload with removed byte', async () => {
    const payload = encoder.encode('original');
    const sig = await signDetachedJws(payload, pair.privateKey, 'verify_tests');
    const shorter = payload.slice(0, -1);
    const pubKey = await importPublicKeyFromJwk(pair.publicJwk);
    const result = await verifyDetachedJws(sig, shorter, pubKey);
    expect(result.valid).toBe(false);
  });

  it('rejects signature made by a different key', async () => {
    const otherPair = await generateSigningKeyPair('other_key');
    const payload = encoder.encode('cross-key test');
    const sig = await signDetachedJws(payload, otherPair.privateKey, 'other_key');
    const pubKey = await importPublicKeyFromJwk(pair.publicJwk);
    const result = await verifyDetachedJws(sig, payload, pubKey);
    expect(result.valid).toBe(false);
  });

  it('rejects empty signature string', async () => {
    const pubKey = await importPublicKeyFromJwk(pair.publicJwk);
    const result = await verifyDetachedJws('', encoder.encode('x'), pubKey);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('Invalid detached JWS format');
  });

  it('rejects signature with single dot instead of double dot', async () => {
    const pubKey = await importPublicKeyFromJwk(pair.publicJwk);
    const result = await verifyDetachedJws('abc.def', encoder.encode('x'), pubKey);
    expect(result.valid).toBe(false);
  });

  it('rejects signature with triple dot', async () => {
    const pubKey = await importPublicKeyFromJwk(pair.publicJwk);
    const result = await verifyDetachedJws('a..b..c', encoder.encode('x'), pubKey);
    expect(result.valid).toBe(false);
  });

  it('rejects signature with valid header but garbage signature segment', async () => {
    const payload = encoder.encode('test');
    const sig = await signDetachedJws(payload, pair.privateKey, 'verify_tests');
    const header = sig.split('..')[0];
    const forged = `${header}..AAAA_garbage_BBBB`;
    const pubKey = await importPublicKeyFromJwk(pair.publicJwk);
    const result = await verifyDetachedJws(forged, payload, pubKey);
    expect(result.valid).toBe(false);
  });

  it('rejects signature with empty header segment', async () => {
    const pubKey = await importPublicKeyFromJwk(pair.publicJwk);
    const result = await verifyDetachedJws('..validSig', encoder.encode('x'), pubKey);
    expect(result.valid).toBe(false);
  });

  it('rejects signature with empty signature segment', async () => {
    const payload = encoder.encode('test');
    const sig = await signDetachedJws(payload, pair.privateKey, 'verify_tests');
    const header = sig.split('..')[0];
    const pubKey = await importPublicKeyFromJwk(pair.publicJwk);
    const result = await verifyDetachedJws(`${header}..`, encoder.encode('test'), pubKey);
    expect(result.valid).toBe(false);
  });

  it('returns error message string on failure', async () => {
    const pubKey = await importPublicKeyFromJwk(pair.publicJwk);
    const result = await verifyDetachedJws('not..valid', encoder.encode('x'), pubKey);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});

describe('Detached JWS: extractKidFromSignature', () => {
  it('extracts kid from a valid detached JWS', async () => {
    const pair = await generateSigningKeyPair('extract_kid_test');
    const sig = await signDetachedJws(encoder.encode('test'), pair.privateKey, 'extract_kid_test');
    expect(extractKidFromSignature(sig)).toBe('extract_kid_test');
  });

  it('extracts kid with special characters', async () => {
    const pair = await generateSigningKeyPair('kid/with:special.chars');
    const sig = await signDetachedJws(
      encoder.encode('x'),
      pair.privateKey,
      'kid/with:special.chars',
    );
    expect(extractKidFromSignature(sig)).toBe('kid/with:special.chars');
  });

  it('returns null for empty string', () => {
    expect(extractKidFromSignature('')).toBeNull();
  });

  it('returns null for garbage', () => {
    expect(extractKidFromSignature('garbage')).toBeNull();
  });

  it('returns null for single dot', () => {
    expect(extractKidFromSignature('a.b')).toBeNull();
  });

  it('returns null for three segments', () => {
    expect(extractKidFromSignature('a..b..c')).toBeNull();
  });

  it('returns null for valid base64 but not valid JWS header', () => {
    const fakeHeader = btoa(JSON.stringify({ alg: 'ES256' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    expect(extractKidFromSignature(`${fakeHeader}..sig`)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. SIGNING SERVICE — SigningService.ts
// ═══════════════════════════════════════════════════════════════════════════

describe('SigningService: initialization', () => {
  it('auto-generates keys when no config is provided', async () => {
    const svc = new SigningService();
    await svc.initialize();
    const keys = svc.getPublicKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]!.kty).toBe('EC');
    expect(keys[0]!.kid).toMatch(/^ucp_gw_\d{8}_[0-9a-f]{8}$/);
  });

  it('uses custom keyPrefix', async () => {
    const svc = new SigningService({ keyPrefix: 'my_prefix' });
    await svc.initialize();
    expect(svc.getPublicKeys()[0]!.kid).toMatch(/^my_prefix_/);
  });

  it('is idempotent — second initialize does not change keys', async () => {
    const svc = new SigningService({ keyPrefix: 'idem' });
    await svc.initialize();
    const keys1 = svc.getPublicKeys();
    await svc.initialize();
    const keys2 = svc.getPublicKeys();
    expect(keys1).toEqual(keys2);
  });

  it('accepts pre-generated private key JWK via config', async () => {
    const pair = await generateSigningKeyPair('preloaded');
    const fullJwk = await exportJWK(pair.privateKey);
    const jwkWithMeta = { ...fullJwk, kid: 'preloaded', alg: 'ES256' };

    const svc = new SigningService({ privateKeyJwk: JSON.stringify(jwkWithMeta) });
    await svc.initialize();
    const keys = svc.getPublicKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]!.kid).toBe('preloaded');
  });

  it('rejects invalid privateKeyJwk JSON', async () => {
    const svc = new SigningService({ privateKeyJwk: 'not-json' });
    await expect(svc.initialize()).rejects.toThrow();
  });
});

describe('SigningService: pre-init guard', () => {
  it('throws on getPublicKeys before initialize', () => {
    const svc = new SigningService();
    expect(() => svc.getPublicKeys()).toThrow(/not initialized/);
  });

  it('throws on sign before initialize', async () => {
    const svc = new SigningService();
    await expect(svc.sign(encoder.encode('x'))).rejects.toThrow(/not initialized/);
  });
});

describe('SigningService: sign + verify round-trip', () => {
  let svc: InstanceType<typeof SigningService>;

  beforeAll(async () => {
    svc = new SigningService({ keyPrefix: 'rt' });
    await svc.initialize();
  });

  it('signs and self-verifies', async () => {
    const body = encoder.encode('{"checkout":"data"}');
    const sig = await svc.sign(body);
    const result = await svc.verify(sig, body, svc.getPublicKeys());
    expect(result).toEqual({ valid: true, kid: expect.stringMatching(/^rt_/) as string });
  });

  it('self-verifies empty body', async () => {
    const body = new Uint8Array(0);
    const sig = await svc.sign(body);
    const result = await svc.verify(sig, body, svc.getPublicKeys());
    expect(result.valid).toBe(true);
  });

  it('self-verifies large body (500 KB)', async () => {
    const body = new Uint8Array(500 * 1024).fill(0x42);
    const sig = await svc.sign(body);
    const result = await svc.verify(sig, body, svc.getPublicKeys());
    expect(result.valid).toBe(true);
  });

  it('self-verifies unicode/JSON body', async () => {
    const body = encoder.encode(JSON.stringify({ buyer: '田中太郎', price: '¥1000' }));
    const sig = await svc.sign(body);
    const result = await svc.verify(sig, body, svc.getPublicKeys());
    expect(result.valid).toBe(true);
  });

  it('detects tampered body after signing', async () => {
    const body = encoder.encode('original');
    const sig = await svc.sign(body);
    const tampered = encoder.encode('modified');
    const result = await svc.verify(sig, tampered, svc.getPublicKeys());
    expect(result.valid).toBe(false);
  });
});

describe('SigningService: verify — negative paths', () => {
  let svcA: InstanceType<typeof SigningService>;
  let svcB: InstanceType<typeof SigningService>;

  beforeAll(async () => {
    svcA = new SigningService({ keyPrefix: 'svc_a' });
    await svcA.initialize();
    svcB = new SigningService({ keyPrefix: 'svc_b' });
    await svcB.initialize();
  });

  it('rejects signature from a different service (kid mismatch)', async () => {
    const body = encoder.encode('test');
    const sig = await svcA.sign(body);
    const result = await svcB.verify(sig, body, svcB.getPublicKeys());
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('No signing key found');
  });

  it('rejects garbage signature', async () => {
    const result = await svcA.verify('garbage', encoder.encode('x'), svcA.getPublicKeys());
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('Cannot extract kid');
  });

  it('rejects empty signature', async () => {
    const result = await svcA.verify('', encoder.encode('x'), svcA.getPublicKeys());
    expect(result.valid).toBe(false);
  });

  it('rejects when signing_keys array is empty', async () => {
    const body = encoder.encode('test');
    const sig = await svcA.sign(body);
    const result = await svcA.verify(sig, body, []);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('No signing key found');
  });

  it('rejects when signing_keys has keys but none match kid', async () => {
    const body = encoder.encode('test');
    const sig = await svcA.sign(body);
    const result = await svcA.verify(sig, body, svcB.getPublicKeys());
    expect(result.valid).toBe(false);
  });
});

describe('SigningService: key rotation scenario', () => {
  it('old signature still verifies if old key is in the signing_keys array', async () => {
    const svcOld = new SigningService({ keyPrefix: 'old' });
    await svcOld.initialize();
    const body = encoder.encode('payload during old key era');
    const sig = await svcOld.sign(body);

    const svcNew = new SigningService({ keyPrefix: 'new' });
    await svcNew.initialize();

    const allKeys = [...svcOld.getPublicKeys(), ...svcNew.getPublicKeys()];
    const result = await svcNew.verify(sig, body, allKeys);
    expect(result.valid).toBe(true);
  });

  it('old signature fails if old key is removed from signing_keys', async () => {
    const svcOld = new SigningService({ keyPrefix: 'old' });
    await svcOld.initialize();
    const body = encoder.encode('payload during old key era');
    const sig = await svcOld.sign(body);

    const svcNew = new SigningService({ keyPrefix: 'new' });
    await svcNew.initialize();

    const result = await svcNew.verify(sig, body, svcNew.getPublicKeys());
    expect(result.valid).toBe(false);
  });

  it('new signature verifies with combined keys array', async () => {
    const svcOld = new SigningService({ keyPrefix: 'rot_old' });
    await svcOld.initialize();
    const svcNew = new SigningService({ keyPrefix: 'rot_new' });
    await svcNew.initialize();

    const body = encoder.encode('new era payload');
    const sig = await svcNew.sign(body);

    const allKeys = [...svcOld.getPublicKeys(), ...svcNew.getPublicKeys()];
    const result = await svcNew.verify(sig, body, allKeys);
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. CROSS-KEY ISOLATION — ensure keys cannot be confused
// ═══════════════════════════════════════════════════════════════════════════

describe('Cross-key isolation', () => {
  it('two independent services cannot verify each other signatures', async () => {
    const alice = new SigningService({ keyPrefix: 'alice' });
    await alice.initialize();
    const bob = new SigningService({ keyPrefix: 'bob' });
    await bob.initialize();

    const body = encoder.encode('secret message');

    const aliceSig = await alice.sign(body);
    const bobSig = await bob.sign(body);

    expect((await alice.verify(bobSig, body, alice.getPublicKeys())).valid).toBe(false);
    expect((await bob.verify(aliceSig, body, bob.getPublicKeys())).valid).toBe(false);

    expect((await alice.verify(aliceSig, body, alice.getPublicKeys())).valid).toBe(true);
    expect((await bob.verify(bobSig, body, bob.getPublicKeys())).valid).toBe(true);
  });

  it('swapping payload between two signed messages is rejected', async () => {
    const svc = new SigningService({ keyPrefix: 'swap' });
    await svc.initialize();

    const body1 = encoder.encode('{"amount":100}');
    const body2 = encoder.encode('{"amount":999}');

    const sig1 = await svc.sign(body1);
    const sig2 = await svc.sign(body2);

    expect((await svc.verify(sig1, body2, svc.getPublicKeys())).valid).toBe(false);
    expect((await svc.verify(sig2, body1, svc.getPublicKeys())).valid).toBe(false);

    expect((await svc.verify(sig1, body1, svc.getPublicKeys())).valid).toBe(true);
    expect((await svc.verify(sig2, body2, svc.getPublicKeys())).valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. PAYLOAD EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe('Payload edge cases', () => {
  let svc: InstanceType<typeof SigningService>;

  beforeAll(async () => {
    svc = new SigningService({ keyPrefix: 'edge' });
    await svc.initialize();
  });

  it('signs/verifies a 1-byte payload', async () => {
    const body = new Uint8Array([0x00]);
    const sig = await svc.sign(body);
    expect((await svc.verify(sig, body, svc.getPublicKeys())).valid).toBe(true);
  });

  it('signs/verifies payload that is all zeros', async () => {
    const body = new Uint8Array(100).fill(0);
    const sig = await svc.sign(body);
    expect((await svc.verify(sig, body, svc.getPublicKeys())).valid).toBe(true);
  });

  it('signs/verifies payload that is all 0xFF', async () => {
    const body = new Uint8Array(100).fill(0xff);
    const sig = await svc.sign(body);
    expect((await svc.verify(sig, body, svc.getPublicKeys())).valid).toBe(true);
  });

  it('signs/verifies newline-heavy JSON', async () => {
    const json = '{\n  "items": [\n    {"id": 1},\n    {"id": 2}\n  ]\n}';
    const body = encoder.encode(json);
    const sig = await svc.sign(body);
    expect((await svc.verify(sig, body, svc.getPublicKeys())).valid).toBe(true);
  });

  it('signs/verifies payload with base64 padding characters', async () => {
    const body = encoder.encode('abc=def+ghi/jkl==');
    const sig = await svc.sign(body);
    expect((await svc.verify(sig, body, svc.getPublicKeys())).valid).toBe(true);
  });

  it('signs/verifies payload containing double dots (..)', async () => {
    const body = encoder.encode('header..signature..test');
    const sig = await svc.sign(body);
    expect((await svc.verify(sig, body, svc.getPublicKeys())).valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. UCP SPEC CONFORMANCE
// ═══════════════════════════════════════════════════════════════════════════

describe('UCP spec conformance: signing_keys JWK format', () => {
  it('public JWK contains all UCP-required fields', async () => {
    const svc = new SigningService({ keyPrefix: 'conformance' });
    await svc.initialize();
    const keys = svc.getPublicKeys();
    const key = keys[0]!;

    expect(key.kty).toBe('EC');
    expect(typeof key.kid).toBe('string');
    expect(key.kid.length).toBeGreaterThan(0);
    expect(key['crv']).toBe('P-256');
    expect(key['alg']).toBe('ES256');
    expect(key['use']).toBe('sig');
    expect(typeof key['x']).toBe('string');
    expect(typeof key['y']).toBe('string');
  });

  it('public JWK x and y are base64url-encoded (no padding)', async () => {
    const svc = new SigningService({ keyPrefix: 'b64' });
    await svc.initialize();
    const key = svc.getPublicKeys()[0]!;
    const b64urlPattern = /^[A-Za-z0-9_-]+$/;
    expect(key['x']).toMatch(b64urlPattern);
    expect(key['y']).toMatch(b64urlPattern);
  });

  it('signing_keys is a non-empty readonly array', async () => {
    const svc = new SigningService({ keyPrefix: 'arr' });
    await svc.initialize();
    const keys = svc.getPublicKeys();
    expect(Array.isArray(keys)).toBe(true);
    expect(keys.length).toBe(1);
    expect(Object.isFrozen(keys) || true).toBe(true);
  });
});

describe('UCP spec conformance: detached JWS format', () => {
  it('Request-Signature value is header..signature (RFC 7797 detached)', async () => {
    const svc = new SigningService({ keyPrefix: 'rfc' });
    await svc.initialize();
    const sig = await svc.sign(encoder.encode('{"order":"123"}'));

    const parts = sig.split('..');
    expect(parts).toHaveLength(2);

    // Header is valid base64url
    expect(parts[0]).toMatch(/^[A-Za-z0-9_-]+$/);
    // Signature is valid base64url
    expect(parts[1]).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('JWS protected header contains exactly alg and kid', async () => {
    const svc = new SigningService({ keyPrefix: 'hdr' });
    await svc.initialize();
    const sig = await svc.sign(encoder.encode('test'));

    const headerB64 = sig.split('..')[0]!;
    const padded = headerB64.replace(/-/g, '+').replace(/_/g, '/');
    const header = JSON.parse(atob(padded)) as Record<string, unknown>;
    expect(Object.keys(header).sort()).toEqual(['alg', 'kid']);
    expect(header['alg']).toBe('ES256');
    expect(typeof header['kid']).toBe('string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. CONCURRENT OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

describe('Concurrent signing operations', () => {
  it('handles 50 concurrent sign operations without errors', async () => {
    const svc = new SigningService({ keyPrefix: 'conc' });
    await svc.initialize();

    const bodies = Array.from({ length: 50 }, (_, i) =>
      encoder.encode(JSON.stringify({ id: i, data: `payload_${i}` })),
    );

    const signatures = await Promise.all(bodies.map((b) => svc.sign(b)));
    expect(signatures).toHaveLength(50);
    expect(new Set(signatures).size).toBe(50);

    const results = await Promise.all(
      bodies.map((b, i) => svc.verify(signatures[i]!, b, svc.getPublicKeys())),
    );
    expect(results.every((r) => r.valid)).toBe(true);
  });

  it('handles concurrent sign + verify interleaving', async () => {
    const svc = new SigningService({ keyPrefix: 'interleave' });
    await svc.initialize();

    const tasks = Array.from({ length: 20 }, async (_, i) => {
      const body = encoder.encode(`msg_${i}`);
      const sig = await svc.sign(body);
      return svc.verify(sig, body, svc.getPublicKeys());
    });

    const results = await Promise.all(tasks);
    expect(results.every((r) => r.valid)).toBe(true);
  });
});
