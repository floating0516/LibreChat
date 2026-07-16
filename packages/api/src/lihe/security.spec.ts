import { createLihePkce, signLiheState, verifyLiheState } from './security';

describe('Lihe Connect security', () => {
  const secret = 'test-state-secret-that-is-long-enough';

  it('creates an RFC 7636 S256 challenge', () => {
    const pkce = createLihePkce();
    expect(pkce.flowId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(pkce.verifier).toHaveLength(64);
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('accepts an authentic state and rejects tampering', () => {
    const { flowId } = createLihePkce();
    const state = signLiheState(flowId, secret);
    expect(verifyLiheState(state, secret)).toBe(flowId);
    expect(verifyLiheState(`${state.slice(0, -1)}x`, secret)).toBeNull();
    expect(verifyLiheState(state, `${secret}-other`)).toBeNull();
  });

  it('rejects malformed and oversized state values', () => {
    expect(verifyLiheState('missing-signature', secret)).toBeNull();
    expect(verifyLiheState(`x.${'a'.repeat(300)}`, secret)).toBeNull();
  });
});
