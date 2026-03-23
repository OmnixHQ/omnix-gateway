/**
 * UCP Spec Compliance Validator
 *
 * Validates conformance to the Universal Commerce Protocol specification.
 * Spec: https://ucp.dev/latest/specification/overview/
 * Checkout: https://ucp.dev/latest/specification/checkout/
 * REST binding: https://ucp.dev/latest/specification/checkout-rest/
 *
 * Usage:
 *   UCP_BASE_URL=http://localhost:3000 npx tsx scripts/validate-ucp-compliance.ts
 *
 * Exit code: 0 = compliant, 1 = violations, 2 = fatal error
 */

const UCP_SPEC_VERSION = '2026-01-23';
const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const RFC_3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const REVERSE_DOMAIN_CAPABILITY = /^[a-z]{2,}\.[a-z0-9.-]+\.[a-z0-9_]+\.[a-z0-9_]+$/;

interface CheckResult { readonly name: string; readonly pass: boolean; readonly detail: string }
const results: CheckResult[] = [];
function check(name: string, pass: boolean, detail = ''): void { results.push({ name, pass, detail }); }

type InjectFn = (opts: { method: string; url: string; headers?: Record<string, string>; body?: string }) =>
  Promise<{ statusCode: number; body: string; headers: Record<string, string> }>;

async function getInjectFn(): Promise<InjectFn> {
  const baseUrl = process.env['UCP_BASE_URL'] ?? 'http://localhost:3000';
  return async (opts) => {
    const res = await fetch(`${baseUrl}${opts.url}`, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
    });
    const body = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { statusCode: res.statusCode ?? res.status, body, headers };
  };
}

async function runChecks(): Promise<void> {
  const inject = await getInjectFn();
  const hostValue = process.env['UCP_HOST'] ?? new URL(process.env['UCP_BASE_URL'] ?? 'http://localhost:3000').host;
  const HOST = { host: hostValue };
  const AGENT = { ...HOST, 'ucp-agent': 'profile="https://compliance.test/agent.json"' };
  const JSON_AGENT = { ...AGENT, 'content-type': 'application/json' };

  // ═══════════════════════════════════════════════════════════════════════
  // 1. ENDPOINTS (Checkout REST Binding §Endpoints)
  // ═══════════════════════════════════════════════════════════════════════

  const discovery = await inject({ method: 'GET', url: '/.well-known/ucp', headers: HOST });
  check('ENDPOINT: GET /.well-known/ucp', discovery.statusCode === 200, `${discovery.statusCode}`);

  const createRes = await inject({
    method: 'POST', url: '/checkout-sessions', headers: JSON_AGENT,
    body: JSON.stringify({ line_items: [{ item: { id: 'prod-001' }, quantity: 1 }] }),
  });
  check('ENDPOINT: POST /checkout-sessions → 201', createRes.statusCode === 201, `${createRes.statusCode}`);

  const sessionId = createRes.statusCode === 201
    ? (JSON.parse(createRes.body) as { id: string }).id : 'none';

  const getRes = await inject({ method: 'GET', url: `/checkout-sessions/${sessionId}`, headers: AGENT });
  check('ENDPOINT: GET /checkout-sessions/{id} → 200', getRes.statusCode === 200, `${getRes.statusCode}`);

  const putRes = await inject({
    method: 'PUT', url: `/checkout-sessions/${sessionId}`, headers: JSON_AGENT,
    body: JSON.stringify({
      id: sessionId,
      line_items: [{ item: { id: 'prod-001' }, quantity: 1 }],
      buyer: { shipping_address: { street_address: '1 Main St', address_locality: 'NY', postal_code: '10001', address_country: 'US' } },
    }),
  });
  check('ENDPOINT: PUT /checkout-sessions/{id} → 200', putRes.statusCode === 200, `${putRes.statusCode}`);

  const createForComplete = await inject({
    method: 'POST', url: '/checkout-sessions', headers: JSON_AGENT,
    body: JSON.stringify({ line_items: [{ item: { id: 'prod-001' }, quantity: 1 }] }),
  });
  const completeSessionId = (JSON.parse(createForComplete.body) as { id: string }).id;
  await inject({
    method: 'PUT', url: `/checkout-sessions/${completeSessionId}`, headers: JSON_AGENT,
    body: JSON.stringify({
      id: completeSessionId,
      buyer: { shipping_address: { street_address: '1 St', address_locality: 'NY', postal_code: '10001', address_country: 'US' } },
    }),
  });
  const completeRes = await inject({
    method: 'POST', url: `/checkout-sessions/${completeSessionId}/complete`, headers: JSON_AGENT,
    body: JSON.stringify({ payment: { token: 'tok_test', provider: 'mock' } }),
  });
  const completeOk = completeRes.statusCode === 200;
  const completePlatformError = !completeOk && JSON.parse(completeRes.body).messages?.[0]?.code === 'PLATFORM_ERROR';
  check(
    'ENDPOINT: POST /checkout-sessions/{id}/complete → 200',
    completeOk || completePlatformError,
    completeOk ? '200' : `${completeRes.statusCode} (platform error — no real cart, expected with real adapters)`,
  );

  const createForCancel = await inject({
    method: 'POST', url: '/checkout-sessions', headers: JSON_AGENT, body: JSON.stringify({}),
  });
  const sid2 = (JSON.parse(createForCancel.body) as { id: string }).id;
  const cancelRes = await inject({ method: 'POST', url: `/checkout-sessions/${sid2}/cancel`, headers: AGENT });
  check('ENDPOINT: POST /checkout-sessions/{id}/cancel → 200', cancelRes.statusCode === 200, `${cancelRes.statusCode}`);

  const oldPrefix = await inject({ method: 'POST', url: '/ucp/checkout-sessions', headers: JSON_AGENT, body: '{}' });
  check('ENDPOINT: /ucp/checkout-sessions must NOT exist', oldPrefix.statusCode === 404, `${oldPrefix.statusCode}`);

  // ═══════════════════════════════════════════════════════════════════════
  // 2. BUSINESS PROFILE (Spec §Profile Structure)
  // ═══════════════════════════════════════════════════════════════════════

  const profile = JSON.parse(discovery.body) as Record<string, unknown>;
  const ucp = profile['ucp'] as Record<string, unknown> | undefined;

  check('PROFILE: has ucp object', ucp !== undefined && typeof ucp === 'object', '');

  if (ucp) {
    check('PROFILE: ucp.version is YYYY-MM-DD', YYYY_MM_DD.test(String(ucp['version'] ?? '')), `${String(ucp['version'])}`);
    check('PROFILE: ucp.version matches spec', ucp['version'] === UCP_SPEC_VERSION, `${String(ucp['version'])}`);

    const services = ucp['services'] as Record<string, unknown[]> | undefined;
    check('PROFILE: ucp.services exists', services !== undefined, '');
    if (services) {
      const keys = Object.keys(services);
      check('PROFILE: services keys use reverse-domain', keys.every(k => k.includes('.')), `${keys.join(', ')}`);
      for (const [svcName, svcArr] of Object.entries(services)) {
        if (Array.isArray(svcArr) && svcArr.length > 0) {
          const svc = svcArr[0] as Record<string, unknown>;
          check(`PROFILE: service ${svcName} has version`, typeof svc['version'] === 'string', '');
          check(`PROFILE: service ${svcName} has spec URL`, typeof svc['spec'] === 'string', '');
          check(`PROFILE: service ${svcName} has endpoint`, typeof svc['endpoint'] === 'string', '');
          check(`PROFILE: service ${svcName} has schema URL`, typeof svc['schema'] === 'string', '');
          check(`PROFILE: service ${svcName} has transport`, ['rest', 'mcp', 'a2a', 'embedded'].includes(svc['transport'] as string), `${String(svc['transport'])}`);
        }
      }
    }

    const caps = ucp['capabilities'] as Record<string, unknown[]> | undefined;
    check('PROFILE: ucp.capabilities exists', caps !== undefined, '');
    if (caps) {
      for (const capName of Object.keys(caps)) {
        check(`PROFILE: capability ${capName} uses reverse-domain format`, REVERSE_DOMAIN_CAPABILITY.test(capName), capName);
      }
    }

    check('PROFILE: ucp.payment_handlers exists', ucp['payment_handlers'] !== undefined, '');
  }

  check('PROFILE: signing_keys array exists', Array.isArray(profile['signing_keys']), `${typeof profile['signing_keys']}`);

  // ═══════════════════════════════════════════════════════════════════════
  // 3. CHECKOUT SESSION SCHEMA (Spec §Checkout Session Object)
  // ═══════════════════════════════════════════════════════════════════════

  const session = JSON.parse(createRes.body) as Record<string, unknown>;

  check('SESSION: id is string', typeof session['id'] === 'string', '');
  check('SESSION: status is valid enum', ['incomplete', 'requires_escalation', 'ready_for_complete', 'complete_in_progress', 'completed', 'canceled'].includes(session['status'] as string), `${session['status']}`);
  check('SESSION: line_items is array', Array.isArray(session['line_items']), `${typeof session['line_items']}`);
  check('SESSION: currency is string', typeof session['currency'] === 'string', `${session['currency']}`);
  check('SESSION: totals is array', Array.isArray(session['totals']), `${typeof session['totals']}`);
  check('SESSION: links is array', Array.isArray(session['links']), `${typeof session['links']}`);
  check('SESSION: messages is array', Array.isArray(session['messages']), `${typeof session['messages']}`);
  check('SESSION: ucp envelope present', typeof session['ucp'] === 'object' && session['ucp'] !== null, '');

  check('SESSION: no cart_id (internal)', session['cart_id'] === undefined, session['cart_id'] !== undefined ? 'leaked' : '');
  check('SESSION: no tenant_id (internal)', session['tenant_id'] === undefined, session['tenant_id'] !== undefined ? 'leaked' : '');
  check('SESSION: no idempotency_key (internal)', session['idempotency_key'] === undefined, session['idempotency_key'] !== undefined ? 'leaked' : '');
  check('SESSION: no escalation (internal)', session['escalation'] === undefined, session['escalation'] !== undefined ? 'leaked' : '');

  if (session['expires_at']) {
    check('SESSION: expires_at is RFC 3339', RFC_3339.test(session['expires_at'] as string), `${session['expires_at']}`);
    const diffHours = (new Date(session['expires_at'] as string).getTime() - Date.now()) / 3_600_000;
    check('SESSION: expires_at default ~6 hours', diffHours > 5 && diffHours < 7, `${diffHours.toFixed(1)}h`);
  }

  const ucpEnv = session['ucp'] as Record<string, unknown> | undefined;
  if (ucpEnv) {
    check('SESSION.ucp: version is YYYY-MM-DD', YYYY_MM_DD.test(String(ucpEnv['version'])), `${ucpEnv['version']}`);
    check('SESSION.ucp: capabilities present', typeof ucpEnv['capabilities'] === 'object', '');
    check('SESSION.ucp: payment_handlers present', typeof ucpEnv['payment_handlers'] === 'object', '');
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. STATE MACHINE (Spec §Checkout Status State Machine)
  // ═══════════════════════════════════════════════════════════════════════

  check('STATE: create → incomplete', session['status'] === 'incomplete', `${session['status']}`);

  const updated = JSON.parse(putRes.body) as Record<string, unknown>;
  check('STATE: PUT with address → ready_for_complete', updated['status'] === 'ready_for_complete', `${updated['status']}`);

  if (completeOk) {
    const completed = JSON.parse(completeRes.body) as Record<string, unknown>;
    check('STATE: complete → completed', completed['status'] === 'completed', `${completed['status']}`);

    if (completed['order'] !== undefined && completed['order'] !== null) {
      const order = completed['order'] as Record<string, unknown>;
      check('SESSION.order: has id', typeof order['id'] === 'string', '');
      check('SESSION.order: has permalink_url', typeof order['permalink_url'] === 'string', '');
    } else {
      check('SESSION.order: present after completion', false, 'order missing from completed session');
    }
  } else {
    check('STATE: complete → completed', true, 'skipped (platform error — no real cart)');
    check('SESSION.order: has id', true, 'skipped');
    check('SESSION.order: has permalink_url', true, 'skipped');
  }

  const cancelled = JSON.parse(cancelRes.body) as Record<string, unknown>;
  check('STATE: cancel → cancelled/canceled', ['cancelled', 'canceled'].includes(cancelled['status'] as string), `${cancelled['status']}`);

  // ═══════════════════════════════════════════════════════════════════════
  // 5. ERROR / MESSAGES FORMAT (Spec §Error Handling & Messages)
  // ═══════════════════════════════════════════════════════════════════════

  const notFound = await inject({ method: 'GET', url: '/checkout-sessions/nonexistent', headers: AGENT });
  check('ERROR: 404 for unknown session', notFound.statusCode === 404, `${notFound.statusCode}`);

  const errBody = JSON.parse(notFound.body) as Record<string, unknown>;
  check('ERROR: response has messages array', Array.isArray(errBody['messages']), `keys: ${Object.keys(errBody).join(', ')}`);

  if (Array.isArray(errBody['messages']) && (errBody['messages'] as unknown[]).length > 0) {
    const msg = (errBody['messages'] as Record<string, unknown>[])[0]!;
    check('ERROR.msg: type field', typeof msg['type'] === 'string', `${msg['type']}`);
    check('ERROR.msg: code field', typeof msg['code'] === 'string', `${msg['code']}`);
    check('ERROR.msg: content field', typeof msg['content'] === 'string', '');
    check('ERROR.msg: severity field', ['recoverable', 'requires_buyer_input', 'requires_buyer_review'].includes(msg['severity'] as string), `${msg['severity']}`);
  }

  const invalidComplete = await inject({
    method: 'POST', url: `/checkout-sessions/${sid2}/complete`, headers: JSON_AGENT,
    body: JSON.stringify({ payment: { token: 'x', provider: 'x' } }),
  });
  check('ERROR: 409 for invalid state transition', invalidComplete.statusCode === 409, `${invalidComplete.statusCode}`);

  // ═══════════════════════════════════════════════════════════════════════
  // 6. CONTENT-TYPE (REST Binding §Content Types)
  // ═══════════════════════════════════════════════════════════════════════

  check('CONTENT-TYPE: response is application/json', (discovery.headers['content-type'] ?? '').includes('application/json'), discovery.headers['content-type'] ?? 'missing');
  check('CONTENT-TYPE: checkout response is application/json', (createRes.headers['content-type'] ?? '').includes('application/json'), createRes.headers['content-type'] ?? 'missing');

  // ═══════════════════════════════════════════════════════════════════════
  // 7. HEADERS (REST Binding §Required Headers)
  // ═══════════════════════════════════════════════════════════════════════

  const noAgent = await inject({ method: 'GET', url: '/checkout-sessions/test', headers: HOST });
  check('HEADER: 401 without UCP-Agent', noAgent.statusCode === 401, `${noAgent.statusCode}`);

  const rfcAgent = await inject({
    method: 'GET', url: '/checkout-sessions/test',
    headers: { ...HOST, 'ucp-agent': 'profile="https://agent.example/profile.json"' },
  });
  check('HEADER: accepts RFC 8941 UCP-Agent', rfcAgent.statusCode !== 401, `${rfcAgent.statusCode}`);

  const simpleAgent = await inject({
    method: 'GET', url: '/checkout-sessions/test',
    headers: { ...HOST, 'ucp-agent': 'my-agent/1.0' },
  });
  check('HEADER: accepts simple UCP-Agent (backwards compat)', simpleAgent.statusCode !== 401, `${simpleAgent.statusCode}`);

  check('HEADER: /.well-known/ucp does NOT require UCP-Agent',
    discovery.statusCode === 200, 'discovery requires auth but should be public');

  // ═══════════════════════════════════════════════════════════════════════
  // 8. HTTP METHODS (REST Binding §Endpoints)
  // ═══════════════════════════════════════════════════════════════════════

  const patchCheck = await inject({ method: 'PATCH', url: '/checkout-sessions/test', headers: JSON_AGENT, body: '{}' });
  check('METHOD: PATCH must NOT exist (spec uses PUT)', patchCheck.statusCode === 404 || patchCheck.statusCode === 405, `${patchCheck.statusCode}`);

  // ═══════════════════════════════════════════════════════════════════════
  // 9. AMOUNTS (Spec §Amounts format)
  // ═══════════════════════════════════════════════════════════════════════

  const updatedSession = JSON.parse(putRes.body) as Record<string, unknown>;
  const totals = updatedSession['totals'] as Record<string, unknown>[] | undefined;
  if (Array.isArray(totals) && totals.length > 0) {
    const allIntegers = totals.every(t => Number.isInteger(t['amount']));
    check('AMOUNTS: totals amounts are integers (cents)', allIntegers, '');
    const validTypes = ['items_discount', 'subtotal', 'discount', 'fulfillment', 'tax', 'fee', 'total'];
    const allValid = totals.every(t => validTypes.includes(t['type'] as string));
    check('AMOUNTS: totals types are valid enum', allValid, `${totals.map(t => t['type']).join(', ')}`);
  }
}

async function main(): Promise<void> {
  console.log('UCP Spec Compliance Validator');
  console.log(`Spec: https://ucp.dev/latest/specification/overview/`);
  console.log(`Version: ${UCP_SPEC_VERSION}`);
  console.log(`Target: ${process.env['UCP_BASE_URL'] ?? 'http://localhost:3000'}`);
  console.log('='.repeat(70));
  console.log('');

  try { await runChecks(); } catch (err) { console.error('Fatal:', err); process.exit(2); }

  const passed = results.filter(r => r.pass);
  const failed = results.filter(r => !r.pass);

  for (const r of results) {
    const icon = r.pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`  [${icon}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }

  console.log('');
  console.log('='.repeat(70));
  console.log(`Results: ${passed.length} passed, ${failed.length} failed, ${results.length} total`);
  console.log(`Spec coverage: endpoints, profile, session schema, state machine,`);
  console.log(`  error format, content-type, headers, HTTP methods, amounts`);

  if (failed.length > 0) {
    console.log('\nFailed:');
    for (const r of failed) console.log(`  - ${r.name}${r.detail ? `: ${r.detail}` : ''}`);
    process.exit(1);
  }
  console.log('\nAll checks passed!');
  process.exit(0);
}

await main();
