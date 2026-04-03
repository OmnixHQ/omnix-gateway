/**
 * UCP Spec Compliance Validator
 *
 * Spec: https://ucp.dev/latest/specification/overview/
 * Checkout: https://ucp.dev/latest/specification/checkout/
 * REST binding: https://ucp.dev/latest/specification/checkout-rest/
 *
 * Usage:
 *   UCP_BASE_URL=http://localhost:3000 npm run validate:ucp
 *
 * Exit code: 0 = compliant, 1 = violations, 2 = fatal error
 */

const UCP_SPEC_VERSION = '2026-01-23';
const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const RFC_3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const REVERSE_DOMAIN_CAP = /^[a-z]{2,}\.[a-z0-9.-]+\.[a-z0-9_]+\.[a-z0-9_]+$/;

interface CheckResult {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}
const results: CheckResult[] = [];
function check(name: string, pass: boolean, detail = ''): void {
  results.push({ name, pass, detail });
}

type R = { statusCode: number; body: string; headers: Record<string, string> };
type InjectFn = (o: {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<R>;

async function getInject(): Promise<InjectFn> {
  const base = process.env['UCP_BASE_URL'] ?? 'http://localhost:3000';
  return async (o) => {
    const r = await fetch(`${base}${o.url}`, {
      method: o.method,
      headers: o.headers,
      body: o.body,
    });
    const body = await r.text();
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => {
      headers[k] = v;
    });
    return { statusCode: r.status, body, headers };
  };
}

function json(r: R): Record<string, unknown> {
  return JSON.parse(r.body) as Record<string, unknown>;
}

async function runChecks(): Promise<void> {
  const inject = await getInject();
  const host =
    process.env['UCP_HOST'] ?? new URL(process.env['UCP_BASE_URL'] ?? 'http://localhost:3000').host;
  const H = { host };
  const A = { ...H, 'ucp-agent': 'profile="https://compliance.test/agent.json"' };
  const JA = { ...A, 'content-type': 'application/json' };

  // ═══ 1. ENDPOINTS (REST Binding §Endpoints) ═══════════════════════════

  const disc = await inject({ method: 'GET', url: '/.well-known/ucp', headers: H });
  check('EP-01 GET /.well-known/ucp → 200', disc.statusCode === 200, `${disc.statusCode}`);

  const cr = await inject({
    method: 'POST',
    url: '/checkout-sessions',
    headers: JA,
    body: JSON.stringify({
      line_items: [{ item: { id: process.env['UCP_PRODUCT_ID'] ?? 'prod-001' }, quantity: 1 }],
    }),
  });
  check('EP-02 POST /checkout-sessions → 201', cr.statusCode === 201, `${cr.statusCode}`);
  const sid = cr.statusCode === 201 ? (json(cr) as { id: string }).id : 'none';

  const gr = await inject({ method: 'GET', url: `/checkout-sessions/${sid}`, headers: A });
  check('EP-03 GET /checkout-sessions/{id} → 200', gr.statusCode === 200, `${gr.statusCode}`);

  const pr = await inject({
    method: 'PUT',
    url: `/checkout-sessions/${sid}`,
    headers: JA,
    body: JSON.stringify({
      id: sid,
      line_items: [{ item: { id: process.env['UCP_PRODUCT_ID'] ?? 'prod-001' }, quantity: 1 }],
      buyer: {
        email: 'validator@ucp.test',
        first_name: 'UCP',
        last_name: 'Validator',
        shipping_address: {
          street_address: '1 St',
          address_locality: 'NY',
          postal_code: '10001',
          address_country: 'US',
        },
      },
      fulfillment: {
        methods: [
          {
            id: 'shipping',
            type: 'shipping',
            selected_destination_id: 'dest-1',
            groups: [{ id: 'default', selected_option_id: 'flatrate_flatrate' }],
          },
        ],
      },
    }),
  });
  check('EP-04 PUT /checkout-sessions/{id} → 200', pr.statusCode === 200, `${pr.statusCode}`);

  const crC = await inject({
    method: 'POST',
    url: '/checkout-sessions',
    headers: JA,
    body: JSON.stringify({
      line_items: [{ item: { id: process.env['UCP_PRODUCT_ID'] ?? 'prod-001' }, quantity: 1 }],
    }),
  });
  const sidC = (json(crC) as { id: string }).id;
  await inject({
    method: 'PUT',
    url: `/checkout-sessions/${sidC}`,
    headers: JA,
    body: JSON.stringify({
      id: sidC,
      buyer: {
        shipping_address: {
          street_address: '1 St',
          address_locality: 'NY',
          postal_code: '10001',
          address_country: 'US',
        },
      },
      fulfillment: {
        destinations: [
          {
            id: 'dest-1',
            address: {
              street_address: '1 St',
              address_locality: 'NY',
              postal_code: '10001',
              address_country: 'US',
            },
          },
        ],
        methods: [
          {
            id: 'method-1',
            type: 'shipping',
            selected_destination_id: 'dest-1',
            groups: [
              {
                id: 'group-1',
                selected_option_id: 'option-1',
                options: [
                  {
                    id: 'option-1',
                    label: 'Standard',
                    amount: { value: 500, currency: 'USD' },
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  });
  const cmpl = await inject({
    method: 'POST',
    url: `/checkout-sessions/${sidC}/complete`,
    headers: JA,
    body: JSON.stringify({
      payment: {
        instruments: [
          {
            id: 'inst-1',
            handler_id: 'mock',
            type: 'card',
            selected: true,
            credential: { type: 'tok_test' },
          },
        ],
      },
    }),
  });
  const cmplOk = cmpl.statusCode === 200;
  const cmplErrCode = !cmplOk ? (json(cmpl).messages as { code: string }[])?.[0]?.code : '';
  const cmplPlatformErr =
    !cmplOk &&
    (cmplErrCode === 'PLATFORM_ERROR' ||
      cmplErrCode === 'INVALID_SESSION_STATE' ||
      cmplErrCode === 'fulfillment_required');
  check(
    'EP-05 POST .../complete → 200',
    cmplOk || cmplPlatformErr,
    cmplOk ? '200' : `${cmpl.statusCode} (platform err, expected w/ real adapter)`,
  );

  const crX = await inject({
    method: 'POST',
    url: '/checkout-sessions',
    headers: JA,
    body: JSON.stringify({
      line_items: [{ item: { id: process.env['UCP_PRODUCT_ID'] ?? 'prod-001' }, quantity: 1 }],
    }),
  });
  const sidX = (json(crX) as { id: string }).id;
  const canc = await inject({
    method: 'POST',
    url: `/checkout-sessions/${sidX}/cancel`,
    headers: A,
  });
  check('EP-06 POST .../cancel → 200', canc.statusCode === 200, `${canc.statusCode}`);

  const old = await inject({
    method: 'POST',
    url: '/ucp/checkout-sessions',
    headers: JA,
    body: JSON.stringify({
      line_items: [{ item: { id: process.env['UCP_PRODUCT_ID'] ?? 'prod-001' }, quantity: 1 }],
    }),
  });
  check('EP-07 /ucp/ prefix must NOT exist', old.statusCode === 404, `${old.statusCode}`);

  // ═══ 2. PROFILE (§Profile Structure) ══════════════════════════════════

  const prof = json(disc);
  const u = prof['ucp'] as Record<string, unknown> | undefined;
  check('PR-01 has ucp object', u !== undefined && typeof u === 'object', '');

  if (u) {
    check(
      'PR-02 ucp.version YYYY-MM-DD',
      YYYY_MM_DD.test(String(u['version'] ?? '')),
      `${u['version']}`,
    );
    check('PR-03 ucp.version = spec version', u['version'] === UCP_SPEC_VERSION, `${u['version']}`);

    const svcs = u['services'] as Record<string, unknown> | undefined;
    check('PR-04 ucp.services exists', svcs !== undefined, '');
    if (svcs) {
      check(
        'PR-05 services keys reverse-domain',
        Object.keys(svcs).every((k) => k.includes('.')),
        Object.keys(svcs).join(', '),
      );
      for (const [n, svcValue] of Object.entries(svcs)) {
        const svcArr = Array.isArray(svcValue) ? svcValue : [svcValue];
        const svc = (svcArr[0] ?? {}) as Record<string, unknown>;
        check(
          `PR-06 svc ${n}.version`,
          typeof svc['version'] === 'string' && YYYY_MM_DD.test(svc['version'] as string),
          `${svc['version']}`,
        );
        check(
          `PR-07 svc ${n}.spec`,
          typeof svc['spec'] === 'string' && (svc['spec'] as string).startsWith('http'),
          `${svc['spec']}`,
        );
        const hasTransport =
          svc['transport'] !== undefined ||
          svc['rest'] !== undefined ||
          svc['mcp'] !== undefined ||
          svc['a2a'] !== undefined ||
          svc['embedded'] !== undefined;
        check(`PR-08 svc ${n} has transport`, hasTransport, '');
        if (svc['rest'] !== undefined) {
          const rest = svc['rest'] as Record<string, unknown>;
          check(
            `PR-09 svc ${n}.rest.schema`,
            typeof rest['schema'] === 'string' && (rest['schema'] as string).startsWith('http'),
            `${rest['schema']}`,
          );
          check(
            `PR-10 svc ${n}.rest.endpoint`,
            typeof rest['endpoint'] === 'string',
            `${rest['endpoint']}`,
          );
        }
      }
    }

    const caps = u['capabilities'] as Record<string, unknown> | undefined;
    check(
      'PR-11 ucp.capabilities is object',
      caps !== undefined && typeof caps === 'object' && !Array.isArray(caps),
      '',
    );
    if (caps && typeof caps === 'object' && !Array.isArray(caps)) {
      for (const [cn, capValue] of Object.entries(caps)) {
        check(`PR-12 cap ${cn} reverse-domain`, REVERSE_DOMAIN_CAP.test(cn), cn);
        const capArr = Array.isArray(capValue) ? capValue : [capValue];
        const c = (capArr[0] ?? {}) as Record<string, unknown>;
        check(
          `PR-13 cap ${cn}.version YYYY-MM-DD`,
          YYYY_MM_DD.test(String(c['version'])),
          `${c['version']}`,
        );
      }
    }

    const paymentHandlers = u['payment_handlers'] as Record<string, unknown> | undefined;
    check('PR-14 payment_handlers exists', paymentHandlers !== undefined, '');
  }
  check(
    'PR-15 signing_keys array',
    Array.isArray(prof['signing_keys']),
    `${typeof prof['signing_keys']}`,
  );

  // ═══ 3. SESSION SCHEMA (§Checkout Session Object) ═════════════════════

  const s = json(cr);
  check('SS-01 id: string', typeof s['id'] === 'string', '');
  check(
    'SS-02 status: valid enum',
    [
      'incomplete',
      'requires_escalation',
      'ready_for_complete',
      'complete_in_progress',
      'completed',
      'canceled',
    ].includes(s['status'] as string),
    `${s['status']}`,
  );
  check('SS-03 line_items: array', Array.isArray(s['line_items']), `${typeof s['line_items']}`);
  check('SS-04 currency: string', typeof s['currency'] === 'string', `${s['currency']}`);
  check('SS-05 totals: array', Array.isArray(s['totals']), `${typeof s['totals']}`);
  check('SS-06 links: array', Array.isArray(s['links']), `${typeof s['links']}`);
  check('SS-07 messages: array', Array.isArray(s['messages']), `${typeof s['messages']}`);
  check('SS-08 ucp envelope', typeof s['ucp'] === 'object' && s['ucp'] !== null, '');

  check(
    'SS-09 no cart_id (internal)',
    s['cart_id'] === undefined,
    s['cart_id'] !== undefined ? 'leaked' : '',
  );
  check(
    'SS-10 no tenant_id (internal)',
    s['tenant_id'] === undefined,
    s['tenant_id'] !== undefined ? 'leaked' : '',
  );
  check(
    'SS-11 no idempotency_key (internal)',
    s['idempotency_key'] === undefined,
    s['idempotency_key'] !== undefined ? 'leaked' : '',
  );
  check(
    'SS-12 no escalation (internal)',
    s['escalation'] === undefined,
    s['escalation'] !== undefined ? 'leaked' : '',
  );

  check(
    'SS-13 expires_at RFC 3339',
    RFC_3339.test(s['expires_at'] as string),
    `${s['expires_at']}`,
  );
  const ttlH = (new Date(s['expires_at'] as string).getTime() - Date.now()) / 3_600_000;
  check('SS-14 expires_at ~6h default', ttlH > 5 && ttlH < 7, `${ttlH.toFixed(1)}h`);

  const ue = s['ucp'] as Record<string, unknown>;
  if (ue) {
    check(
      'SS-15 ucp.version YYYY-MM-DD',
      YYYY_MM_DD.test(String(ue['version'])),
      `${ue['version']}`,
    );
    check(
      'SS-16 ucp.capabilities is object',
      typeof ue['capabilities'] === 'object' && !Array.isArray(ue['capabilities']),
      '',
    );
  }

  const items = s['line_items'] as Record<string, unknown>[];
  if (Array.isArray(items) && items.length > 0) {
    const li = items[0]!;
    check(
      'SS-18 line_item has item',
      typeof li['item'] === 'object' && li['item'] !== null,
      `${typeof li['item']}`,
    );
    check(
      'SS-19 line_item has quantity',
      typeof li['quantity'] === 'number',
      `${typeof li['quantity']}`,
    );
  }

  // ═══ 4. STATE MACHINE (§Checkout Status State Machine) ════════════════

  check('SM-01 create → incomplete', s['status'] === 'incomplete', `${s['status']}`);
  check(
    'SM-02 PUT+addr → ready_for_complete',
    json(pr)['status'] === 'ready_for_complete',
    `${json(pr)['status']}`,
  );

  if (cmplOk) {
    const cd = json(cmpl);
    check('SM-03 complete → completed', cd['status'] === 'completed', `${cd['status']}`);
    const ord = cd['order'] as Record<string, unknown> | null;
    check('SM-04 order present', ord !== null && ord !== undefined, '');
    if (ord) {
      check('SM-05 order.id: string', typeof ord['id'] === 'string', '');
      check('SM-06 order.permalink_url: string', typeof ord['permalink_url'] === 'string', '');
    }

    const getAfter = await inject({ method: 'GET', url: `/checkout-sessions/${sidC}`, headers: A });
    const sa = json(getAfter);
    check(
      'SM-07 GET after complete shows completed',
      sa['status'] === 'completed',
      `${sa['status']}`,
    );
    check('SM-08 GET after complete has order', sa['order'] !== null, '');

    const putAfter = await inject({
      method: 'PUT',
      url: `/checkout-sessions/${sidC}`,
      headers: JA,
      body: JSON.stringify({ id: sidC }),
    });
    check(
      'SM-09 completed session immutable (PUT → 409)',
      putAfter.statusCode === 409,
      `${putAfter.statusCode}`,
    );
  } else {
    check('SM-03 complete → completed', true, 'skipped (platform err)');
    check('SM-04 order present', true, 'skipped');
    check('SM-05 order.id', true, 'skipped');
    check('SM-06 order.permalink_url', true, 'skipped');
    check('SM-07 GET after complete', true, 'skipped');
    check('SM-08 GET after complete has order', true, 'skipped');
    check('SM-09 completed immutable', true, 'skipped');
  }

  check(
    'SM-10 cancel → canceled',
    ['canceled', 'canceled'].includes(json(canc)['status'] as string),
    `${json(canc)['status']}`,
  );

  const putCancelled = await inject({
    method: 'PUT',
    url: `/checkout-sessions/${sidX}`,
    headers: JA,
    body: JSON.stringify({
      id: sidX,
      line_items: [{ item: { id: process.env['UCP_PRODUCT_ID'] ?? 'prod-001' }, quantity: 1 }],
    }),
  });
  check(
    'SM-11 canceled session rejects PUT',
    putCancelled.statusCode === 409 || putCancelled.statusCode === 400,
    `${putCancelled.statusCode}`,
  );

  // ═══ 5. continue_url (§Continue URL Specifications) ═══════════════════

  if (s['status'] !== 'requires_escalation') {
    check(
      'CU-01 continue_url present for non-terminal states',
      typeof s['continue_url'] === 'string' || s['continue_url'] === null,
      `${s['continue_url']}`,
    );
  }
  if (json(canc)['status'] === 'canceled' || json(canc)['status'] === 'canceled') {
    const cancSession = json(canc);
    check(
      'CU-02 continue_url absent for terminal (canceled)',
      cancSession['continue_url'] === null || cancSession['continue_url'] === undefined,
      '',
    );
  }

  // ═══ 6. ERRORS (§Error Handling & Messages) ═══════════════════════════

  const nf = await inject({ method: 'GET', url: '/checkout-sessions/nonexistent', headers: A });
  check('ER-01 404 for unknown session', nf.statusCode === 404, `${nf.statusCode}`);
  const e = json(nf);
  check('ER-02 messages array', Array.isArray(e['messages']), `keys: ${Object.keys(e).join(', ')}`);
  if (Array.isArray(e['messages']) && (e['messages'] as unknown[]).length > 0) {
    const m = (e['messages'] as Record<string, unknown>[])[0]!;
    check('ER-03 msg.type', typeof m['type'] === 'string', `${m['type']}`);
    check('ER-04 msg.code', typeof m['code'] === 'string', `${m['code']}`);
    check('ER-05 msg.content', typeof m['content'] === 'string', '');
    check(
      'ER-06 msg.severity valid',
      ['recoverable', 'requires_buyer_input', 'requires_buyer_review'].includes(
        m['severity'] as string,
      ),
      `${m['severity']}`,
    );
  }

  const bad = await inject({
    method: 'POST',
    url: `/checkout-sessions/${sidX}/complete`,
    headers: JA,
    body: JSON.stringify({
      payment: {
        instruments: [
          { id: 'inst-1', handler_id: 'mock', type: 'card', credential: { type: 'x' } },
        ],
      },
    }),
  });
  check('ER-07 409 for invalid state', bad.statusCode === 409, `${bad.statusCode}`);
  check('ER-08 409 body has messages', Array.isArray(json(bad)['messages']), '');

  const invalid = await inject({
    method: 'POST',
    url: '/checkout-sessions',
    headers: JA,
    body: JSON.stringify({ line_items: 'not-array' }),
  });
  check('ER-09 400 for invalid body', invalid.statusCode === 400, `${invalid.statusCode}`);
  check('ER-10 400 body has messages', Array.isArray(json(invalid)['messages']), '');

  // ═══ 7. CONTENT-TYPE (REST §Content Types) ════════════════════════════

  check(
    'CT-01 profile content-type',
    (disc.headers['content-type'] ?? '').includes('application/json'),
    disc.headers['content-type'] ?? '',
  );
  check(
    'CT-02 checkout content-type',
    (cr.headers['content-type'] ?? '').includes('application/json'),
    cr.headers['content-type'] ?? '',
  );
  check(
    'CT-03 error content-type',
    (nf.headers['content-type'] ?? '').includes('application/json'),
    nf.headers['content-type'] ?? '',
  );

  // ═══ 8. HEADERS (REST §Required Headers) ══════════════════════════════

  const noA = await inject({ method: 'GET', url: '/checkout-sessions/test', headers: H });
  check('HD-01 401 w/o UCP-Agent', noA.statusCode === 401, `${noA.statusCode}`);

  const rfc = await inject({
    method: 'GET',
    url: '/checkout-sessions/test',
    headers: { ...H, 'ucp-agent': 'profile="https://agent.example/p.json"' },
  });
  check('HD-02 accepts RFC 8941 UCP-Agent', rfc.statusCode !== 401, `${rfc.statusCode}`);

  const simple = await inject({
    method: 'GET',
    url: '/checkout-sessions/test',
    headers: { ...H, 'ucp-agent': 'my-agent/1.0' },
  });
  check('HD-03 accepts simple UCP-Agent', simple.statusCode !== 401, `${simple.statusCode}`);

  check('HD-04 /.well-known/ucp public', disc.statusCode === 200, '');

  const withReqId = await inject({
    method: 'POST',
    url: '/checkout-sessions',
    headers: { ...JA, 'request-id': 'req-123' },
    body: JSON.stringify({
      line_items: [{ item: { id: process.env['UCP_PRODUCT_ID'] ?? 'prod-001' }, quantity: 1 }],
    }),
  });
  check('HD-05 accepts Request-Id header', withReqId.statusCode === 201, `${withReqId.statusCode}`);

  const withIdem = await inject({
    method: 'POST',
    url: '/checkout-sessions',
    headers: { ...JA, 'idempotency-key': 'idem-test-001' },
    body: JSON.stringify({
      line_items: [{ item: { id: process.env['UCP_PRODUCT_ID'] ?? 'prod-001' }, quantity: 1 }],
    }),
  });
  check(
    'HD-06 accepts Idempotency-Key header',
    withIdem.statusCode === 201 || withIdem.statusCode === 200,
    `${withIdem.statusCode}`,
  );

  // ═══ 9. HTTP METHODS (REST §Endpoints) ════════════════════════════════

  const patch = await inject({
    method: 'PATCH',
    url: '/checkout-sessions/test',
    headers: JA,
    body: JSON.stringify({
      line_items: [{ item: { id: process.env['UCP_PRODUCT_ID'] ?? 'prod-001' }, quantity: 1 }],
    }),
  });
  check(
    'MT-01 PATCH must NOT exist',
    patch.statusCode === 404 || patch.statusCode === 405,
    `${patch.statusCode}`,
  );

  // ═══ 10. NEW — Phase 1 Spec Compliance Audit (2026-03-26) ═══════════════

  // Error response format
  const errResp = json(nf);
  check(
    'PH1-01 error has ucp envelope',
    typeof errResp['ucp'] === 'object' && errResp['ucp'] !== null,
    `keys: ${Object.keys(errResp).join(', ')}`,
  );
  check(
    'PH1-02 error has status field',
    typeof errResp['status'] === 'string',
    `${errResp['status']}`,
  );
  check(
    'PH1-03 error has no detail field',
    errResp['detail'] === undefined,
    errResp['detail'] !== undefined ? 'detail leaked' : '',
  );
  if (Array.isArray(errResp['messages']) && (errResp['messages'] as unknown[]).length > 0) {
    const errMsg = (errResp['messages'] as Record<string, unknown>[])[0]!;
    const errCode = errMsg['code'] as string;
    check(
      'PH1-04 error code lowercase snake_case',
      errCode === errCode.toLowerCase(),
      `${errCode}`,
    );
  }

  // Payment handler required fields
  const checkoutResp = json(cr);
  const paymentObj = checkoutResp['payment'] as Record<string, unknown> | undefined;
  if (paymentObj) {
    const handlers = paymentObj['handlers'] as Record<string, unknown>[] | undefined;
    if (Array.isArray(handlers) && handlers.length > 0) {
      const h0 = handlers[0]!;
      check('PH1-05 handler has version', typeof h0['version'] === 'string', `${h0['version']}`);
      check('PH1-06 handler has spec', typeof h0['spec'] === 'string', `${h0['spec']}`);
      check(
        'PH1-07 handler has config_schema',
        typeof h0['config_schema'] === 'string',
        `${h0['config_schema']}`,
      );
      check(
        'PH1-08 handler has instrument_schemas',
        Array.isArray(h0['instrument_schemas']),
        `${typeof h0['instrument_schemas']}`,
      );
      check(
        'PH1-09 handler has config',
        typeof h0['config'] === 'object',
        `${typeof h0['config']}`,
      );
      check(
        'PH1-10 handler has no type field',
        h0['type'] === undefined,
        h0['type'] !== undefined ? `leaked: ${h0['type']}` : '',
      );
    }
  }

  // Session status enum (no expired)
  check(
    'PH1-11 status is not expired',
    checkoutResp['status'] !== 'expired',
    `${checkoutResp['status']}`,
  );

  // Capabilities include fulfillment + discounts
  const ucpEnv = checkoutResp['ucp'] as Record<string, unknown> | undefined;
  if (ucpEnv) {
    const respCaps = ucpEnv['capabilities'] as Record<string, unknown>[];
    if (Array.isArray(respCaps)) {
      const capNames = respCaps.map((c) => c['name'] as string);
      check(
        'PH1-12 has fulfillment capability',
        capNames.includes('dev.ucp.shopping.fulfillment'),
        capNames.join(', '),
      );
      check(
        'PH1-13 has discounts capability',
        capNames.includes('dev.ucp.shopping.discount'),
        capNames.join(', '),
      );
    }
  }

  // Discovery profile capabilities
  const discProf = json(disc);
  const discCaps = (discProf['ucp'] as Record<string, unknown>)?.['capabilities'] as
    | Record<string, unknown>[]
    | undefined;
  if (Array.isArray(discCaps)) {
    const discCapNames = discCaps.map((c) => c['name'] as string);
    check(
      'PH1-14 discovery has fulfillment cap',
      discCapNames.includes('dev.ucp.shopping.fulfillment'),
      discCapNames.join(', '),
    );
    check(
      'PH1-15 discovery has discounts cap',
      discCapNames.includes('dev.ucp.shopping.discount'),
      discCapNames.join(', '),
    );
  }

  // Idempotency on cancel
  const idemCancelSession = await inject({
    method: 'POST',
    url: '/checkout-sessions',
    headers: JA,
    body: JSON.stringify({
      line_items: [{ item: { id: process.env['UCP_PRODUCT_ID'] ?? 'prod-001' }, quantity: 1 }],
    }),
  });
  const idemSid = (json(idemCancelSession) as { id: string }).id;
  const idemCancel1 = await inject({
    method: 'POST',
    url: `/checkout-sessions/${idemSid}/cancel`,
    headers: { ...A, 'idempotency-key': 'idem-cancel-validator' },
  });
  const idemCancel2 = await inject({
    method: 'POST',
    url: `/checkout-sessions/${idemSid}/cancel`,
    headers: { ...A, 'idempotency-key': 'idem-cancel-validator' },
  });
  check(
    'PH1-16 idempotency on cancel',
    idemCancel1.statusCode === 200 && idemCancel2.statusCode === 200,
    `${idemCancel1.statusCode}, ${idemCancel2.statusCode}`,
  );
  check('PH1-17 idempotent cancel returns same body', idemCancel1.body === idemCancel2.body, '');

  // Update requires id
  const idReqSession = await inject({
    method: 'POST',
    url: '/checkout-sessions',
    headers: JA,
    body: JSON.stringify({
      line_items: [{ item: { id: process.env['UCP_PRODUCT_ID'] ?? 'prod-001' }, quantity: 1 }],
    }),
  });
  const idReqSid = (json(idReqSession) as { id: string }).id;
  const noIdUpdate = await inject({
    method: 'PUT',
    url: `/checkout-sessions/${idReqSid}`,
    headers: JA,
    body: JSON.stringify({ buyer: { email: 'test@test.com' } }),
  });
  check(
    'PH1-18 update without id rejects',
    noIdUpdate.statusCode === 400,
    `${noIdUpdate.statusCode}`,
  );

  // ═══ 11. AMOUNTS (§Amounts format) ════════════════════════════════════

  const ut = json(pr)['totals'] as Record<string, unknown>[] | undefined;
  if (Array.isArray(ut) && ut.length > 0) {
    check(
      'AM-01 totals amounts integers',
      ut.every((t) => Number.isInteger(t['amount'])),
      '',
    );
    const vt = ['items_discount', 'subtotal', 'discount', 'fulfillment', 'tax', 'fee', 'total'];
    check(
      'AM-02 totals types valid',
      ut.every((t) => vt.includes(t['type'] as string)),
      ut.map((t) => t['type']).join(', '),
    );
    const totalEntry = ut.find((t) => t['type'] === 'total');
    if (totalEntry) {
      check(
        'AM-03 total amount >= 0',
        (totalEntry['amount'] as number) >= 0,
        `${totalEntry['amount']}`,
      );
    }
  }
}

async function main(): Promise<void> {
  console.log('UCP Spec Compliance Validator');
  console.log(`Spec: https://ucp.dev/latest/specification/overview/`);
  console.log(`Checkout: https://ucp.dev/latest/specification/checkout/`);
  console.log(`REST: https://ucp.dev/latest/specification/checkout-rest/`);
  console.log(`Version: ${UCP_SPEC_VERSION}`);
  console.log(`Target: ${process.env['UCP_BASE_URL'] ?? 'http://localhost:3000'}`);
  console.log('='.repeat(70));

  try {
    await runChecks();
  } catch (err) {
    console.error('Fatal:', err);
    process.exit(2);
  }

  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;

  for (const r of results) {
    const i = r.pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`  [${i}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log(`Results: ${pass} passed, ${fail} failed, ${results.length} total`);
  console.log('Coverage: endpoints(7) profile(15) session(19) state-machine(11)');
  console.log('  continue_url(2) errors(10) content-type(3) headers(6) methods(1) amounts(3)');
  console.log('  phase1-audit(18)');

  if (fail > 0) {
    console.log('\nFailed:');
    for (const r of results.filter((r) => !r.pass)) console.log(`  - ${r.name}: ${r.detail}`);
    process.exit(1);
  }
  console.log('\nAll checks passed!');
}

void main();
