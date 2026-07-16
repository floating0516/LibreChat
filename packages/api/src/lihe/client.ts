import { liheModelsResponseSchema, liheTokenResponseSchema } from 'librechat-data-provider';
import type { TLiheTokenResponse } from 'librechat-data-provider';
import type { LiheConfig } from './config';

export type LiheFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class LiheRemoteError extends Error {
  readonly code: 'token_exchange_failed' | 'token_validation_failed' | 'token_revocation_failed';

  constructor(code: LiheRemoteError['code']) {
    super(code);
    this.name = 'LiheRemoteError';
    this.code = code;
  }
}

function clientAuthorization(config: LiheConfig): string {
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  return `Basic ${credentials}`;
}

async function remoteOperation<T>(
  code: LiheRemoteError['code'],
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof LiheRemoteError) {
      throw error;
    }
    throw new LiheRemoteError(code);
  }
}

export async function exchangeLiheCode({
  config,
  code,
  verifier,
  fetcher = fetch,
}: {
  config: LiheConfig;
  code: string;
  verifier: string;
  fetcher?: LiheFetch;
}): Promise<TLiheTokenResponse> {
  return remoteOperation('token_exchange_failed', async () => {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      code,
      redirect_uri: config.callbackUrl.href,
      code_verifier: verifier,
    });
    const response = await fetcher(config.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: clientAuthorization(config),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new LiheRemoteError('token_exchange_failed');
    }
    const parsed = liheTokenResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new LiheRemoteError('token_exchange_failed');
    }
    return parsed.data;
  });
}

export async function validateLiheToken({
  config,
  token,
  fetcher = fetch,
}: {
  config: LiheConfig;
  token: string;
  fetcher?: LiheFetch;
}): Promise<void> {
  await remoteOperation('token_validation_failed', async () => {
    const response = await fetcher(config.modelsUrl, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new LiheRemoteError('token_validation_failed');
    }
    const parsed = liheModelsResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new LiheRemoteError('token_validation_failed');
    }
  });
}

export async function revokeLiheToken({
  config,
  token,
  fetcher = fetch,
}: {
  config: LiheConfig;
  token: string;
  fetcher?: LiheFetch;
}): Promise<void> {
  await remoteOperation('token_revocation_failed', async () => {
    const response = await fetcher(config.revokeUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: clientAuthorization(config),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token, token_type_hint: 'access_token' }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new LiheRemoteError('token_revocation_failed');
    }
  });
}
