import { getLiheConfig, LiheConfigurationError } from './config';

describe('Lihe Connect configuration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.LIHE_CONNECT_ENABLED = 'true';
    process.env.LIHE_CONNECT_API_BASE_URL = 'https://api.lihe.chat';
    process.env.LIHE_CONNECT_CLIENT_ID = 'lihe-chat';
    process.env.LIHE_CONNECT_CLIENT_SECRET = 'test-client-secret';
    process.env.LIHE_CONNECT_PROVIDERS = 'openAI,anthropic';
    process.env.JWT_SECRET = 'test-jwt-secret-that-is-long-enough';
    process.env.DOMAIN_CLIENT = 'https://lihe.chat';
    process.env.DOMAIN_SERVER = 'https://lihe.chat';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('stays unavailable when the feature flag is disabled', () => {
    process.env.LIHE_CONNECT_ENABLED = 'false';
    expect(getLiheConfig()).toBeNull();
  });

  it('builds the fixed OAuth endpoints and callback', () => {
    const config = getLiheConfig();
    expect(config).toMatchObject({
      clientId: 'lihe-chat',
      scope: 'models:read chat:write',
      providers: ['openAI', 'anthropic'],
    });
    expect(config?.authorizationUrl.href).toBe('https://api.lihe.chat/oauth/authorize');
    expect(config?.callbackUrl.href).toBe('https://lihe.chat/api/integrations/lihe/callback');
  });

  it('maps malformed and insecure production URLs to a configuration error', () => {
    process.env.LIHE_CONNECT_API_BASE_URL = 'https://[invalid';
    expect(getLiheConfig).toThrow(LiheConfigurationError);

    process.env.LIHE_CONNECT_API_BASE_URL = 'http://api.lihe.chat';
    expect(getLiheConfig).toThrow(LiheConfigurationError);
  });
});
