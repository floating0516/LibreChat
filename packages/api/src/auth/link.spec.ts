import type { Request, Response } from 'express';
import type { IUser } from '@librechat/data-schemas';
import {
  OpenIdLinkError,
  assertOpenIdLinkIdentityAllowed,
  completeOpenIdAccountLink,
  createOpenIdLinkStartHandler,
  isOpenIdAccountLinkingEnabled,
  isSafeOpenIdLinkReturnTo,
  resolveOpenIdLinkIdentity,
} from './link';

describe('OpenID account linking', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.OPENID_ACCOUNT_LINKING_ENABLED = 'true';
    process.env.ALLOW_SOCIAL_LOGIN = 'true';
    process.env.OPENID_CLIENT_ID = 'lihe-chat-login';
    process.env.OPENID_CLIENT_SECRET = 'client-secret';
    process.env.OPENID_ISSUER = 'https://api.lihe.chat';
    process.env.OPENID_SCOPE = 'openid profile email';
    process.env.OPENID_SESSION_SECRET = 'session-secret';
    delete process.env.OPENID_HIDDEN_TEST_MODE;
    delete process.env.OPENID_HIDDEN_TEST_ALLOWED_EMAILS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('accepts the Lihe import return path and rejects open redirects', () => {
    expect(isSafeOpenIdLinkReturnTo('/connect/lihe?api_key_id=90')).toBe(true);
    expect(isSafeOpenIdLinkReturnTo('https://evil.example/connect')).toBe(false);
    expect(isSafeOpenIdLinkReturnTo('//evil.example/connect')).toBe(false);
    expect(isSafeOpenIdLinkReturnTo('/login?redirect_to=/connect/lihe')).toBe(false);
  });

  it('resolves the subject and normalized issuer from verified OIDC claims', () => {
    expect(
      resolveOpenIdLinkIdentity(
        { claims: () => ({ sub: 'stable-sub', iss: 'https://api.lihe.chat/' }) },
        { issuer: 'https://unused.example' },
      ),
    ).toEqual({
      openidId: 'stable-sub',
      openidIssuer: 'https://api.lihe.chat',
    });
  });

  it('starts a link only for an unlinked authenticated user', async () => {
    const session = {
      save: (callback: (error?: Error) => void) => callback(),
    };
    const request = {
      user: { id: '507f1f77bcf86cd799439011' },
      body: { returnTo: '/connect/lihe?api_key_id=90' },
      session,
    };
    const responseState: { status?: number; body?: object } = {};
    const response = {
      status(status: number) {
        responseState.status = status;
        return this;
      },
      json(body: object) {
        responseState.body = body;
        return this;
      },
    };
    const handler = createOpenIdLinkStartHandler({
      getUserById: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        tenantId: undefined,
      }),
    });

    await handler(
      request as unknown as Parameters<typeof handler>[0],
      response as unknown as Response,
    );

    expect(responseState).toEqual({
      status: 200,
      body: { authorizationUrl: '/oauth/openid/link' },
    });
    expect(session).toEqual(
      expect.objectContaining({
        librechatOpenIdLink: expect.objectContaining({
          userId: '507f1f77bcf86cd799439011',
          returnTo: '/connect/lihe?api_key_id=90',
        }),
      }),
    );
  });

  it('allows hidden linking only for the verified allowlisted local user', async () => {
    process.env.ALLOW_SOCIAL_LOGIN = 'false';
    process.env.OPENID_HIDDEN_TEST_MODE = 'true';
    process.env.OPENID_HIDDEN_TEST_ALLOWED_EMAILS = 'allowed@example.com';
    const session = {
      save: (callback: (error?: Error) => void) => callback(),
    };
    const request = {
      user: { id: '507f1f77bcf86cd799439011' },
      body: { returnTo: '/c/new' },
      session,
    };
    const responseState: { status?: number; body?: object } = {};
    const response = {
      status(status: number) {
        responseState.status = status;
        return this;
      },
      json(body: object) {
        responseState.body = body;
        return this;
      },
    };
    const handler = createOpenIdLinkStartHandler({
      getUserById: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        email: 'Allowed@Example.COM',
        emailVerified: true,
      }),
    });

    await handler(
      request as unknown as Parameters<typeof handler>[0],
      response as unknown as Response,
    );

    expect(responseState).toEqual({
      status: 200,
      body: { authorizationUrl: '/oauth/openid/link' },
    });
    expect(session).toEqual(
      expect.objectContaining({
        librechatOpenIdLink: expect.objectContaining({
          expectedEmail: 'allowed@example.com',
        }),
      }),
    );
    expect(
      isOpenIdAccountLinkingEnabled({
        email: 'allowed@example.com',
        emailVerified: true,
      }),
    ).toBe(true);
    expect(
      isOpenIdAccountLinkingEnabled({
        email: 'other@example.com',
        emailVerified: true,
      }),
    ).toBe(false);
  });

  it('returns feature_disabled without creating an intent for a non-allowlisted user', async () => {
    process.env.ALLOW_SOCIAL_LOGIN = 'false';
    process.env.OPENID_HIDDEN_TEST_MODE = 'true';
    process.env.OPENID_HIDDEN_TEST_ALLOWED_EMAILS = 'allowed@example.com';
    const session = {
      save: jest.fn((callback: (error?: Error) => void) => callback()),
    };
    const responseState: { status?: number; body?: object } = {};
    const handler = createOpenIdLinkStartHandler({
      getUserById: jest.fn().mockResolvedValue({
        _id: '507f1f77bcf86cd799439011',
        email: 'other@example.com',
        emailVerified: true,
      }),
    });

    await handler(
      {
        user: { id: '507f1f77bcf86cd799439011' },
        body: {},
        session,
      } as unknown as Parameters<typeof handler>[0],
      {
        status(status: number) {
          responseState.status = status;
          return this;
        },
        json(body: object) {
          responseState.body = body;
          return this;
        },
      } as unknown as Response,
    );

    expect(responseState).toEqual({ status: 404, body: { error: 'feature_disabled' } });
    expect(session.save).not.toHaveBeenCalled();
    expect(session).not.toHaveProperty('librechatOpenIdLink');
  });

  it('requires the hidden-link callback identity to match the verified local email', () => {
    process.env.ALLOW_SOCIAL_LOGIN = 'false';
    process.env.OPENID_HIDDEN_TEST_MODE = 'true';
    process.env.OPENID_HIDDEN_TEST_ALLOWED_EMAILS = 'allowed@example.com';
    const request = {
      session: {
        librechatOpenIdLink: {
          userId: '507f1f77bcf86cd799439011',
          expectedEmail: 'allowed@example.com',
          returnTo: '/c/new',
          createdAt: Date.now(),
        },
      },
    } as unknown as Request;

    expect(() =>
      assertOpenIdLinkIdentityAllowed(request, {
        claims: () => ({ email: 'Allowed@Example.COM', email_verified: true }),
      }),
    ).not.toThrow();
    expect(() =>
      assertOpenIdLinkIdentityAllowed(request, {
        claims: () => ({ email: 'other@example.com', email_verified: true }),
      }),
    ).toThrow(expect.objectContaining<Partial<OpenIdLinkError>>({ code: 'link_unavailable' }));
    expect(() =>
      assertOpenIdLinkIdentityAllowed(request, {
        claims: () => ({ email: 'allowed@example.com', email_verified: false }),
      }),
    ).toThrow(expect.objectContaining<Partial<OpenIdLinkError>>({ code: 'link_unavailable' }));
  });

  it('consumes the session intent and preserves the existing MongoDB user', async () => {
    const user = {
      _id: '507f1f77bcf86cd799439011',
      id: '507f1f77bcf86cd799439011',
      email: 'existing@example.com',
      emailVerified: true,
      provider: 'openid',
      openidId: 'stable-sub',
      openidIssuer: 'https://api.lihe.chat',
    } as IUser;
    const session = {
      librechatOpenIdLink: {
        userId: user.id,
        returnTo: '/connect/lihe?api_key_id=90',
        createdAt: Date.now(),
      },
      save: (callback: (error?: Error) => void) => callback(),
    };
    const req = { session } as unknown as Request;
    const linkOpenIdIdentity = jest.fn().mockResolvedValue({ status: 'linked', user });

    const result = await completeOpenIdAccountLink({
      req,
      openidId: 'stable-sub',
      openidIssuer: 'https://api.lihe.chat',
      linkOpenIdIdentity,
    });

    expect(result).toEqual({ user, returnTo: '/connect/lihe?api_key_id=90' });
    expect(session.librechatOpenIdLink).toBeUndefined();
    expect(linkOpenIdIdentity).toHaveBeenCalledWith({
      userId: user.id,
      tenantId: undefined,
      openidId: 'stable-sub',
      openidIssuer: 'https://api.lihe.chat',
    });
  });

  it('fails closed when the link intent has expired', async () => {
    const session = {
      librechatOpenIdLink: {
        userId: '507f1f77bcf86cd799439011',
        returnTo: '/c/new',
        createdAt: Date.now() - 11 * 60 * 1000,
      },
      save: (callback: (error?: Error) => void) => callback(),
    };

    await expect(
      completeOpenIdAccountLink({
        req: { session } as unknown as Request,
        openidId: 'stable-sub',
        openidIssuer: 'https://api.lihe.chat',
        linkOpenIdIdentity: jest.fn(),
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<OpenIdLinkError>>({ code: 'link_expired' }));
    expect(session.librechatOpenIdLink).toBeUndefined();
  });
});
