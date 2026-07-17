const express = require('express');
const request = require('supertest');

const originalDomainClient = process.env.DOMAIN_CLIENT;
const originalAllowSocialLogin = process.env.ALLOW_SOCIAL_LOGIN;
process.env.DOMAIN_CLIENT = 'http://client.test';

const mockLogger = {
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

const mockOAuthHandler = jest.fn((_req, res) => res.status(204).end());
const mockOpenIDCallbackMiddleware = jest.fn((_req, _res, next) => next());
let mockOpenIDCallbackAuthenticatorOptions = {};
const mockCreateOpenIDCallbackAuthenticator = jest.fn((options) => {
  mockOpenIDCallbackAuthenticatorOptions[options.strategy ?? 'openid'] = options;
  return mockOpenIDCallbackMiddleware;
});
const mockBuildOAuthFailureLog = jest.fn(({ provider, req, err, info, defaultMessage }) => ({
  provider,
  code: err?.code ?? info?.code ?? info?.error ?? req.query?.error,
  name: err?.name ?? info?.name,
  message:
    err?.message ??
    info?.message ??
    info?.error_description ??
    req.query?.error_description ??
    defaultMessage,
  cause_code: err?.cause?.code ?? info?.cause?.code,
  cause_name: err?.cause?.name ?? info?.cause?.name,
  has_code: req.query?.code != null,
  has_state: req.query?.state != null,
  query_error: req.query?.error,
  query_error_description: req.query?.error_description,
  path: req.path,
  forwarded_for: req.headers?.['x-forwarded-for'],
  user_agent: req.headers?.['user-agent'],
}));
const mockGetOAuthFailureMessage = jest.fn(
  (req) =>
    req.session?.messages?.pop() ??
    req.query?.error_description ??
    req.query?.error ??
    'OAuth authentication failed',
);
const mockRedirectToAuthFailure = jest.fn((res, { clientDomain, authFailedError }) =>
  res.redirect(`${clientDomain}/login?redirect=false&error=${authFailedError}`),
);
const mockPassportAuthenticate = jest.fn(() => (_req, _res, next) => next());
const mockHasOpenIdAccountLinkIntent = jest.fn(() => false);
const mockIsOpenIdAccountLinkingEnabled = jest.fn(() => false);
const mockIsEnabled = jest.fn((value) => value === 'true');

jest.mock('passport', () => ({
  authenticate: (...args) => mockPassportAuthenticate(...args),
}));

jest.mock('openid-client', () => ({
  randomState: jest.fn(() => 'random-state'),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: mockLogger,
}));

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  ErrorTypes: {
    AUTH_FAILED: 'auth_failed',
  },
}));

jest.mock('@librechat/api', () => ({
  buildOAuthFailureLog: (...args) => mockBuildOAuthFailureLog(...args),
  createOpenIDCallbackAuthenticator: (...args) => mockCreateOpenIDCallbackAuthenticator(...args),
  createSetBalanceConfig: jest.fn(() => (_req, _res, next) => next()),
  getOAuthFailureMessage: (...args) => mockGetOAuthFailureMessage(...args),
  hasOpenIdAccountLinkIntent: (...args) => mockHasOpenIdAccountLinkIntent(...args),
  isEnabled: (...args) => mockIsEnabled(...args),
  isOpenIdAccountLinkingEnabled: (...args) => mockIsOpenIdAccountLinkingEnabled(...args),
  OPENID_LINK_RESULT_PATH: '/connect/lihe-account',
  redirectToAuthFailure: (...args) => mockRedirectToAuthFailure(...args),
}));

jest.mock('~/server/middleware', () => ({
  checkDomainAllowed: jest.fn((_req, _res, next) => next()),
  loginLimiter: jest.fn((_req, _res, next) => next()),
  logHeaders: jest.fn((_req, _res, next) => next()),
}));

jest.mock('~/server/controllers/auth/oauth', () => ({
  createOAuthHandler: jest.fn(() => mockOAuthHandler),
}));

jest.mock('~/models', () => ({
  findBalanceByUser: jest.fn(),
  upsertBalanceFields: jest.fn(),
}));

jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn(),
}));

afterAll(() => {
  if (originalAllowSocialLogin === undefined) {
    delete process.env.ALLOW_SOCIAL_LOGIN;
  } else {
    process.env.ALLOW_SOCIAL_LOGIN = originalAllowSocialLogin;
  }
  if (originalDomainClient === undefined) {
    delete process.env.DOMAIN_CLIENT;
    return;
  }
  process.env.DOMAIN_CLIENT = originalDomainClient;
});

function getOAuthRouter() {
  jest.resetModules();
  return require('./oauth');
}

function createApp(sessionMessages) {
  const app = express();
  app.use((req, _res, next) => {
    if (sessionMessages) {
      req.session = { messages: [...sessionMessages] };
    }
    next();
  });
  app.use('/oauth', getOAuthRouter());
  app.use((err, _req, res, _next) => {
    res.status(500).json({ message: err.message });
  });
  return app;
}

describe('OAuth route failure logging', () => {
  beforeEach(() => {
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.info.mockClear();
    mockLogger.debug.mockClear();
    mockOAuthHandler.mockClear();
    mockOpenIDCallbackMiddleware.mockClear();
    mockBuildOAuthFailureLog.mockClear();
    mockGetOAuthFailureMessage.mockClear();
    mockRedirectToAuthFailure.mockClear();
    mockPassportAuthenticate.mockClear();
    mockHasOpenIdAccountLinkIntent.mockClear();
    mockIsOpenIdAccountLinkingEnabled.mockClear();
    mockIsEnabled.mockClear();
    mockOpenIDCallbackAuthenticatorOptions = {};
    process.env.ALLOW_SOCIAL_LOGIN = 'true';
    mockPassportAuthenticate.mockImplementation(() => (_req, _res, next) => next());
    mockOpenIDCallbackMiddleware.mockImplementation((_req, _res, next) => next());
  });

  it('wires the package OpenID callback middleware into the route', async () => {
    const app = createApp();

    await request(app)
      .get('/oauth/openid/callback?code=secret-code&state=secret-state')
      .expect(204);

    expect(mockOpenIDCallbackAuthenticatorOptions.openid).toEqual({
      passport: expect.objectContaining({ authenticate: expect.any(Function) }),
      logger: mockLogger,
      clientDomain: 'http://client.test',
      authFailedError: 'auth_failed',
    });
    expect(mockOpenIDCallbackMiddleware).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.any(Function),
    );
    expect(mockOAuthHandler).toHaveBeenCalled();
  });

  it('enforces the social-login switch on both OpenID entry points', async () => {
    process.env.ALLOW_SOCIAL_LOGIN = 'false';
    const app = createApp();

    const start = await request(app).get('/oauth/openid').expect(302);
    const callback = await request(app)
      .get('/oauth/openid/callback?code=secret-code&state=secret-state')
      .expect(302);

    expect(start.headers.location).toBe(
      'http://client.test/login?redirect=false&error=auth_failed',
    );
    expect(callback.headers.location).toBe(
      'http://client.test/login?redirect=false&error=auth_failed',
    );
    expect(callback.headers['cache-control']).toBe('no-store');
    expect(callback.headers['referrer-policy']).toBe('no-referrer');
    expect(mockPassportAuthenticate).not.toHaveBeenCalledWith('openid', expect.anything());
    expect(mockOpenIDCallbackMiddleware).not.toHaveBeenCalled();
  });

  it('logs structured fallback errors without using Unknown OAuth error', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/oauth/error?error=access_denied&error_description=Denied%20by%20provider')
      .set('x-forwarded-for', '203.0.113.10')
      .expect(302);

    expect(response.headers.location).toBe(
      'http://client.test/login?redirect=false&error=auth_failed',
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      '[OAuth] Authentication failed',
      expect.objectContaining({
        provider: 'unknown',
        code: 'access_denied',
        message: 'Denied by provider',
        query_error: 'access_denied',
        query_error_description: 'Denied by provider',
        has_code: false,
        has_state: false,
        forwarded_for: '203.0.113.10',
      }),
    );
    expect(JSON.stringify(mockLogger.warn.mock.calls[0])).not.toContain('Unknown OAuth error');
  });
});
