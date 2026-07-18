import {
  isOpenIdConfigurationComplete,
  isOpenIdHiddenTestEmailAllowed,
  isOpenIdHiddenTestModeEnabled,
  isOpenIdHiddenTestUserAllowed,
  isOpenIdLoginRuntimeEnabled,
  isOpenIdLoginUserAllowed,
  isOpenIdPublicLoginEnabled,
  normalizeOpenIdAccessEmail,
} from './openidAccess';

describe('OpenID hidden test access', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.OPENID_CLIENT_ID = 'lihe-chat-login';
    process.env.OPENID_CLIENT_SECRET = 'client-secret';
    process.env.OPENID_ISSUER = 'https://api.lihe.chat';
    process.env.OPENID_SCOPE = 'openid profile email';
    process.env.OPENID_SESSION_SECRET = 'session-secret';
    process.env.OPENID_USE_PKCE = 'true';
    process.env.ALLOW_SOCIAL_LOGIN = 'false';
    delete process.env.OPENID_HIDDEN_TEST_MODE;
    delete process.env.OPENID_HIDDEN_TEST_ALLOWED_EMAILS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('normalizes valid emails and rejects malformed allowlist entries', () => {
    expect(normalizeOpenIdAccessEmail(' Test@Example.COM ')).toBe('test@example.com');
    expect(normalizeOpenIdAccessEmail('not-an-email')).toBeNull();
    expect(normalizeOpenIdAccessEmail('')).toBeNull();
    expect(normalizeOpenIdAccessEmail(null)).toBeNull();
  });

  it('fails closed when hidden mode has no valid allowlisted email', () => {
    process.env.OPENID_HIDDEN_TEST_MODE = 'true';
    process.env.OPENID_HIDDEN_TEST_ALLOWED_EMAILS = 'invalid,also-invalid';

    expect(isOpenIdConfigurationComplete()).toBe(true);
    expect(isOpenIdHiddenTestModeEnabled()).toBe(false);
    expect(isOpenIdLoginRuntimeEnabled()).toBe(false);
    expect(isOpenIdLoginUserAllowed('test@example.com', true)).toBe(false);
  });

  it('allows only a verified allowlisted user while the public login is hidden', () => {
    process.env.OPENID_HIDDEN_TEST_MODE = 'true';
    process.env.OPENID_HIDDEN_TEST_ALLOWED_EMAILS =
      'allowed@example.com, SECOND@example.com,invalid';

    expect(isOpenIdHiddenTestModeEnabled()).toBe(true);
    expect(isOpenIdLoginRuntimeEnabled()).toBe(true);
    expect(isOpenIdPublicLoginEnabled()).toBe(false);
    expect(isOpenIdHiddenTestEmailAllowed('Allowed@Example.COM')).toBe(true);
    expect(isOpenIdHiddenTestEmailAllowed('other@example.com')).toBe(false);
    expect(
      isOpenIdHiddenTestUserAllowed({ email: 'allowed@example.com', emailVerified: true }),
    ).toBe(true);
    expect(
      isOpenIdHiddenTestUserAllowed({ email: 'allowed@example.com', emailVerified: false }),
    ).toBe(false);
    expect(isOpenIdLoginUserAllowed('allowed@example.com', true)).toBe(true);
    expect(isOpenIdLoginUserAllowed('allowed@example.com', false)).toBe(false);
    expect(isOpenIdLoginUserAllowed('other@example.com', true)).toBe(false);
  });

  it('preserves normal public OpenID behavior when social login is enabled', () => {
    process.env.ALLOW_SOCIAL_LOGIN = 'true';
    process.env.OPENID_HIDDEN_TEST_MODE = 'true';
    process.env.OPENID_HIDDEN_TEST_ALLOWED_EMAILS = 'allowed@example.com';

    expect(isOpenIdHiddenTestModeEnabled()).toBe(false);
    expect(isOpenIdPublicLoginEnabled()).toBe(true);
    expect(isOpenIdLoginRuntimeEnabled()).toBe(true);
    expect(isOpenIdLoginUserAllowed('other@example.com', false)).toBe(true);
  });

  it('does not initialize when the OpenID client configuration is incomplete', () => {
    process.env.OPENID_HIDDEN_TEST_MODE = 'true';
    process.env.OPENID_HIDDEN_TEST_ALLOWED_EMAILS = 'allowed@example.com';
    delete process.env.OPENID_SESSION_SECRET;

    expect(isOpenIdConfigurationComplete()).toBe(false);
    expect(isOpenIdLoginRuntimeEnabled()).toBe(false);
  });
});
