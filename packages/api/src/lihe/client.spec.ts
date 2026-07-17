import type { LiheConfig } from './config';
import type { LiheFetch } from './client';
import { exchangeLiheCode, validateLiheToken, revokeLiheToken } from './client';

const config: LiheConfig = {
  apiBaseUrl: new URL('https://api.lihe.chat/'),
  authorizationUrl: new URL('https://api.lihe.chat/oauth/authorize'),
  selectionUrl: new URL('https://api.lihe.chat/integrations/lihe'),
  tokenUrl: new URL('https://api.lihe.chat/oauth/token'),
  revokeUrl: new URL('https://api.lihe.chat/oauth/revoke'),
  modelsUrl: new URL('https://api.lihe.chat/v1/models'),
  callbackUrl: new URL('https://lihe.chat/api/integrations/lihe/callback'),
  clientId: 'lihe-chat',
  clientSecret: 'client-secret',
  stateSecret: 'state-secret',
  scope: 'models:read chat:write',
  providers: ['openAI', 'anthropic'],
  cookiePath: '/api/integrations/lihe',
  resultPath: '/connect/lihe',
};

describe('Lihe Connect remote client', () => {
  it('exchanges a PKCE code using confidential-client authentication', async () => {
    let requestInit: RequestInit | undefined;
    const fetcher: LiheFetch = async (_input, init) => {
      requestInit = init;
      return new Response(
        JSON.stringify({
          access_token: 'lhc_test_token_1234567890',
          token_type: 'Bearer',
          scope: 'models:read chat:write',
          providers: ['openAI', 'anthropic'],
          expires_in: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await exchangeLiheCode({
      config,
      code: 'single-use-code',
      verifier: 'v'.repeat(64),
      fetcher,
    });

    const headers = new Headers(requestInit?.headers);
    const body = new URLSearchParams(String(requestInit?.body));
    expect(headers.get('Authorization')).toBe(
      `Basic ${Buffer.from('lihe-chat:client-secret').toString('base64')}`,
    );
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('v'.repeat(64));
    expect(result.providers).toEqual(['openAI', 'anthropic']);
  });

  it('rejects expiring integration tokens', async () => {
    const fetcher: LiheFetch = async () =>
      new Response(
        JSON.stringify({
          access_token: 'lhc_test_token_1234567890',
          token_type: 'Bearer',
          scope: 'models:read chat:write',
          providers: ['openAI'],
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );

    await expect(
      exchangeLiheCode({ config, code: 'code', verifier: 'v'.repeat(64), fetcher }),
    ).rejects.toMatchObject({ code: 'token_exchange_failed' });
  });

  it('validates models and sends an RFC 7009 revocation request', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: LiheFetch = async (input, init) => {
      requests.push({ url: input.toString(), init });
      if (input.toString().endsWith('/v1/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'gpt-test' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 200 });
    };

    await validateLiheToken({ config, token: 'lhc_test_token_1234567890', fetcher });
    await revokeLiheToken({ config, token: 'lhc_test_token_1234567890', fetcher });

    expect(new Headers(requests[0].init?.headers).get('Authorization')).toBe(
      'Bearer lhc_test_token_1234567890',
    );
    const revokeBody = new URLSearchParams(String(requests[1].init?.body));
    expect(revokeBody.get('token')).toBe('lhc_test_token_1234567890');
    expect(revokeBody.get('token_type_hint')).toBe('access_token');
  });

  it('maps transport and response parsing failures to stable error codes', async () => {
    const invalidJson: LiheFetch = async () =>
      new Response('not-json', { status: 200, headers: { 'Content-Type': 'application/json' } });
    const unavailable: LiheFetch = async () => {
      throw new TypeError('synthetic network failure');
    };

    await expect(
      exchangeLiheCode({ config, code: 'code', verifier: 'v'.repeat(64), fetcher: invalidJson }),
    ).rejects.toMatchObject({ code: 'token_exchange_failed' });
    await expect(
      validateLiheToken({ config, token: 'lhc_test_token_1234567890', fetcher: unavailable }),
    ).rejects.toMatchObject({ code: 'token_validation_failed' });
    await expect(
      revokeLiheToken({ config, token: 'lhc_test_token_1234567890', fetcher: unavailable }),
    ).rejects.toMatchObject({ code: 'token_revocation_failed' });
  });
});
