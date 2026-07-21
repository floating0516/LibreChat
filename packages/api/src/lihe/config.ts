import { EModelEndpoint } from 'librechat-data-provider';
import type { TLiheProvider } from 'librechat-data-provider';
import { getBasePath, isEnabled } from '~/utils';

export const LIHE_CALLBACK_ROUTE = '/api/integrations/lihe/callback';
export const LIHE_COOKIE_ROUTE = '/api/integrations/lihe';
export const LIHE_RESULT_ROUTE = '/connect/lihe';
export const LIHE_FLOW_TYPE = 'lihe_oauth';

const SUPPORTED_PROVIDERS = new Set<TLiheProvider>([
  EModelEndpoint.openAI,
  EModelEndpoint.anthropic,
  EModelEndpoint.google,
  'grok',
]);

export type LiheConfig = {
  apiBaseUrl: URL;
  authorizationUrl: URL;
  selectionUrl: URL;
  tokenUrl: URL;
  revokeUrl: URL;
  modelsUrl: URL;
  callbackUrl: URL;
  clientId: string;
  clientSecret: string;
  stateSecret: string;
  scope: string;
  providers: TLiheProvider[];
  requireOpenIdSubject: boolean;
  cookiePath: string;
  resultPath: string;
};

export class LiheConfigurationError extends Error {
  constructor() {
    super('Lihe Connect is not configured');
    this.name = 'LiheConfigurationError';
  }
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  );
}

function parseUrl(value: string, allowPath: boolean): URL {
  try {
    const normalized = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(normalized);
    const mayUseHttp = process.env.NODE_ENV !== 'production' && isLoopback(url.hostname);
    if (url.protocol !== 'https:' && !mayUseHttp) {
      throw new LiheConfigurationError();
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new LiheConfigurationError();
    }
    if (!allowPath && url.pathname !== '/' && url.pathname !== '') {
      throw new LiheConfigurationError();
    }
    return url;
  } catch {
    throw new LiheConfigurationError();
  }
}

function parseProviders(rawProviders: string | undefined): TLiheProvider[] {
  const values = (rawProviders ?? `${EModelEndpoint.openAI},${EModelEndpoint.anthropic}`)
    .split(',')
    .map((provider) => provider.trim())
    .filter(Boolean);
  const providers = [...new Set(values)];
  if (
    providers.length === 0 ||
    providers.some((provider) => !SUPPORTED_PROVIDERS.has(provider as TLiheProvider))
  ) {
    throw new LiheConfigurationError();
  }
  return providers as TLiheProvider[];
}

function childUrl(baseUrl: URL, path: string): URL {
  const base = new URL(baseUrl);
  if (!base.pathname.endsWith('/')) {
    base.pathname += '/';
  }
  return new URL(path, base);
}

export function getLiheConfig(): LiheConfig | null {
  if (!isEnabled(process.env.LIHE_CONNECT_ENABLED)) {
    return null;
  }

  const apiBase = process.env.LIHE_CONNECT_API_BASE_URL?.trim();
  const clientId = process.env.LIHE_CONNECT_CLIENT_ID?.trim();
  const clientSecret = process.env.LIHE_CONNECT_CLIENT_SECRET?.trim();
  const stateSecret = process.env.JWT_SECRET?.trim();
  const domainServer = process.env.DOMAIN_SERVER?.trim();
  if (!apiBase || !clientId || !clientSecret || !stateSecret || !domainServer) {
    throw new LiheConfigurationError();
  }

  const apiBaseUrl = parseUrl(apiBase, true);
  const serverUrl = parseUrl(domainServer, true);
  const basePath = getBasePath();
  const callbackUrl = new URL(`${basePath}${LIHE_CALLBACK_ROUTE}`, serverUrl.origin);

  return {
    apiBaseUrl,
    authorizationUrl: childUrl(apiBaseUrl, 'oauth/authorize'),
    selectionUrl: childUrl(apiBaseUrl, 'integrations/lihe'),
    tokenUrl: childUrl(apiBaseUrl, 'oauth/token'),
    revokeUrl: childUrl(apiBaseUrl, 'oauth/revoke'),
    modelsUrl: childUrl(apiBaseUrl, 'v1/models'),
    callbackUrl,
    clientId,
    clientSecret,
    stateSecret,
    scope: 'models:read chat:write',
    providers: parseProviders(process.env.LIHE_CONNECT_PROVIDERS),
    requireOpenIdSubject: isEnabled(process.env.LIHE_CONNECT_REQUIRE_OPENID_SUBJECT),
    cookiePath: `${basePath}${LIHE_COOKIE_ROUTE}`,
    resultPath: `${basePath}${LIHE_RESULT_ROUTE}`,
  };
}
