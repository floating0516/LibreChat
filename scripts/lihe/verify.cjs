const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const api = require('/app/packages/api/dist/index.cjs');

const config = {
  apiBaseUrl: new URL('https://api.lihe.invalid/'),
  authorizationUrl: new URL('https://api.lihe.invalid/oauth/authorize'),
  selectionUrl: new URL('https://api.lihe.invalid/integrations/lihe'),
  tokenUrl: new URL('https://api.lihe.invalid/oauth/token'),
  revokeUrl: new URL('https://api.lihe.invalid/oauth/revoke'),
  modelsUrl: new URL('https://api.lihe.invalid/v1/models'),
  callbackUrl: new URL('https://lihe.invalid/api/integrations/lihe/callback'),
  clientId: 'lihe-chat',
  clientSecret: 'synthetic-client-secret',
  stateSecret: 'synthetic-state-secret',
  scope: 'models:read chat:write',
  providers: ['openAI', 'anthropic'],
  requireOpenIdSubject: false,
  cookiePath: '/api/integrations/lihe',
  resultPath: '/connect/lihe',
};

const integrationToken = 'lhc_synthetic_token_1234567890';
const requests = [];

const fetcher = async (input, init) => {
  const url = input.toString();
  requests.push({ url, init });
  if (url.endsWith('/oauth/token')) {
    return new Response(
      JSON.stringify({
        access_token: integrationToken,
        token_type: 'Bearer',
        scope: 'models:read chat:write',
        providers: ['openAI', 'anthropic'],
        expires_in: null,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (url.endsWith('/v1/models')) {
    return new Response(JSON.stringify({ data: [{ id: 'synthetic-model' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.endsWith('/oauth/revoke')) {
    return new Response(null, { status: 200 });
  }
  throw new Error('Unexpected synthetic request');
};

const keys = new Map([
  [
    'openAI',
    { value: JSON.stringify({ apiKey: 'previous-openai', baseURL: '' }), expiresAt: null },
  ],
  ['anthropic', { value: 'previous-anthropic', expiresAt: null }],
]);

const keyDeps = {
  getUserKey: async ({ name }) => {
    const key = keys.get(name);
    if (!key) {
      throw new Error('Missing synthetic key');
    }
    return key.value;
  },
  getUserKeyExpiry: async ({ name }) => {
    const key = keys.get(name);
    return { expiresAt: key ? (key.expiresAt ?? 'never') : null };
  },
  updateUserKey: async ({ name, value, expiresAt }) => {
    keys.set(name, { value, expiresAt: expiresAt ?? null });
    return null;
  },
  deleteUserKey: async ({ name }) => keys.delete(name),
};

function assertClientBundleContains(expected) {
  const assetsPath = '/app/client/dist/assets';
  const pending = new Set(expected);
  for (const file of fs.readdirSync(assetsPath)) {
    if (!file.endsWith('.js')) {
      continue;
    }
    const source = fs.readFileSync(path.join(assetsPath, file), 'utf8');
    for (const value of pending) {
      if (source.includes(value)) {
        pending.delete(value);
      }
    }
    if (pending.size === 0) {
      return;
    }
  }
  assert.fail(`Client bundle is missing Lihe markers: ${[...pending].join(', ')}`);
}

async function verify() {
  assertClientBundleContains([
    '/connect/lihe',
    '/connect/lihe-account',
    '/api/integrations/lihe',
    '/api/auth/openid/link',
    'api_key_id',
  ]);

  const provider = await import('/app/packages/data-provider/dist/index.mjs');
  assert.equal(provider.liheStartRequestSchema.safeParse({ apiKeyId: '90' }).success, true);
  assert.equal(provider.liheStartRequestSchema.safeParse({}).success, false);
  assert.equal(provider.liheStartRequestSchema.safeParse({ apiKeyId: '01' }).success, false);
  assert.equal(provider.MutationKeys.openIdLinkStart, 'openIdLinkStart');

  Object.assign(process.env, {
    LIHE_CONNECT_ENABLED: 'true',
    LIHE_CONNECT_API_BASE_URL: 'https://api.lihe.invalid',
    LIHE_CONNECT_CLIENT_ID: 'lihe-chat',
    LIHE_CONNECT_CLIENT_SECRET: 'synthetic-client-secret',
    LIHE_CONNECT_PROVIDERS: 'openAI,anthropic',
    JWT_SECRET: 'synthetic-jwt-secret',
    DOMAIN_SERVER: 'https://lihe.invalid',
    SESSION_COOKIE_SECURE: 'false',
  });
  Object.assign(process.env, {
    ALLOW_SOCIAL_LOGIN: 'false',
    OPENID_HIDDEN_TEST_MODE: 'true',
    OPENID_HIDDEN_TEST_ALLOWED_EMAILS: 'allowed@example.invalid',
    OPENID_CLIENT_ID: 'lihe-chat-login',
    OPENID_CLIENT_SECRET: 'synthetic-openid-client-secret',
    OPENID_ISSUER: 'https://api.lihe.invalid',
    OPENID_SCOPE: 'openid profile email',
    OPENID_SESSION_SECRET: 'synthetic-openid-session-secret',
    OPENID_USE_PKCE: 'true',
  });
  assert.equal(api.isOpenIdLoginRuntimeEnabled(), true);
  assert.equal(
    api.isOpenIdHiddenTestUserAllowed({
      email: 'ALLOWED@example.invalid',
      emailVerified: true,
    }),
    true,
  );
  assert.equal(
    api.shouldRequireLiheOpenIdSubject(
      { requireOpenIdSubject: false },
      { email: 'allowed@example.invalid', emailVerified: true },
    ),
    true,
  );
  const flowManager = {
    initFlow: async () => undefined,
    getFlowState: async () => null,
    deleteFlow: async () => undefined,
  };
  const handlers = api.createLiheHandlers({ ...keyDeps, flowManager, fetcher });
  const responseState = { status: 200, body: null };
  const response = {
    status(value) {
      responseState.status = value;
      return this;
    },
    json(value) {
      responseState.body = value;
      return this;
    },
    cookie() {
      return this;
    },
  };
  await handlers.start(
    { user: { id: 'synthetic-user' }, body: { apiKeyId: '90', replaceExisting: true } },
    response,
  );
  assert.equal(responseState.status, 200);
  assert.equal(new URL(responseState.body.authorizationUrl).searchParams.get('api_key_id'), '90');

  const pkce = api.createLihePkce();
  assert.equal(pkce.verifier.length, 64);
  assert.equal(
    api.verifyLiheState(api.signLiheState(pkce.flowId, config.stateSecret), config.stateSecret),
    pkce.flowId,
  );
  assert.equal(api.verifyLiheState(`${pkce.flowId}.invalid`, config.stateSecret), null);

  const tokenResponse = await api.exchangeLiheCode({
    config,
    code: 'synthetic-code',
    verifier: pkce.verifier,
    fetcher,
  });
  assert.equal(tokenResponse.access_token, integrationToken);
  assert.equal(tokenResponse.expires_in, null);
  const tokenRequest = requests[0];
  const tokenHeaders = new Headers(tokenRequest.init.headers);
  const tokenBody = new URLSearchParams(String(tokenRequest.init.body));
  assert.match(tokenHeaders.get('Authorization'), /^Basic /);
  assert.equal(tokenBody.get('code_verifier'), pkce.verifier);

  await api.validateLiheToken({ config, token: integrationToken, fetcher });
  const saved = await api.saveLiheConnection({
    deps: keyDeps,
    userId: 'synthetic-user',
    tokenResponse,
    connectedAt: new Date('2026-07-16T00:00:00.000Z'),
  });
  const status = await api.getLiheConnectionStatus({
    deps: keyDeps,
    userId: 'synthetic-user',
    configuredProviders: config.providers,
  });
  assert.equal(status.connected, true);
  assert.equal(JSON.stringify(status).includes(integrationToken), false);

  await api.revokeLiheToken({ config, token: integrationToken, fetcher });
  const disconnected = await api.disconnectLiheConnection({
    deps: keyDeps,
    userId: 'synthetic-user',
    connection: saved.connection,
  });
  assert.deepEqual(disconnected.restoredProviders, ['openAI', 'anthropic']);
  assert.equal(keys.get('anthropic').value, 'previous-anthropic');
  assert.equal(keys.has(api.LIHE_CONNECTION_KEY), false);
  assert.equal(
    requests.some(({ url }) => url.endsWith('/oauth/revoke')),
    true,
  );

  process.stdout.write('Lihe Connect image verification passed.\n');
}

verify().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
