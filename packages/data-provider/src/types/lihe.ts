import { z } from 'zod';

export const liheProviderSchema = z.enum(['openAI', 'anthropic', 'google', 'grok']);

export type TLiheProvider = z.infer<typeof liheProviderSchema>;

const LIHE_API_KEY_ID_MAX = '9223372036854775807';

export const liheApiKeyIdSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((value) => value.length < LIHE_API_KEY_ID_MAX.length || value <= LIHE_API_KEY_ID_MAX);

export function parseLiheApiKeyId(values: readonly string[]): string | null {
  if (values.length !== 1) {
    return null;
  }
  const parsed = liheApiKeyIdSchema.safeParse(values[0]);
  return parsed.success ? parsed.data : null;
}

export const liheTokenResponseSchema = z.object({
  access_token: z.string().min(16).max(8192),
  token_type: z.literal('Bearer'),
  scope: z.string().min(1).max(512),
  providers: z
    .array(liheProviderSchema)
    .min(1)
    .max(4)
    .refine((providers) => new Set(providers).size === providers.length),
  account_id: z.string().min(1).max(256).optional(),
  account_label: z.string().min(1).max(256).optional(),
  expires_in: z.null().optional(),
});

export type TLiheTokenResponse = z.infer<typeof liheTokenResponseSchema>;

const liheKeySnapshotSchema = z.object({
  value: z.string().min(1).max(32768),
  expiresAt: z.string().datetime().nullable(),
});

const lihePreviousKeysSchema = z.object({
  openAI: liheKeySnapshotSchema.optional(),
  anthropic: liheKeySnapshotSchema.optional(),
  google: liheKeySnapshotSchema.optional(),
  grok: liheKeySnapshotSchema.optional(),
});

export const liheStoredConnectionEntrySchema = z.object({
  accessToken: z.string().min(16).max(8192),
  scope: z.string().min(1).max(512),
  providers: z.array(liheProviderSchema).min(1).max(4),
  connectedAt: z.string().datetime(),
  accountId: z.string().min(1).max(256).optional(),
  accountLabel: z.string().min(1).max(256).optional(),
  previousKeys: lihePreviousKeysSchema,
});

export const liheStoredConnectionV1Schema = z.object({
  version: z.literal(1),
  ...liheStoredConnectionEntrySchema.shape,
});

export const liheStoredConnectionV2Schema = z
  .object({
    version: z.literal(2),
    connections: z.array(liheStoredConnectionEntrySchema).min(1).max(4),
  })
  .superRefine(({ connections }, ctx) => {
    const seen = new Set<TLiheProvider>();
    for (const connection of connections) {
      for (const provider of connection.providers) {
        if (seen.has(provider)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Provider ${provider} is managed by more than one Lihe connection`,
          });
          return;
        }
        seen.add(provider);
      }
    }
  });

export const liheStoredConnectionSchema = z.union([
  liheStoredConnectionV1Schema,
  liheStoredConnectionV2Schema,
]);

export type TLiheStoredConnectionEntry = z.infer<typeof liheStoredConnectionEntrySchema>;
export type TLiheStoredConnection = z.infer<typeof liheStoredConnectionV2Schema>;
export type TLiheStoredConnectionData = z.infer<typeof liheStoredConnectionSchema>;

export const liheModelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1) })).min(1),
});

export type TLiheConnectionStatus = {
  enabled: boolean;
  connected: boolean;
  needsReconnect: boolean;
  hasExistingKeys: boolean;
  providers: TLiheProvider[];
  selectionUrl?: string;
  connectedAt?: string;
  accountLabel?: string;
  requiresAccountLink?: boolean;
  connections: TLiheConnectionSummary[];
};

export type TLiheConnectionSummary = {
  connected: boolean;
  needsReconnect: boolean;
  providers: TLiheProvider[];
  connectedAt: string;
  accountLabel?: string;
};

export const liheStartRequestSchema = z
  .object({
    apiKeyId: liheApiKeyIdSchema,
    replaceExisting: z.boolean().optional(),
  })
  .strict();

export type TLiheStartRequest = z.infer<typeof liheStartRequestSchema>;

export type TLiheStartResponse = {
  authorizationUrl: string;
};

export const liheDisconnectRequestSchema = z
  .object({
    provider: liheProviderSchema.optional(),
  })
  .strict();

export type TLiheDisconnectRequest = z.infer<typeof liheDisconnectRequestSchema>;

export type TLiheDisconnectResponse = {
  disconnected: true;
  disconnectedProviders: TLiheProvider[];
  remainingProviders: TLiheProvider[];
  restoredProviders: TLiheProvider[];
  preservedProviders: TLiheProvider[];
};
