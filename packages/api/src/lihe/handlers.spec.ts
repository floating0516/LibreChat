import { Keyv } from 'keyv';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { LiheFetch } from './client';
import type { LiheKeyDependencies } from './storage';
import { FlowStateManager } from '~/flow/manager';
import { createLiheHandlers } from './handlers';

describe('Lihe Connect handlers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.LIHE_CONNECT_ENABLED = 'true';
    process.env.LIHE_CONNECT_API_BASE_URL = 'https://api.lihe.chat';
    process.env.LIHE_CONNECT_CLIENT_ID = 'lihe-chat';
    process.env.LIHE_CONNECT_CLIENT_SECRET = 'test-client-secret';
    process.env.LIHE_CONNECT_PROVIDERS = 'openAI,anthropic';
    process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough';
    process.env.DOMAIN_CLIENT = 'https://lihe.chat';
    process.env.DOMAIN_SERVER = 'https://lihe.chat';
    process.env.SESSION_COOKIE_SECURE = 'false';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('completes the browser flow without exposing the long-lived token', async () => {
    const keys = new Map<string, { value: string; expiresAt: Date | null }>();
    let tokenScope = 'models:read chat:write';
    let revocations = 0;
    const keyDeps: LiheKeyDependencies = {
      getUserKey: async ({ name }) => {
        const key = keys.get(name);
        if (!key) {
          throw new Error('missing key');
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
    const fetcher: LiheFetch = async (input) => {
      const url = input.toString();
      if (url.endsWith('/oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'lhc_handler_token_1234567890',
            token_type: 'Bearer',
            scope: tokenScope,
            providers: ['openAI', 'anthropic'],
            account_label: 'Lihe user',
            expires_in: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/v1/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'gpt-test' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/oauth/revoke')) {
        revocations += 1;
      }
      return new Response(null, { status: 200 });
    };
    const flowManager = new FlowStateManager<null>(new Keyv(), { ttl: 60_000, ci: true });
    const handlers = createLiheHandlers({ ...keyDeps, flowManager, fetcher });
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use((req, _res, next) => {
      Object.assign(req, { user: { id: 'user-1' } });
      next();
    });
    app.get('/api/integrations/lihe/status', handlers.status);
    app.post('/api/integrations/lihe/start', handlers.start);
    app.get('/api/integrations/lihe/callback', handlers.callback);
    app.post('/api/integrations/lihe/disconnect', handlers.disconnect);
    const agent = request.agent(app);

    for (const body of [
      {},
      { apiKeyId: 90 },
      { apiKeyId: '0' },
      { apiKeyId: '01' },
      { apiKeyId: '-1' },
      { apiKeyId: '1.5' },
      { apiKeyId: '1e2' },
      { apiKeyId: '9223372036854775808' },
      { apiKeyId: '90', userId: 'other-user' },
    ]) {
      const invalidStart = await agent.post('/api/integrations/lihe/start').send(body);
      expect(invalidStart.status).toBe(400);
      expect(invalidStart.body).toEqual({ error: 'invalid_request' });
    }

    const start = await agent.post('/api/integrations/lihe/start').send({ apiKeyId: '90' });
    expect(start.status).toBe(200);
    const authorizationUrl = new URL(start.body.authorizationUrl);
    expect(authorizationUrl.origin).toBe('https://api.lihe.chat');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('api_key_id')).toBe('90');

    const callback = await agent.get('/api/integrations/lihe/callback').query({
      code: 'single-use-code',
      state: authorizationUrl.searchParams.get('state'),
    });
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe('/connect/lihe?result=connected');
    expect(callback.headers.location).not.toContain('lhc_handler_token');
    expect(keys.get('anthropic')?.value).toBe('lhc_handler_token_1234567890');

    const status = await agent.get('/api/integrations/lihe/status');
    expect(status.body).toMatchObject({
      enabled: true,
      connected: true,
      providers: ['openAI', 'anthropic'],
      accountLabel: 'Lihe user',
      selectionUrl: 'https://api.lihe.chat/integrations/lihe',
    });
    expect(JSON.stringify(status.body)).not.toContain('lhc_handler_token');

    const replay = await agent.get('/api/integrations/lihe/callback').query({
      code: 'single-use-code',
      state: authorizationUrl.searchParams.get('state'),
    });
    expect(replay.headers.location).toContain('result=error');

    const disconnect = await agent.post('/api/integrations/lihe/disconnect');
    expect(disconnect.status).toBe(200);
    expect(keys.has('openAI')).toBe(false);
    expect(keys.has('anthropic')).toBe(false);
    expect(revocations).toBe(1);

    tokenScope = 'models:read chat:write account:read';
    const overScopedStart = await agent
      .post('/api/integrations/lihe/start')
      .send({ apiKeyId: '90' });
    const overScopedUrl = new URL(overScopedStart.body.authorizationUrl);
    const overScopedCallback = await agent.get('/api/integrations/lihe/callback').query({
      code: 'over-scoped-code',
      state: overScopedUrl.searchParams.get('state'),
    });
    expect(overScopedCallback.headers.location).toContain('error=token_validation_failed');
    expect(keys.size).toBe(0);
    expect(revocations).toBe(2);
  });
});
