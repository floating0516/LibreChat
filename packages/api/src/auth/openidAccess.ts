import { isEnabled } from '~/utils/common';

const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type OpenIdAccessUser = {
  email?: unknown;
  emailVerified?: unknown;
};

export function normalizeOpenIdAccessEmail(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_EMAIL_LENGTH ||
    !EMAIL_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function getHiddenTestAllowedEmails(): Set<string> {
  return new Set(
    (process.env.OPENID_HIDDEN_TEST_ALLOWED_EMAILS ?? '')
      .split(',')
      .map(normalizeOpenIdAccessEmail)
      .filter((email): email is string => email != null),
  );
}

export function isOpenIdConfigurationComplete(): boolean {
  const hasClientAuthentication =
    isEnabled(process.env.OPENID_USE_PKCE) || !!process.env.OPENID_CLIENT_SECRET?.trim();
  return (
    !!process.env.OPENID_CLIENT_ID?.trim() &&
    hasClientAuthentication &&
    !!process.env.OPENID_ISSUER?.trim() &&
    !!process.env.OPENID_SCOPE?.trim() &&
    !!process.env.OPENID_SESSION_SECRET?.trim()
  );
}

export function isOpenIdHiddenTestModeEnabled(): boolean {
  return (
    !isEnabled(process.env.ALLOW_SOCIAL_LOGIN) &&
    isEnabled(process.env.OPENID_HIDDEN_TEST_MODE) &&
    getHiddenTestAllowedEmails().size > 0
  );
}

export function isOpenIdPublicLoginEnabled(): boolean {
  return isEnabled(process.env.ALLOW_SOCIAL_LOGIN) && isOpenIdConfigurationComplete();
}

export function isOpenIdLoginRuntimeEnabled(): boolean {
  return (
    isOpenIdConfigurationComplete() &&
    (isEnabled(process.env.ALLOW_SOCIAL_LOGIN) || isOpenIdHiddenTestModeEnabled())
  );
}

export function isOpenIdHiddenTestEmailAllowed(email: unknown): boolean {
  const normalized = normalizeOpenIdAccessEmail(email);
  return (
    isOpenIdHiddenTestModeEnabled() &&
    normalized != null &&
    getHiddenTestAllowedEmails().has(normalized)
  );
}

export function isOpenIdHiddenTestUserAllowed(user: OpenIdAccessUser | null | undefined): boolean {
  return user?.emailVerified === true && isOpenIdHiddenTestEmailAllowed(user.email);
}

export function isOpenIdLoginUserAllowed(email: unknown, emailVerified: unknown): boolean {
  if (!isOpenIdLoginRuntimeEnabled()) {
    return false;
  }
  if (isEnabled(process.env.ALLOW_SOCIAL_LOGIN)) {
    return true;
  }
  return emailVerified === true && isOpenIdHiddenTestEmailAllowed(email);
}
