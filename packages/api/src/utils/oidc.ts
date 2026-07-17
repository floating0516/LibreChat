import { logger } from '@librechat/data-schemas';
import type { IUser, OIDCTokens } from '@librechat/data-schemas';

export interface OpenIDTokenInfo {
  accessToken?: string;
  idToken?: string;
  expiresAt?: number;
  userId?: string;
  userEmail?: string;
  userName?: string;
  claims?: Record<string, unknown>;
}

export type OpenIDTokenEndpointAuthMethod = 'client_secret_basic' | 'client_secret_post' | 'none';

export type ResolveOpenIDTokenEndpointAuthMethodOptions = {
  configuredMethod?: string;
  clientSecret?: string;
  usePKCE: boolean;
  generateNonce: boolean;
};

const OPENID_TOKEN_ENDPOINT_AUTH_METHODS = new Set<OpenIDTokenEndpointAuthMethod>([
  'client_secret_basic',
  'client_secret_post',
  'none',
]);

const OPENID_LOG_SENSITIVE_FIELDS = new Set([
  'access_token',
  'assertion',
  'client_secret',
  'code',
  'code_verifier',
  'id_token',
  'nonce',
  'refresh_token',
  'state',
  'token',
]);

function sanitizeOpenIdSearchParams(params: URLSearchParams): URLSearchParams {
  const sanitized = new URLSearchParams(params);
  for (const key of [...sanitized.keys()]) {
    if (OPENID_LOG_SENSITIVE_FIELDS.has(key.toLowerCase())) {
      sanitized.set(key, '[REDACTED]');
    }
  }
  return sanitized;
}

export function sanitizeOpenIdUrlForLogging(value: string | URL): string {
  try {
    const url = new URL(value.toString());
    url.search = sanitizeOpenIdSearchParams(url.searchParams).toString();
    return url.toString();
  } catch {
    return '[invalid OpenID URL]';
  }
}

export function sanitizeOpenIdRequestBodyForLogging(body: unknown): string {
  if (body instanceof URLSearchParams) {
    return sanitizeOpenIdSearchParams(body).toString();
  }
  return '[request body omitted]';
}

export function resolveOpenIDTokenEndpointAuthMethod({
  configuredMethod,
  clientSecret,
  usePKCE,
  generateNonce,
}: ResolveOpenIDTokenEndpointAuthMethodOptions): OpenIDTokenEndpointAuthMethod | undefined {
  const secret = clientSecret?.trim();
  const requestedMethod = configuredMethod?.trim();

  if (requestedMethod) {
    if (!OPENID_TOKEN_ENDPOINT_AUTH_METHODS.has(requestedMethod as OpenIDTokenEndpointAuthMethod)) {
      throw new Error(`Unsupported OpenID token endpoint auth method: ${requestedMethod}`);
    }

    const method = requestedMethod as OpenIDTokenEndpointAuthMethod;
    if (method === 'none' && secret) {
      throw new Error('OpenID token endpoint auth method "none" cannot use a client secret');
    }
    if (method === 'none' && !usePKCE) {
      throw new Error('OpenID token endpoint auth method "none" requires PKCE');
    }
    if (method !== 'none' && !secret) {
      throw new Error(`OpenID token endpoint auth method "${method}" requires a client secret`);
    }
    return method;
  }

  if (!secret && usePKCE) {
    return 'none';
  }
  if (secret && generateNonce) {
    return 'client_secret_post';
  }
  return undefined;
}

function isFederatedTokens(obj: unknown): obj is OIDCTokens {
  if (!obj || typeof obj !== 'object') {
    return false;
  }
  return 'access_token' in obj || 'id_token' in obj || 'expires_at' in obj;
}

const OPENID_TOKEN_FIELDS = [
  'ACCESS_TOKEN',
  'ID_TOKEN',
  'USER_ID',
  'USER_EMAIL',
  'USER_NAME',
  'EXPIRES_AT',
] as const;

/**
 * Placeholder for Microsoft Graph API access token.
 * This placeholder is resolved asynchronously via OBO (On-Behalf-Of) flow
 * and requires special handling outside the synchronous processMCPEnv pipeline.
 */
export const GRAPH_TOKEN_PLACEHOLDER = '{{LIBRECHAT_GRAPH_ACCESS_TOKEN}}';

/**
 * Default Microsoft Graph API scopes for OBO token exchange.
 * Can be overridden via GRAPH_API_SCOPES environment variable.
 */
export const DEFAULT_GRAPH_SCOPES = 'https://graph.microsoft.com/.default';

export function extractOpenIDTokenInfo(
  user: Partial<IUser> | null | undefined,
): OpenIDTokenInfo | null {
  if (!user) {
    return null;
  }

  try {
    if (user.provider !== 'openid' && !user.openidId) {
      return null;
    }

    const tokenInfo: OpenIDTokenInfo = {};

    const federated = user.federatedTokens;
    const openid = user.openidTokens;

    if (federated && isFederatedTokens(federated)) {
      logger.debug('[extractOpenIDTokenInfo] Found federatedTokens:', {
        has_access_token: !!federated.access_token,
        has_id_token: !!federated.id_token,
        has_refresh_token: !!federated.refresh_token,
        expires_at: federated.expires_at,
      });
      tokenInfo.accessToken = federated.access_token;
      tokenInfo.idToken = federated.id_token;
      tokenInfo.expiresAt = federated.expires_at;
    } else if (openid && isFederatedTokens(openid)) {
      logger.debug('[extractOpenIDTokenInfo] Found openidTokens');
      tokenInfo.accessToken = openid.access_token;
      tokenInfo.idToken = openid.id_token;
      tokenInfo.expiresAt = openid.expires_at;
    }

    tokenInfo.userId = user.openidId || user.id;
    tokenInfo.userEmail = user.email;
    tokenInfo.userName = user.name || user.username;

    if (tokenInfo.idToken) {
      try {
        const payload = JSON.parse(
          Buffer.from(tokenInfo.idToken.split('.')[1], 'base64').toString(),
        );
        tokenInfo.claims = payload;

        if (payload.sub) tokenInfo.userId = payload.sub;
        if (payload.email) tokenInfo.userEmail = payload.email;
        if (payload.name) tokenInfo.userName = payload.name;
        if (payload.exp) tokenInfo.expiresAt = payload.exp;
      } catch (jwtError) {
        logger.warn('Could not parse ID token claims:', jwtError);
      }
    }

    return tokenInfo;
  } catch (error) {
    logger.error('Error extracting OpenID token info:', error);
    return null;
  }
}

export function isOpenIDTokenValid(tokenInfo: OpenIDTokenInfo | null): boolean {
  if (!tokenInfo || !tokenInfo.accessToken) {
    return false;
  }

  if (tokenInfo.expiresAt) {
    const now = Math.floor(Date.now() / 1000);
    if (now >= tokenInfo.expiresAt) {
      logger.warn('OpenID token has expired');
      return false;
    }
  }

  return true;
}

export function processOpenIDPlaceholders(
  value: string,
  tokenInfo: OpenIDTokenInfo | null,
): string {
  if (!tokenInfo || typeof value !== 'string') {
    return value;
  }

  let processedValue = value;

  for (const field of OPENID_TOKEN_FIELDS) {
    const placeholder = `{{LIBRECHAT_OPENID_${field}}}`;
    if (!processedValue.includes(placeholder)) {
      continue;
    }

    let replacementValue = '';

    switch (field) {
      case 'ACCESS_TOKEN':
        replacementValue = tokenInfo.accessToken || '';
        break;
      case 'ID_TOKEN':
        replacementValue = tokenInfo.idToken || '';
        break;
      case 'USER_ID':
        replacementValue = tokenInfo.userId || '';
        break;
      case 'USER_EMAIL':
        replacementValue = tokenInfo.userEmail || '';
        break;
      case 'USER_NAME':
        replacementValue = tokenInfo.userName || '';
        break;
      case 'EXPIRES_AT':
        replacementValue = tokenInfo.expiresAt ? String(tokenInfo.expiresAt) : '';
        break;
    }

    processedValue = processedValue.replace(new RegExp(placeholder, 'g'), replacementValue);
  }

  const genericPlaceholder = '{{LIBRECHAT_OPENID_TOKEN}}';
  if (processedValue.includes(genericPlaceholder)) {
    const replacementValue = tokenInfo.accessToken || '';
    processedValue = processedValue.replace(new RegExp(genericPlaceholder, 'g'), replacementValue);
  }

  return processedValue;
}

export function createBearerAuthHeader(tokenInfo: OpenIDTokenInfo | null): string {
  if (!tokenInfo || !tokenInfo.accessToken) {
    return '';
  }

  return `Bearer ${tokenInfo.accessToken}`;
}

export function isOpenIDAvailable(): boolean {
  const openidClientId = process.env.OPENID_CLIENT_ID;
  const openidClientSecret = process.env.OPENID_CLIENT_SECRET;
  const openidIssuer = process.env.OPENID_ISSUER;

  return !!(openidClientId && openidClientSecret && openidIssuer);
}
