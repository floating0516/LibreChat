import type { TLiheTokenResponse } from 'librechat-data-provider';
import type { LiheKeyDependencies } from './storage';
import {
  LIHE_CONNECTION_KEY,
  formatProviderKey,
  saveLiheConnection,
  loadLiheConnection,
  getLiheConnectionStatus,
  disconnectLiheConnection,
} from './storage';

type StoredKey = {
  value: string;
  expiresAt: Date | null;
};

function createMemoryKeys(initial: Record<string, StoredKey> = {}) {
  const keys = new Map<string, StoredKey>(Object.entries(initial));
  const deps: LiheKeyDependencies = {
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
  return { deps, keys };
}

function tokenResponse(token: string): TLiheTokenResponse {
  return {
    access_token: token,
    token_type: 'Bearer',
    scope: 'models:read chat:write',
    providers: ['openAI', 'anthropic'],
    expires_in: null,
  };
}

describe('Lihe Connect credential storage', () => {
  const userId = 'user-1';
  const firstToken = 'lhc_first_token_1234567890';
  const secondToken = 'lhc_second_token_123456789';

  it('stores permanent provider keys and restores previous keys on disconnect', async () => {
    const previousOpenAI = JSON.stringify({ apiKey: 'old-openai', baseURL: '' });
    const { deps, keys } = createMemoryKeys({
      openAI: { value: previousOpenAI, expiresAt: null },
      anthropic: { value: 'old-anthropic', expiresAt: new Date('2030-01-01T00:00:00.000Z') },
    });

    const { connection } = await saveLiheConnection({
      deps,
      userId,
      tokenResponse: tokenResponse(firstToken),
      connectedAt: new Date('2026-07-16T00:00:00.000Z'),
    });

    expect(keys.get('openAI')?.value).toBe(formatProviderKey('openAI', firstToken));
    expect(keys.get('anthropic')?.value).toBe(firstToken);
    expect(keys.get('openAI')?.expiresAt).toBeNull();
    expect(await loadLiheConnection(deps, userId)).toMatchObject({ accessToken: firstToken });
    await expect(
      getLiheConnectionStatus({
        deps,
        userId,
        configuredProviders: ['openAI', 'anthropic'],
      }),
    ).resolves.toMatchObject({ connected: true, needsReconnect: false });

    const result = await disconnectLiheConnection({ deps, userId, connection });
    expect(result.restoredProviders).toEqual(['openAI', 'anthropic']);
    expect(keys.get('openAI')?.value).toBe(previousOpenAI);
    expect(keys.get('anthropic')?.value).toBe('old-anthropic');
    expect(keys.get('anthropic')?.expiresAt?.toISOString()).toBe('2030-01-01T00:00:00.000Z');
    expect(keys.has(LIHE_CONNECTION_KEY)).toBe(false);
  });

  it('keeps the original backup across a token rotation', async () => {
    const { deps, keys } = createMemoryKeys({
      anthropic: { value: 'original-anthropic', expiresAt: null },
    });
    await saveLiheConnection({ deps, userId, tokenResponse: tokenResponse(firstToken) });
    const rotated = await saveLiheConnection({
      deps,
      userId,
      tokenResponse: tokenResponse(secondToken),
    });

    expect(rotated.replacedToken).toBe(firstToken);
    expect(rotated.connection.previousKeys.anthropic?.value).toBe('original-anthropic');
    await disconnectLiheConnection({ deps, userId, connection: rotated.connection });
    expect(keys.get('anthropic')?.value).toBe('original-anthropic');
  });

  it('requires reconnection when stored Token metadata belongs to another OIDC subject', async () => {
    const { deps } = createMemoryKeys();
    await saveLiheConnection({
      deps,
      userId,
      tokenResponse: { ...tokenResponse(firstToken), account_id: 'account-a' },
    });

    await expect(
      getLiheConnectionStatus({
        deps,
        userId,
        configuredProviders: ['openAI', 'anthropic'],
        expectedAccountId: 'account-b',
      }),
    ).resolves.toMatchObject({ connected: false, needsReconnect: true });
  });

  it('preserves a provider key changed manually after connection', async () => {
    const { deps, keys } = createMemoryKeys();
    const { connection } = await saveLiheConnection({
      deps,
      userId,
      tokenResponse: tokenResponse(firstToken),
    });
    keys.set('anthropic', { value: 'manual-replacement', expiresAt: null });

    const result = await disconnectLiheConnection({ deps, userId, connection });
    expect(result.preservedProviders).toEqual(['anthropic']);
    expect(keys.get('anthropic')?.value).toBe('manual-replacement');
    expect(keys.has('openAI')).toBe(false);
  });
});
