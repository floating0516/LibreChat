import { liheApiKeyIdSchema, liheStartRequestSchema, parseLiheApiKeyId } from './lihe';

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
});
