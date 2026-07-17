import { tenantStorage, logger } from '@librechat/data-schemas';
import { setOAuthCsrfCookie, validateOAuthCsrf, validateOAuthSession } from '~/oauth';
import { liheStartRequestSchema } from 'librechat-data-provider';
import type { Request, Response } from 'express';
import type { TLiheStartRequest, TLiheConnectionStatus } from 'librechat-data-provider';
import type { FlowStateManager } from '~/flow/manager';
import type { LiheKeyDependencies } from './storage';
import type { LiheFetch } from './client';
import type { LiheConfig } from './config';
import {
  loadLiheConnection,
  saveLiheConnection,
  getLiheConnectionStatus,
  disconnectLiheConnection,
} from './storage';
import { createLihePkce, signLiheState, verifyLiheState } from './security';
import { exchangeLiheCode, validateLiheToken, revokeLiheToken, LiheRemoteError } from './client';
import { LIHE_FLOW_TYPE, getLiheConfig, LiheConfigurationError } from './config';

const MAX_FLOW_AGE_MS = 10 * 60 * 1000;
const MAX_AUTHORIZATION_CODE_LENGTH = 2048;

type LiheFlowManager = Pick<FlowStateManager<null>, 'initFlow' | 'getFlowState' | 'deleteFlow'>;

type LiheUser = {
  id?: string;
  tenantId?: string;
};

interface LiheAuthenticatedRequest extends Request {
  user?: LiheUser;
  body: TLiheStartRequest;
}

type LiheFlowMetadata = {
  userId: string;
  tenantId?: string;
  codeVerifier: string;
};

type CallbackError =
  | 'access_denied'
  | 'callback_failed'
  | 'feature_unavailable'
  | 'flow_expired'
  | 'invalid_state'
  | 'token_exchange_failed'
  | 'token_revocation_failed'
  | 'token_validation_failed'
  | 'unsupported_provider';

export type LiheHandlerDependencies = LiheKeyDependencies & {
  flowManager: LiheFlowManager;
  fetcher?: LiheFetch;
};

class LiheCallbackError extends Error {
  readonly code: CallbackError;

  constructor(code: CallbackError) {
    super(code);
    this.name = 'LiheCallbackError';
    this.code = code;
  }
}

function queryString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function parseFlowMetadata(metadata: { [key: string]: unknown }): LiheFlowMetadata | null {
  const { userId, tenantId, codeVerifier } = metadata;
  if (typeof userId !== 'string' || !userId || typeof codeVerifier !== 'string') {
    return null;
  }
  if (codeVerifier.length < 43 || codeVerifier.length > 128) {
    return null;
  }
  if (tenantId != null && typeof tenantId !== 'string') {
    return null;
  }
  return {
    userId,
    tenantId: typeof tenantId === 'string' ? tenantId : undefined,
    codeVerifier,
  };
}

function callbackErrorCode(error: unknown): CallbackError {
  if (error instanceof LiheCallbackError || error instanceof LiheRemoteError) {
    return error.code;
  }
  if (error instanceof LiheConfigurationError) {
    return 'feature_unavailable';
  }
  return 'callback_failed';
}

function resultUrl(
  resultPath: string,
  result: 'connected' | 'error',
  error?: CallbackError,
): string {
  const params = new URLSearchParams({ result });
  if (error) {
    params.set('error', error);
  }
  return `${resultPath}?${params.toString()}`;
}

function unavailableStatus(): TLiheConnectionStatus {
  return {
    enabled: false,
    connected: false,
    needsReconnect: false,
    hasExistingKeys: false,
    providers: [],
  };
}

function hasExactScopes(granted: string, required: string): boolean {
  const grantedScopes = new Set(granted.split(/\s+/).filter(Boolean));
  const requiredScopes = required.split(/\s+/).filter(Boolean);
  return (
    grantedScopes.size === requiredScopes.length &&
    requiredScopes.every((scope) => grantedScopes.has(scope))
  );
}

export function createLiheHandlers(deps: LiheHandlerDependencies): {
  status: (req: LiheAuthenticatedRequest, res: Response) => Promise<void>;
  start: (req: LiheAuthenticatedRequest, res: Response) => Promise<void>;
  callback: (req: Request, res: Response) => Promise<void>;
  disconnect: (req: LiheAuthenticatedRequest, res: Response) => Promise<void>;
} {
  async function status(req: LiheAuthenticatedRequest, res: Response): Promise<void> {
    try {
      const config = getLiheConfig();
      if (!config) {
        res.status(200).json(unavailableStatus());
        return;
      }
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const connectionStatus = await getLiheConnectionStatus({
        deps,
        userId,
        configuredProviders: config.providers,
      });
      res.status(200).json({
        enabled: true,
        selectionUrl: config.selectionUrl.href,
        ...connectionStatus,
      });
    } catch (error) {
      if (error instanceof LiheConfigurationError) {
        logger.error('[Lihe Connect] Invalid server configuration');
        res.status(200).json(unavailableStatus());
        return;
      }
      logger.error('[Lihe Connect] Failed to load connection status', error);
      res.status(500).json({ error: 'status_failed' });
    }
  }

  async function start(req: LiheAuthenticatedRequest, res: Response): Promise<void> {
    try {
      const config = getLiheConfig();
      const userId = req.user?.id;
      if (!config) {
        res.status(404).json({ error: 'feature_disabled' });
        return;
      }
      if (!userId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }

      const parsedRequest = liheStartRequestSchema.safeParse(req.body);
      if (!parsedRequest.success) {
        res.status(400).json({ error: 'invalid_request' });
        return;
      }

      const connectionStatus = await getLiheConnectionStatus({
        deps,
        userId,
        configuredProviders: config.providers,
      });
      const { apiKeyId, replaceExisting = false } = parsedRequest.data;
      if (connectionStatus.connected && !replaceExisting) {
        res.status(409).json({ error: 'already_connected' });
        return;
      }
      if (connectionStatus.hasExistingKeys && !replaceExisting) {
        res.status(409).json({ error: 'confirmation_required' });
        return;
      }

      const pkce = createLihePkce();
      const state = signLiheState(pkce.flowId, config.stateSecret);
      await deps.flowManager.initFlow(pkce.flowId, LIHE_FLOW_TYPE, {
        userId,
        tenantId: req.user?.tenantId,
        codeVerifier: pkce.verifier,
      });
      setOAuthCsrfCookie(res, pkce.flowId, config.cookiePath);

      const authorizationUrl = new URL(config.authorizationUrl);
      authorizationUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.callbackUrl.href,
        scope: config.scope,
        state,
        code_challenge: pkce.challenge,
        code_challenge_method: 'S256',
        api_key_id: apiKeyId,
      }).toString();
      res.status(200).json({ authorizationUrl: authorizationUrl.href });
    } catch (error) {
      if (error instanceof LiheConfigurationError) {
        logger.error('[Lihe Connect] Invalid server configuration');
        res.status(503).json({ error: 'feature_unavailable' });
        return;
      }
      logger.error('[Lihe Connect] Failed to start authorization', error);
      res.status(500).json({ error: 'start_failed' });
    }
  }

  async function callback(req: Request, res: Response): Promise<void> {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    let flowId: string | null = null;
    let issuedToken: string | null = null;
    let tokenStored = false;
    let config: LiheConfig | null | undefined;

    try {
      config = getLiheConfig();
      if (!config) {
        throw new LiheCallbackError('feature_unavailable');
      }

      const state = queryString(req.query.state);
      flowId = state ? verifyLiheState(state, config.stateSecret) : null;
      if (!flowId) {
        throw new LiheCallbackError('invalid_state');
      }

      const flowState = await deps.flowManager.getFlowState(flowId, LIHE_FLOW_TYPE);
      if (
        !flowState ||
        flowState.status !== 'PENDING' ||
        Date.now() - flowState.createdAt > MAX_FLOW_AGE_MS
      ) {
        throw new LiheCallbackError('flow_expired');
      }
      const metadata = parseFlowMetadata(flowState.metadata);
      if (!metadata) {
        throw new LiheCallbackError('invalid_state');
      }
      const csrfValid = validateOAuthCsrf(req, res, flowId, config.cookiePath);
      if (!csrfValid && !validateOAuthSession(req, metadata.userId)) {
        throw new LiheCallbackError('invalid_state');
      }
      if (queryString(req.query.error)) {
        throw new LiheCallbackError('access_denied');
      }

      const code = queryString(req.query.code);
      if (!code || code.length > MAX_AUTHORIZATION_CODE_LENGTH) {
        throw new LiheCallbackError('token_exchange_failed');
      }
      const tokenResponse = await exchangeLiheCode({
        config,
        code,
        verifier: metadata.codeVerifier,
        fetcher: deps.fetcher,
      });
      issuedToken = tokenResponse.access_token;
      for (const provider of tokenResponse.providers) {
        if (!config.providers.includes(provider)) {
          throw new LiheCallbackError('unsupported_provider');
        }
      }
      if (!hasExactScopes(tokenResponse.scope, config.scope)) {
        throw new LiheCallbackError('token_validation_failed');
      }
      await validateLiheToken({ config, token: issuedToken, fetcher: deps.fetcher });

      const saved = await tenantStorage.run(
        { tenantId: metadata.tenantId, userId: metadata.userId },
        () =>
          saveLiheConnection({
            deps,
            userId: metadata.userId,
            tokenResponse,
          }),
      );
      tokenStored = true;
      if (saved.replacedToken && saved.replacedToken !== issuedToken) {
        try {
          await revokeLiheToken({
            config,
            token: saved.replacedToken,
            fetcher: deps.fetcher,
          });
        } catch {
          logger.warn('[Lihe Connect] Previous integration token could not be revoked');
        }
      }
      res.redirect(resultUrl(config.resultPath, 'connected'));
    } catch (error) {
      const code = callbackErrorCode(error);
      if (issuedToken && !tokenStored && config) {
        try {
          await revokeLiheToken({ config, token: issuedToken, fetcher: deps.fetcher });
        } catch {
          logger.warn('[Lihe Connect] Rejected integration token could not be revoked');
        }
      }
      logger.warn('[Lihe Connect] Authorization callback failed', { code });
      const path = config?.resultPath ?? '/connect/lihe';
      res.redirect(resultUrl(path, 'error', code));
    } finally {
      if (flowId) {
        await deps.flowManager.deleteFlow(flowId, LIHE_FLOW_TYPE).catch(() => undefined);
      }
    }
  }

  async function disconnect(req: LiheAuthenticatedRequest, res: Response): Promise<void> {
    try {
      const config = getLiheConfig();
      const userId = req.user?.id;
      if (!config) {
        res.status(404).json({ error: 'feature_disabled' });
        return;
      }
      if (!userId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const connection = await loadLiheConnection(deps, userId);
      if (!connection) {
        res.status(200).json({
          disconnected: true,
          restoredProviders: [],
          preservedProviders: [],
        });
        return;
      }
      await revokeLiheToken({
        config,
        token: connection.accessToken,
        fetcher: deps.fetcher,
      });
      const result = await disconnectLiheConnection({ deps, userId, connection });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof LiheRemoteError) {
        res.status(502).json({ error: error.code });
        return;
      }
      if (error instanceof LiheConfigurationError) {
        res.status(503).json({ error: 'feature_unavailable' });
        return;
      }
      logger.error('[Lihe Connect] Failed to disconnect integration', error);
      res.status(500).json({ error: 'disconnect_failed' });
    }
  }

  return { status, start, callback, disconnect };
}
