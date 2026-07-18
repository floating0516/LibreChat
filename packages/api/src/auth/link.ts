import { tenantStorage } from '@librechat/data-schemas';
import type { IUser, OpenIdIdentityMethods, UserMethods } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { OpenIdEmailClaims, OpenIdIssuerSource } from './openid';
import { isEnabled } from '~/utils/common';
import { getBasePath } from '~/utils/path';
import { getOpenIdIssuer } from './openid';
import {
  isOpenIdHiddenTestEmailAllowed,
  isOpenIdHiddenTestModeEnabled,
  isOpenIdHiddenTestUserAllowed,
  isOpenIdLoginRuntimeEnabled,
  normalizeOpenIdAccessEmail,
} from './openidAccess';

export const OPENID_LINK_START_PATH = '/oauth/openid/link';
export const OPENID_LINK_CALLBACK_PATH = '/oauth/openid/link/callback';
export const OPENID_LINK_RESULT_PATH = '/connect/lihe-account';

const OPENID_LINK_SESSION_KEY = 'librechatOpenIdLink';
const OPENID_LINK_MAX_AGE_MS = 10 * 60 * 1000;
const MAX_RETURN_TO_LENGTH = 2048;
const LOGIN_PATH_RE = /(?:^|\/)login(?:\/|$)/;

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint != null && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

type OpenIdLinkIntent = {
  userId: string;
  tenantId?: string;
  expectedEmail?: string;
  returnTo: string;
  createdAt: number;
};

type OpenIdLinkSession = Request['session'] & {
  [OPENID_LINK_SESSION_KEY]?: OpenIdLinkIntent;
};

type OpenIdLinkUser = {
  id?: string;
  tenantId?: string;
  email?: string;
  emailVerified?: boolean;
};

type OpenIdLinkRequest = Request & {
  user?: OpenIdLinkUser;
  body: { returnTo?: unknown };
  session: OpenIdLinkSession;
};

type OpenIdTokenSet = {
  claims: () => OpenIdEmailClaims;
};

export type OpenIdLinkErrorCode =
  | 'already_linked'
  | 'identity_in_use'
  | 'identity_retired'
  | 'invalid_identity'
  | 'link_expired'
  | 'link_unavailable'
  | 'user_not_found';

export class OpenIdLinkError extends Error {
  readonly code: OpenIdLinkErrorCode;

  constructor(code: OpenIdLinkErrorCode) {
    super(code);
    this.name = 'OpenIdLinkError';
    this.code = code;
  }
}

export function isOpenIdAccountLinkingConfigured(): boolean {
  return isEnabled(process.env.OPENID_ACCOUNT_LINKING_ENABLED) && isOpenIdLoginRuntimeEnabled();
}

export function isOpenIdAccountLinkingEnabled(user?: OpenIdLinkUser | null): boolean {
  if (!isOpenIdAccountLinkingConfigured()) {
    return false;
  }
  if (!isOpenIdHiddenTestModeEnabled()) {
    return true;
  }
  return isOpenIdHiddenTestUserAllowed(user);
}

export function isSafeOpenIdLinkReturnTo(value: string): boolean {
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.length > MAX_RETURN_TO_LENGTH ||
    hasControlCharacter(value)
  ) {
    return false;
  }

  try {
    const parsed = new URL(value, 'https://librechat.invalid');
    return parsed.origin === 'https://librechat.invalid' && !LOGIN_PATH_RE.test(parsed.pathname);
  } catch {
    return false;
  }
}

function getLinkIntent(req: Request): OpenIdLinkIntent | null {
  const session = (req as OpenIdLinkRequest).session;
  const intent = session?.[OPENID_LINK_SESSION_KEY];
  if (
    !intent ||
    typeof intent.userId !== 'string' ||
    !intent.userId ||
    (intent.tenantId != null && typeof intent.tenantId !== 'string') ||
    (intent.expectedEmail != null &&
      normalizeOpenIdAccessEmail(intent.expectedEmail) !== intent.expectedEmail) ||
    typeof intent.createdAt !== 'number' ||
    !Number.isFinite(intent.createdAt) ||
    typeof intent.returnTo !== 'string' ||
    !isSafeOpenIdLinkReturnTo(intent.returnTo)
  ) {
    return null;
  }
  if (Date.now() - intent.createdAt > OPENID_LINK_MAX_AGE_MS) {
    return null;
  }
  return intent;
}

function saveSession(session: OpenIdLinkSession): Promise<void> {
  return new Promise((resolve, reject) => {
    session.save((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function hasOpenIdAccountLinkIntent(req: Request): boolean {
  return getLinkIntent(req) != null;
}

export function createOpenIdLinkStartHandler({
  getUserById,
}: Pick<UserMethods, 'getUserById'>): (req: OpenIdLinkRequest, res: Response) => Promise<void> {
  return async (req: OpenIdLinkRequest, res: Response): Promise<void> => {
    if (!isOpenIdAccountLinkingConfigured() || !req.session) {
      res.status(404).json({ error: 'feature_disabled' });
      return;
    }

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const requestedReturnTo = req.body?.returnTo;
    const returnTo =
      requestedReturnTo === undefined
        ? `${getBasePath()}${OPENID_LINK_RESULT_PATH}?result=connected`
        : requestedReturnTo;
    if (typeof returnTo !== 'string' || !isSafeOpenIdLinkReturnTo(returnTo)) {
      res.status(400).json({ error: 'invalid_return_to' });
      return;
    }

    const user = await getUserById(userId, '_id openidId tenantId email emailVerified');
    if (!user) {
      res.status(404).json({ error: 'user_not_found' });
      return;
    }
    if (!isOpenIdAccountLinkingEnabled(user)) {
      res.status(404).json({ error: 'feature_disabled' });
      return;
    }
    if (user.openidId) {
      res.status(409).json({ error: 'already_linked' });
      return;
    }

    const expectedEmail = isOpenIdHiddenTestModeEnabled()
      ? normalizeOpenIdAccessEmail(user.email)
      : null;
    req.session[OPENID_LINK_SESSION_KEY] = {
      userId,
      tenantId: user.tenantId,
      ...(expectedEmail ? { expectedEmail } : {}),
      returnTo,
      createdAt: Date.now(),
    };
    await saveSession(req.session);
    res.status(200).json({
      authorizationUrl: `${getBasePath()}${OPENID_LINK_START_PATH}`,
    });
  };
}

export function assertOpenIdLinkIdentityAllowed(req: Request, tokenset: OpenIdTokenSet): void {
  if (!isOpenIdHiddenTestModeEnabled()) {
    return;
  }
  const intent = getLinkIntent(req);
  const claims = tokenset.claims();
  const email = normalizeOpenIdAccessEmail(claims.email);
  if (
    !intent?.expectedEmail ||
    claims.email_verified !== true ||
    email !== intent.expectedEmail ||
    !isOpenIdHiddenTestEmailAllowed(email)
  ) {
    throw new OpenIdLinkError('link_unavailable');
  }
}

export function resolveOpenIdLinkIdentity(
  tokenset: OpenIdTokenSet,
  config: OpenIdIssuerSource,
): { openidId: string; openidIssuer: string } {
  const claims = tokenset.claims();
  const openidId = typeof claims.sub === 'string' ? claims.sub : '';
  const openidIssuer = getOpenIdIssuer(
    { iss: typeof claims.iss === 'string' ? claims.iss : undefined },
    config,
  );
  if (!openidId || openidId.length > 256 || !openidIssuer) {
    throw new OpenIdLinkError('invalid_identity');
  }
  return { openidId, openidIssuer };
}

export async function completeOpenIdAccountLink({
  req,
  openidId,
  openidIssuer,
  linkOpenIdIdentity,
}: {
  req: Request;
  openidId: string;
  openidIssuer: string;
  linkOpenIdIdentity: OpenIdIdentityMethods['linkOpenIdIdentity'];
}): Promise<{ user: IUser; returnTo: string }> {
  if (!isOpenIdAccountLinkingConfigured()) {
    throw new OpenIdLinkError('link_unavailable');
  }

  const session = (req as OpenIdLinkRequest).session;
  const intent = getLinkIntent(req);
  if (session) {
    delete session[OPENID_LINK_SESSION_KEY];
    await saveSession(session);
  }
  if (!intent) {
    throw new OpenIdLinkError('link_expired');
  }

  const result = await tenantStorage.run({ tenantId: intent.tenantId, userId: intent.userId }, () =>
    linkOpenIdIdentity({
      userId: intent.userId,
      tenantId: intent.tenantId,
      openidId,
      openidIssuer,
    }),
  );

  if (result.status === 'linked' || result.status === 'already_linked') {
    return { user: result.user, returnTo: intent.returnTo };
  }
  if (result.status === 'identity_in_use') {
    throw new OpenIdLinkError('identity_in_use');
  }
  if (result.status === 'identity_retired') {
    throw new OpenIdLinkError('identity_retired');
  }
  if (result.status === 'user_already_linked') {
    throw new OpenIdLinkError('already_linked');
  }
  throw new OpenIdLinkError('user_not_found');
}
