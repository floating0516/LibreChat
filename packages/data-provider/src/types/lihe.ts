import { z } from 'zod';

export const liheProviderSchema = z.enum(['openAI', 'anthropic', 'google']);

export type TLiheProvider = z.infer<typeof liheProviderSchema>;

export const liheTokenResponseSchema = z.object({
  access_token: z.string().min(16).max(8192),
  token_type: z.literal('Bearer'),
  scope: z.string().min(1).max(512),
  providers: z
    .array(liheProviderSchema)
    .min(1)
    .max(3)
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

export const liheStoredConnectionSchema = z.object({
  version: z.literal(1),
  accessToken: z.string().min(16).max(8192),
  scope: z.string().min(1).max(512),
  providers: z.array(liheProviderSchema).min(1).max(3),
  connectedAt: z.string().datetime(),
  accountId: z.string().min(1).max(256).optional(),
  accountLabel: z.string().min(1).max(256).optional(),
  previousKeys: z.object({
    openAI: liheKeySnapshotSchema.optional(),
    anthropic: liheKeySnapshotSchema.optional(),
    google: liheKeySnapshotSchema.optional(),
  }),
});

export type TLiheStoredConnection = z.infer<typeof liheStoredConnectionSchema>;

export const liheModelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1) })).min(1),
});

export type TLiheConnectionStatus = {
  enabled: boolean;
  connected: boolean;
  needsReconnect: boolean;
  hasExistingKeys: boolean;
  providers: TLiheProvider[];
  connectedAt?: string;
  accountLabel?: string;
};

export type TLiheStartRequest = {
  replaceExisting?: boolean;
};

export type TLiheStartResponse = {
  authorizationUrl: string;
};

export type TLiheDisconnectResponse = {
  disconnected: true;
  restoredProviders: TLiheProvider[];
  preservedProviders: TLiheProvider[];
};
