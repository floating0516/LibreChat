import type { Request, Response } from 'express';
import type { IUser } from '@librechat/data-schemas';
import {
  OpenIdLinkError,
  completeOpenIdAccountLink,
  createOpenIdLinkStartHandler,
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
