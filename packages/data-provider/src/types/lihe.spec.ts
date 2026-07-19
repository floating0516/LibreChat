import {
  liheApiKeyIdSchema,
  liheStartRequestSchema,
  liheDisconnectRequestSchema,
  liheStoredConnectionSchema,
  parseLiheApiKeyId,
} from './lihe';

describe('Lihe API key ID validation', () => {
  it.each(['1', '90', '9223372036854775807'])('accepts canonical int64 ID %s', (value) => {
    expect(liheApiKeyIdSchema.parse(value)).toBe(value);
  });

  it.each([
    '',
    '0',
    '01',
    '-1',
    '+1',
    '1.0',
    '1e2',
    ' 1',
    '1 ',
    '9223372036854775808',
    '99999999999999999999',
  ])('rejects non-canonical or out-of-range ID %p', (value) => {
    expect(liheApiKeyIdSchema.safeParse(value).success).toBe(false);
  });

  it('requires exactly one query value', () => {
    expect(parseLiheApiKeyId([])).toBeNull();
    expect(parseLiheApiKeyId(['90'])).toBe('90');
    expect(parseLiheApiKeyId(['90', '91'])).toBeNull();
    expect(parseLiheApiKeyId(['01'])).toBeNull();
  });

  it('requires a string ID and rejects unknown request fields', () => {
    expect(liheStartRequestSchema.safeParse({}).success).toBe(false);
    expect(liheStartRequestSchema.safeParse({ apiKeyId: 90 }).success).toBe(false);
    expect(
      liheStartRequestSchema.safeParse({ apiKeyId: '90', replaceExisting: true }).success,
    ).toBe(true);
    expect(liheStartRequestSchema.safeParse({ apiKeyId: '90', userId: 'other' }).success).toBe(
      false,
    );
  });

  it('accepts legacy and multi-provider connection metadata without provider overlap', () => {
    const entry = {
      accessToken: 'lhc_synthetic_token_1234567890',
      scope: 'models:read chat:write',
      providers: ['openAI'],
      connectedAt: '2026-07-19T00:00:00.000Z',
      previousKeys: {},
    };
    expect(liheStoredConnectionSchema.safeParse({ version: 1, ...entry }).success).toBe(true);
    expect(
      liheStoredConnectionSchema.safeParse({
        version: 2,
        connections: [
          entry,
          { ...entry, providers: ['anthropic'], accessToken: 'lhc_other_token_1234567890123' },
        ],
      }).success,
    ).toBe(true);
    expect(
      liheStoredConnectionSchema.safeParse({
        version: 2,
        connections: [entry, { ...entry, accessToken: 'lhc_other_token_1234567890123' }],
      }).success,
    ).toBe(false);
  });

  it('validates optional provider-specific disconnect requests', () => {
    expect(liheDisconnectRequestSchema.safeParse({}).success).toBe(true);
    expect(liheDisconnectRequestSchema.safeParse({ provider: 'anthropic' }).success).toBe(true);
    expect(liheDisconnectRequestSchema.safeParse({ provider: 'unknown' }).success).toBe(false);
    expect(
      liheDisconnectRequestSchema.safeParse({ provider: 'openAI', userId: 'other' }).success,
    ).toBe(false);
  });
});
