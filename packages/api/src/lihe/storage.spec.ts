import type { TLiheTokenResponse } from 'librechat-data-provider';
import type { LiheKeyDependencies } from './storage';
import {
  LIHE_CONNECTION_KEY,
  formatProviderKey,
  saveLiheConnection,
  loadLiheConnection,
  getLiheConnectionStatus,
  getLiheTokensToRevoke,
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

function tokenResponse(
  token: string,
  providers: TLiheTokenResponse['providers'] = ['openAI', 'anthropic'],
): TLiheTokenResponse {
  return {
    access_token: token,
    token_type: 'Bearer',
    scope: 'models:read chat:write',
    providers,
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
    expect(await loadLiheConnection(deps, userId)).toMatchObject({
      version: 2,
      connections: [{ accessToken: firstToken }],
    });
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

  it('stores Grok tokens in the OpenAI-compatible custom endpoint key', async () => {
    const previousGrok = JSON.stringify({ apiKey: 'old-grok', baseURL: '' });
    const { deps, keys } = createMemoryKeys({
      Grok: { value: previousGrok, expiresAt: null },
    });
    const { connection } = await saveLiheConnection({
      deps,
      userId,
      tokenResponse: tokenResponse(firstToken, ['grok']),
    });

    expect(keys.has('grok')).toBe(false);
    expect(keys.get('Grok')?.value).toBe(formatProviderKey('grok', firstToken));
    await expect(
      getLiheConnectionStatus({ deps, userId, configuredProviders: ['grok'] }),
    ).resolves.toMatchObject({ connected: true, providers: ['grok'] });

    const disconnected = await disconnectLiheConnection({
      deps,
      userId,
      connection,
      provider: 'grok',
    });
    expect(disconnected.restoredProviders).toEqual(['grok']);
    expect(keys.get('Grok')?.value).toBe(previousGrok);
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

    expect(rotated.replacedTokens).toEqual([firstToken]);
    expect(rotated.connection.connections[0].previousKeys.anthropic?.value).toBe(
      'original-anthropic',
    );
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

  it('disconnects one provider without revoking a token still used by another provider', async () => {
    const previousAnthropic = 'previous-anthropic';
    const { deps, keys } = createMemoryKeys({
      anthropic: { value: previousAnthropic, expiresAt: null },
    });
    const { connection } = await saveLiheConnection({
      deps,
      userId,
      tokenResponse: tokenResponse(firstToken),
    });

    expect(getLiheTokensToRevoke(connection, 'anthropic')).toEqual([]);
    const disconnected = await disconnectLiheConnection({
      deps,
      userId,
      connection,
      provider: 'anthropic',
    });

    expect(disconnected.disconnectedProviders).toEqual(['anthropic']);
    expect(disconnected.remainingProviders).toEqual(['openAI']);
    expect(keys.get('anthropic')?.value).toBe(previousAnthropic);
    expect(keys.get('openAI')?.value).toBe(formatProviderKey('openAI', firstToken));
    const remaining = await loadLiheConnection(deps, userId);
    expect(remaining).toMatchObject({
      connections: [{ accessToken: firstToken, providers: ['openAI'] }],
    });
    expect(getLiheTokensToRevoke(remaining!, 'openAI')).toEqual([firstToken]);
  });

  it('preserves disjoint provider connections and rotates only the overlapping provider', async () => {
    const anthropicToken = 'lhc_anthropic_token_123456789';
    const rotatedAnthropicToken = 'lhc_anthropic_rotated_1234567';
    const { deps, keys } = createMemoryKeys();

    await saveLiheConnection({
      deps,
      userId,
      tokenResponse: tokenResponse(firstToken, ['openAI']),
      connectedAt: new Date('2026-07-16T00:00:00.000Z'),
    });
    const added = await saveLiheConnection({
      deps,
      userId,
      tokenResponse: tokenResponse(anthropicToken, ['anthropic']),
      connectedAt: new Date('2026-07-16T01:00:00.000Z'),
    });

    expect(added.replacedTokens).toEqual([]);
    expect(added.connection.connections).toHaveLength(2);
    expect(keys.get('openAI')?.value).toBe(formatProviderKey('openAI', firstToken));
    expect(keys.get('anthropic')?.value).toBe(anthropicToken);

    const rotated = await saveLiheConnection({
      deps,
      userId,
      tokenResponse: tokenResponse(rotatedAnthropicToken, ['anthropic']),
    });
    expect(rotated.replacedTokens).toEqual([anthropicToken]);
    expect(rotated.connection.connections.map((entry) => entry.providers)).toEqual([
      ['openAI'],
      ['anthropic'],
    ]);
    expect(keys.get('openAI')?.value).toBe(formatProviderKey('openAI', firstToken));
    expect(keys.get('anthropic')?.value).toBe(rotatedAnthropicToken);

    const disconnected = await disconnectLiheConnection({
      deps,
      userId,
      connection: rotated.connection,
      provider: 'anthropic',
    });
    expect(disconnected.disconnectedProviders).toEqual(['anthropic']);
    expect(disconnected.remainingProviders).toEqual(['openAI']);
    expect(keys.has('anthropic')).toBe(false);
    expect(keys.get('openAI')?.value).toBe(formatProviderKey('openAI', firstToken));
    await expect(loadLiheConnection(deps, userId)).resolves.toMatchObject({
      connections: [{ providers: ['openAI'], accessToken: firstToken }],
    });
  });

  it('reports every replaced token when provider connections are merged', async () => {
    const anthropicToken = 'lhc_anthropic_token_123456789';
    const mergedToken = 'lhc_merged_token_123456789012';
    const { deps } = createMemoryKeys();
    await saveLiheConnection({
      deps,
      userId,
      tokenResponse: tokenResponse(firstToken, ['openAI']),
    });
    await saveLiheConnection({
      deps,
      userId,
      tokenResponse: tokenResponse(anthropicToken, ['anthropic']),
    });

    const merged = await saveLiheConnection({
      deps,
      userId,
      tokenResponse: tokenResponse(mergedToken),
    });

    expect(merged.replacedTokens).toEqual([firstToken, anthropicToken]);
    expect(merged.connection.connections).toEqual([
      expect.objectContaining({ accessToken: mergedToken, providers: ['openAI', 'anthropic'] }),
    ]);
  });

  it('normalizes legacy v1 metadata without mutating the stored value', async () => {
    const legacy = {
      version: 1,
      accessToken: firstToken,
      scope: 'models:read chat:write',
      providers: ['openAI'] as const,
      connectedAt: '2026-07-16T00:00:00.000Z',
      previousKeys: {},
    };
    const { deps, keys } = createMemoryKeys({
      [LIHE_CONNECTION_KEY]: { value: JSON.stringify(legacy), expiresAt: null },
      openAI: { value: formatProviderKey('openAI', firstToken), expiresAt: null },
    });

    await expect(loadLiheConnection(deps, userId)).resolves.toEqual({
      version: 2,
      connections: [expect.objectContaining({ accessToken: firstToken, providers: ['openAI'] })],
    });
    expect(JSON.parse(keys.get(LIHE_CONNECTION_KEY)?.value ?? '{}').version).toBe(1);
  });
});
