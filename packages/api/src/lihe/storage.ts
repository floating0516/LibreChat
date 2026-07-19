import { logger } from '@librechat/data-schemas';
import { AuthKeys, EModelEndpoint, liheStoredConnectionSchema } from 'librechat-data-provider';
import type {
  TLiheProvider,
  TLiheTokenResponse,
  TLiheConnectionStatus,
  TLiheStoredConnection,
  TLiheStoredConnectionData,
  TLiheStoredConnectionEntry,
  TLiheDisconnectResponse,
} from 'librechat-data-provider';

export const LIHE_CONNECTION_KEY = 'lihe_connect';

type KeyExpiry = Date | 'never' | null;

type KeySnapshot = {
  value: string;
  expiresAt: string | null;
};

export type LiheKeyDependencies = {
  getUserKey: (params: { userId: string; name: string }) => Promise<string>;
  getUserKeyExpiry: (params: { userId: string; name: string }) => Promise<{ expiresAt: KeyExpiry }>;
  updateUserKey: (params: {
    userId: string;
    name: string;
    value: string;
    expiresAt?: Date | null;
  }) => Promise<unknown>;
  deleteUserKey: (params: { userId: string; name: string }) => Promise<unknown>;
};

export type SaveLiheConnectionResult = {
  connection: TLiheStoredConnection;
  replacedTokens: string[];
};

function formatProviderKey(provider: TLiheProvider, token: string): string {
  if (provider === EModelEndpoint.openAI) {
    return JSON.stringify({ apiKey: token, baseURL: '' });
  }
  if (provider === EModelEndpoint.google) {
    return JSON.stringify({ [AuthKeys.GOOGLE_API_KEY]: token });
  }
  return token;
}

async function readSnapshot(
  deps: LiheKeyDependencies,
  userId: string,
  name: string,
): Promise<KeySnapshot | null> {
  const { expiresAt } = await deps.getUserKeyExpiry({ userId, name });
  if (expiresAt === null) {
    return null;
  }
  const value = await deps.getUserKey({ userId, name });
  if (expiresAt === 'never') {
    return { value, expiresAt: null };
  }
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
    throw new Error('Invalid stored key expiration');
  }
  return { value, expiresAt: expiresAt.toISOString() };
}

async function writeSnapshot(
  deps: LiheKeyDependencies,
  userId: string,
  name: string,
  snapshot: KeySnapshot | null,
): Promise<void> {
  if (!snapshot) {
    await deps.deleteUserKey({ userId, name });
    return;
  }
  await deps.updateUserKey({
    userId,
    name,
    value: snapshot.value,
    expiresAt: snapshot.expiresAt ? new Date(snapshot.expiresAt) : null,
  });
}

async function readSnapshots(
  deps: LiheKeyDependencies,
  userId: string,
  names: string[],
): Promise<Map<string, KeySnapshot | null>> {
  const entries = await Promise.all(
    [...new Set(names)].map(
      async (name) => [name, await readSnapshot(deps, userId, name)] as const,
    ),
  );
  return new Map(entries);
}

async function restoreSnapshots(
  deps: LiheKeyDependencies,
  userId: string,
  snapshots: Map<string, KeySnapshot | null>,
): Promise<void> {
  await Promise.all(
    [...snapshots.entries()].map(([name, snapshot]) => writeSnapshot(deps, userId, name, snapshot)),
  );
}

function normalizeStoredConnection(data: TLiheStoredConnectionData): TLiheStoredConnection {
  if (data.version === 2) {
    return data;
  }
  const { version: _version, ...connection } = data;
  return { version: 2, connections: [connection] };
}

function connectionProviders(connections: TLiheStoredConnectionEntry[]): TLiheProvider[] {
  return [...new Set(connections.flatMap((connection) => connection.providers))];
}

function selectConnections(
  connection: TLiheStoredConnection,
  provider?: TLiheProvider,
): TLiheStoredConnectionEntry[] {
  if (!provider) {
    return connection.connections;
  }
  return connection.connections.filter((entry) => entry.providers.includes(provider));
}

export function getLiheTokensToRevoke(
  connection: TLiheStoredConnection,
  provider?: TLiheProvider,
): string[] {
  const selectedTokens = new Set(
    selectConnections(connection, provider).map((entry) => entry.accessToken),
  );
  if (!provider) {
    return [...selectedTokens];
  }
  return [...selectedTokens].filter((token) =>
    connection.connections.every(
      (entry) =>
        entry.accessToken !== token ||
        entry.providers.every((entryProvider) => entryProvider === provider),
    ),
  );
}

export async function loadLiheConnection(
  deps: LiheKeyDependencies,
  userId: string,
): Promise<TLiheStoredConnection | null> {
  const snapshot = await readSnapshot(deps, userId, LIHE_CONNECTION_KEY);
  if (!snapshot) {
    return null;
  }
  const parsedJson: unknown = JSON.parse(snapshot.value);
  const parsed = liheStoredConnectionSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error('Invalid Lihe connection metadata');
  }
  return normalizeStoredConnection(parsed.data);
}

export async function getLiheConnectionStatus({
  deps,
  userId,
  configuredProviders,
  expectedAccountId,
}: {
  deps: LiheKeyDependencies;
  userId: string;
  configuredProviders: TLiheProvider[];
  expectedAccountId?: string;
}): Promise<Omit<TLiheConnectionStatus, 'enabled'>> {
  const connection = await loadLiheConnection(deps, userId);
  if (!connection) {
    const snapshots = await readSnapshots(deps, userId, configuredProviders);
    return {
      connected: false,
      needsReconnect: false,
      hasExistingKeys: configuredProviders.some((provider) => snapshots.get(provider) != null),
      providers: configuredProviders,
      connections: [],
    };
  }

  const providers = connectionProviders(connection.connections);
  const snapshots = await readSnapshots(deps, userId, providers);
  const connections = connection.connections.map((entry) => {
    const providerKeysConnected = entry.providers.every(
      (provider) =>
        snapshots.get(provider)?.value === formatProviderKey(provider, entry.accessToken),
    );
    const accountMatches = expectedAccountId === undefined || entry.accountId === expectedAccountId;
    const connected = providerKeysConnected && accountMatches;
    return {
      connected,
      needsReconnect: !connected,
      providers: entry.providers,
      connectedAt: entry.connectedAt,
      accountLabel: entry.accountLabel,
    };
  });
  const latest = connection.connections.reduce((current, entry) =>
    Date.parse(entry.connectedAt) > Date.parse(current.connectedAt) ? entry : current,
  );

  return {
    connected: connections.every((entry) => entry.connected),
    needsReconnect: connections.some((entry) => entry.needsReconnect),
    hasExistingKeys: false,
    providers,
    connectedAt: latest.connectedAt,
    accountLabel: latest.accountLabel,
    connections,
  };
}

function previousSnapshot(
  connection: TLiheStoredConnectionEntry,
  provider: TLiheProvider,
): KeySnapshot | null {
  return connection.previousKeys[provider] ?? null;
}

export async function saveLiheConnection({
  deps,
  userId,
  tokenResponse,
  connectedAt = new Date(),
}: {
  deps: LiheKeyDependencies;
  userId: string;
  tokenResponse: TLiheTokenResponse;
  connectedAt?: Date;
}): Promise<SaveLiheConnectionResult> {
  const existing = await loadLiheConnection(deps, userId);
  const currentConnections = existing?.connections ?? [];
  const incomingProviders = new Set(tokenResponse.providers);
  const replacedConnections = currentConnections.filter(
    (connection) =>
      connection.accessToken === tokenResponse.access_token ||
      connection.providers.some((provider) => incomingProviders.has(provider)),
  );
  const replacedSet = new Set(replacedConnections);
  const retainedConnections = currentConnections.filter(
    (connection) => !replacedSet.has(connection),
  );
  const affectedProviders = connectionProviders([
    ...replacedConnections,
    {
      accessToken: tokenResponse.access_token,
      scope: tokenResponse.scope,
      providers: tokenResponse.providers,
      connectedAt: connectedAt.toISOString(),
      accountId: tokenResponse.account_id,
      accountLabel: tokenResponse.account_label,
      previousKeys: {},
    },
  ]);
  const snapshots = await readSnapshots(deps, userId, [LIHE_CONNECTION_KEY, ...affectedProviders]);
  const previousKeys: TLiheStoredConnectionEntry['previousKeys'] = {};

  for (const provider of tokenResponse.providers) {
    const current = snapshots.get(provider) ?? null;
    const managedConnection = replacedConnections.find((connection) =>
      connection.providers.includes(provider),
    );
    const matchesExisting =
      managedConnection != null &&
      current?.value === formatProviderKey(provider, managedConnection.accessToken);
    const previous = matchesExisting ? previousSnapshot(managedConnection, provider) : current;
    if (previous) {
      previousKeys[provider] = previous;
    }
  }

  const newConnection: TLiheStoredConnectionEntry = {
    accessToken: tokenResponse.access_token,
    scope: tokenResponse.scope,
    providers: tokenResponse.providers,
    connectedAt: connectedAt.toISOString(),
    accountId: tokenResponse.account_id,
    accountLabel: tokenResponse.account_label,
    previousKeys,
  };
  const connection: TLiheStoredConnection = {
    version: 2,
    connections: [...retainedConnections, newConnection],
  };

  try {
    for (const replaced of replacedConnections) {
      for (const provider of replaced.providers) {
        if (incomingProviders.has(provider)) {
          continue;
        }
        const current = snapshots.get(provider) ?? null;
        if (current?.value === formatProviderKey(provider, replaced.accessToken)) {
          await writeSnapshot(deps, userId, provider, previousSnapshot(replaced, provider));
        }
      }
    }
    await Promise.all(
      tokenResponse.providers.map((provider) =>
        deps.updateUserKey({
          userId,
          name: provider,
          value: formatProviderKey(provider, tokenResponse.access_token),
          expiresAt: null,
        }),
      ),
    );
    await deps.updateUserKey({
      userId,
      name: LIHE_CONNECTION_KEY,
      value: JSON.stringify(connection),
      expiresAt: null,
    });
  } catch (error) {
    try {
      await restoreSnapshots(deps, userId, snapshots);
    } catch (rollbackError) {
      logger.error('[Lihe Connect] Failed to roll back credential storage', rollbackError);
    }
    throw error;
  }

  return {
    connection,
    replacedTokens: [...new Set(replacedConnections.map((entry) => entry.accessToken))],
  };
}

export async function disconnectLiheConnection({
  deps,
  userId,
  connection,
  provider,
}: {
  deps: LiheKeyDependencies;
  userId: string;
  connection: TLiheStoredConnection;
  provider?: TLiheProvider;
}): Promise<TLiheDisconnectResponse> {
  const selectedConnections = selectConnections(connection, provider);
  const remainingConnections = provider
    ? connection.connections.flatMap((entry) => {
        if (!entry.providers.includes(provider)) {
          return [entry];
        }
        const providers = entry.providers.filter((entryProvider) => entryProvider !== provider);
        if (providers.length === 0) {
          return [];
        }
        const previousKeys = Object.fromEntries(
          providers.flatMap((remainingProvider) => {
            const snapshot = entry.previousKeys[remainingProvider];
            return snapshot ? [[remainingProvider, snapshot]] : [];
          }),
        );
        return [{ ...entry, providers, previousKeys }];
      })
    : [];
  const disconnectedProviders = provider
    ? selectedConnections.length > 0
      ? [provider]
      : []
    : connectionProviders(selectedConnections);
  const remainingProviders = connectionProviders(remainingConnections);

  if (selectedConnections.length === 0) {
    return {
      disconnected: true,
      disconnectedProviders: [],
      remainingProviders,
      restoredProviders: [],
      preservedProviders: [],
    };
  }

  const names = [LIHE_CONNECTION_KEY, ...disconnectedProviders];
  const snapshots = await readSnapshots(deps, userId, names);
  const restoredProviders: TLiheProvider[] = [];
  const preservedProviders: TLiheProvider[] = [];

  try {
    for (const selected of selectedConnections) {
      const providersToDisconnect = provider ? [provider] : selected.providers;
      for (const selectedProvider of providersToDisconnect) {
        const current = snapshots.get(selectedProvider) ?? null;
        if (current?.value !== formatProviderKey(selectedProvider, selected.accessToken)) {
          preservedProviders.push(selectedProvider);
          continue;
        }
        const previous = previousSnapshot(selected, selectedProvider);
        await writeSnapshot(deps, userId, selectedProvider, previous);
        if (previous) {
          restoredProviders.push(selectedProvider);
        }
      }
    }
    if (remainingConnections.length > 0) {
      await deps.updateUserKey({
        userId,
        name: LIHE_CONNECTION_KEY,
        value: JSON.stringify({ version: 2, connections: remainingConnections }),
        expiresAt: null,
      });
    } else {
      await deps.deleteUserKey({ userId, name: LIHE_CONNECTION_KEY });
    }
  } catch (error) {
    try {
      await restoreSnapshots(deps, userId, snapshots);
    } catch (rollbackError) {
      logger.error('[Lihe Connect] Failed to roll back disconnect', rollbackError);
    }
    throw error;
  }

  return {
    disconnected: true,
    disconnectedProviders,
    remainingProviders,
    restoredProviders,
    preservedProviders,
  };
}

export { formatProviderKey };
