import { logger } from '@librechat/data-schemas';
import { AuthKeys, EModelEndpoint, liheStoredConnectionSchema } from 'librechat-data-provider';
import type {
  TLiheProvider,
  TLiheTokenResponse,
  TLiheConnectionStatus,
  TLiheStoredConnection,
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
  replacedToken?: string;
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
    names.map(async (name) => [name, await readSnapshot(deps, userId, name)] as const),
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
  return parsed.data;
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
    };
  }

  const snapshots = await readSnapshots(deps, userId, connection.providers);
  const providerKeysConnected = connection.providers.every(
    (provider) =>
      snapshots.get(provider)?.value === formatProviderKey(provider, connection.accessToken),
  );
  const accountMatches =
    expectedAccountId === undefined || connection.accountId === expectedAccountId;
  const connected = providerKeysConnected && accountMatches;
  return {
    connected,
    needsReconnect: !connected,
    hasExistingKeys: false,
    providers: connection.providers,
    connectedAt: connection.connectedAt,
    accountLabel: connection.accountLabel,
  };
}

function previousSnapshot(
  connection: TLiheStoredConnection,
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
  const affectedProviders = [
    ...new Set([...(existing?.providers ?? []), ...tokenResponse.providers]),
  ];
  const snapshots = await readSnapshots(deps, userId, [LIHE_CONNECTION_KEY, ...affectedProviders]);
  const previousKeys: TLiheStoredConnection['previousKeys'] = {};

  for (const provider of tokenResponse.providers) {
    const current = snapshots.get(provider) ?? null;
    const wasManaged = existing?.providers.includes(provider) === true;
    const matchesExisting =
      wasManaged && current?.value === formatProviderKey(provider, existing.accessToken);
    const previous = matchesExisting && existing ? previousSnapshot(existing, provider) : current;
    if (previous) {
      previousKeys[provider] = previous;
    }
  }

  const connection: TLiheStoredConnection = {
    version: 1,
    accessToken: tokenResponse.access_token,
    scope: tokenResponse.scope,
    providers: tokenResponse.providers,
    connectedAt: connectedAt.toISOString(),
    accountId: tokenResponse.account_id,
    accountLabel: tokenResponse.account_label,
    previousKeys,
  };

  try {
    if (existing) {
      for (const provider of existing.providers) {
        if (tokenResponse.providers.includes(provider)) {
          continue;
        }
        const current = snapshots.get(provider) ?? null;
        if (current?.value === formatProviderKey(provider, existing.accessToken)) {
          await writeSnapshot(deps, userId, provider, previousSnapshot(existing, provider));
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
    replacedToken: existing?.accessToken,
  };
}

export async function disconnectLiheConnection({
  deps,
  userId,
  connection,
}: {
  deps: LiheKeyDependencies;
  userId: string;
  connection: TLiheStoredConnection;
}): Promise<TLiheDisconnectResponse> {
  const names = [LIHE_CONNECTION_KEY, ...connection.providers];
  const snapshots = await readSnapshots(deps, userId, names);
  const restoredProviders: TLiheProvider[] = [];
  const preservedProviders: TLiheProvider[] = [];

  try {
    for (const provider of connection.providers) {
      const current = snapshots.get(provider) ?? null;
      if (current?.value !== formatProviderKey(provider, connection.accessToken)) {
        preservedProviders.push(provider);
        continue;
      }
      const previous = previousSnapshot(connection, provider);
      await writeSnapshot(deps, userId, provider, previous);
      if (previous) {
        restoredProviders.push(provider);
      }
    }
    await deps.deleteUserKey({ userId, name: LIHE_CONNECTION_KEY });
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
    restoredProviders,
    preservedProviders,
  };
}

export { formatProviderKey };
