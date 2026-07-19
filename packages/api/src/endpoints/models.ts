import { z } from 'zod';
import axios from 'axios';
import crypto from 'crypto';
import { logger } from '@librechat/data-schemas';
import {
  Time,
  CacheKeys,
  KnownEndpoints,
  EModelEndpoint,
  defaultModels,
  reasoningOptionSchema,
  modelReasoningCapabilitySchema,
  inlineReasoningParameterSchema,
} from 'librechat-data-provider';
import type { IUser } from '@librechat/data-schemas';
import type { AxiosRequestConfig } from 'axios';
import type {
  ReasoningOption,
  InlineReasoningParameter,
  TModelReasoningCapability,
} from 'librechat-data-provider';
import {
  processModelData,
  extractBaseURL,
  isUserProvided,
  resolveHeaders,
  deriveBaseURL,
  logAxiosError,
  inputSchema,
  applyAxiosProxyConfig,
} from '~/utils';
import { getModelCacheTokenConfigKey, isScopedTokenConfigKey } from '~/endpoints/keys';
import { createSSRFSafeAgents, validateEndpointURL } from '~/auth';
import { standardCache, tokenConfigCache } from '~/cache';

type SSRFSafeAgents = ReturnType<typeof createSSRFSafeAgents>;

type ModelCapabilitiesByID = Record<string, TModelReasoningCapability>;

const modelListCapabilities = new WeakMap<string[], ModelCapabilitiesByID>();
const reasoningOptionsSchema = z.array(z.string()).max(32);
const upstreamReasoningSchema = z
  .object({
    parameter: z.unknown().optional(),
    options: z.unknown().optional(),
    efforts: z.unknown().optional(),
    levels: z.unknown().optional(),
  })
  .passthrough();
const upstreamCapabilitiesSchema = z
  .object({
    reasoning: z.unknown().optional(),
    reasoning_efforts: z.unknown().optional(),
    supported_reasoning_efforts: z.unknown().optional(),
    thinking_levels: z.unknown().optional(),
    supported_thinking_levels: z.unknown().optional(),
  })
  .passthrough();
const upstreamModelSchema = z
  .object({
    id: z.string().min(1).max(512),
    reasoning_parameter: z.unknown().optional(),
    reasoning_efforts: z.unknown().optional(),
    supported_reasoning_efforts: z.unknown().optional(),
    thinking_levels: z.unknown().optional(),
    supported_thinking_levels: z.unknown().optional(),
    capabilities: z.unknown().optional(),
  })
  .passthrough();
const upstreamModelsResponseSchema = z.object({ data: z.array(z.unknown()) });
const googleModelSchema = z
  .object({
    name: z.string().min(1).max(512),
    supportedGenerationMethods: z.array(z.string()).optional(),
  })
  .passthrough();
const cachedModelsSchema = z.object({
  models: z.array(z.string()),
  capabilities: z.record(modelReasoningCapabilitySchema),
});

const allowedOptions: Record<InlineReasoningParameter, ReadonlySet<ReasoningOption>> = {
  reasoning_effort: new Set([
    '',
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'ultra',
  ]),
  effort: new Set(['', 'low', 'medium', 'high', 'xhigh', 'max']),
  thinkingLevel: new Set(['', 'minimal', 'low', 'medium', 'high']),
};
const parameterAliases: Record<string, InlineReasoningParameter> = {
  reasoning_effort: 'reasoning_effort',
  reasoningeffort: 'reasoning_effort',
  effort: 'effort',
  thinking_level: 'thinkingLevel',
  thinkinglevel: 'thinkingLevel',
};
const reasoningOptionAliases: Record<string, ReasoningOption> = {
  '': '',
  auto: '',
  default: '',
  unset: '',
  'extra high': 'xhigh',
  'extra-high': 'xhigh',
  extra_high: 'xhigh',
};

function normalizeReasoningParameter(
  value: unknown,
  endpoint: string,
  model: string,
  thinkingLevels: boolean,
): InlineReasoningParameter {
  if (typeof value === 'string') {
    const aliased = parameterAliases[value.trim().toLowerCase()];
    const result = inlineReasoningParameterSchema.safeParse(aliased ?? value);
    if (result.success) {
      return result.data;
    }
  }

  const normalizedModel = model.toLowerCase();
  if (
    thinkingLevels ||
    endpoint === EModelEndpoint.google ||
    /(?:gemini|gemma)/.test(normalizedModel)
  ) {
    return 'thinkingLevel';
  }
  if (endpoint === EModelEndpoint.anthropic || normalizedModel.includes('claude')) {
    return 'effort';
  }
  return 'reasoning_effort';
}

function normalizeReasoningOption(value: string): ReasoningOption | null {
  const normalized = value.trim().toLowerCase();
  const result = reasoningOptionSchema.safeParse(reasoningOptionAliases[normalized] ?? normalized);
  return result.success ? result.data : null;
}

function normalizeReasoningOptions(
  value: unknown,
  parameter: InlineReasoningParameter,
): ReasoningOption[] {
  const result = reasoningOptionsSchema.safeParse(value);
  if (!result.success) {
    return [];
  }

  const options: ReasoningOption[] = [''];
  for (const rawOption of result.data) {
    const option = normalizeReasoningOption(rawOption);
    if (option == null || !allowedOptions[parameter].has(option) || options.includes(option)) {
      continue;
    }
    options.push(option);
  }
  return options.length > 1 ? options : [];
}

function extractReasoningCapability(
  rawModel: unknown,
  endpoint: string,
): { id: string; capability?: TModelReasoningCapability } | null {
  const modelResult = upstreamModelSchema.safeParse(rawModel);
  if (!modelResult.success) {
    return null;
  }

  const model = modelResult.data;
  const capabilitiesResult = upstreamCapabilitiesSchema.safeParse(model.capabilities);
  const capabilities = capabilitiesResult.success ? capabilitiesResult.data : undefined;
  const reasoningResult = upstreamReasoningSchema.safeParse(capabilities?.reasoning);
  const reasoning = reasoningResult.success ? reasoningResult.data : undefined;
  const reasoningArray = reasoningOptionsSchema.safeParse(capabilities?.reasoning);
  const nestedOptions =
    reasoning?.options ??
    reasoning?.efforts ??
    reasoning?.levels ??
    (reasoningArray.success ? reasoningArray.data : undefined);
  const reasoningOptions =
    nestedOptions ??
    capabilities?.reasoning_efforts ??
    capabilities?.supported_reasoning_efforts ??
    model.reasoning_efforts ??
    model.supported_reasoning_efforts;
  const thinkingOptions =
    capabilities?.thinking_levels ??
    capabilities?.supported_thinking_levels ??
    model.thinking_levels ??
    model.supported_thinking_levels;
  const usesThinkingLevels = reasoningOptions == null && thinkingOptions != null;
  const rawOptions = reasoningOptions ?? thinkingOptions;
  const parameter = normalizeReasoningParameter(
    reasoning?.parameter ?? model.reasoning_parameter,
    endpoint,
    model.id,
    usesThinkingLevels,
  );
  const options = normalizeReasoningOptions(rawOptions, parameter);

  if (options.length === 0) {
    return { id: model.id };
  }
  return {
    id: model.id,
    capability: { parameter, options },
  };
}

function attachModelListCapabilities(
  models: string[],
  capabilities: ModelCapabilitiesByID,
): string[] {
  if (Object.keys(capabilities).length > 0) {
    modelListCapabilities.set(models, capabilities);
  }
  return models;
}

export function getModelListCapabilities(models: string[]): ModelCapabilitiesByID | undefined {
  return modelListCapabilities.get(models);
}

function copyModelListCapabilities(source: string[], target: string[]): string[] {
  const sourceCapabilities = getModelListCapabilities(source);
  if (!sourceCapabilities) {
    return target;
  }

  const targetCapabilities: ModelCapabilitiesByID = {};
  for (const model of target) {
    const capability = sourceCapabilities[model];
    if (capability) {
      targetCapabilities[model] = capability;
    }
  }
  return attachModelListCapabilities(target, targetCapabilities);
}

function restoreCachedModels(value: unknown): string[] | null {
  if (Array.isArray(value) && value.every((model) => typeof model === 'string')) {
    return value;
  }
  const result = cachedModelsSchema.safeParse(value);
  if (!result.success) {
    return null;
  }
  return attachModelListCapabilities(result.data.models, result.data.capabilities);
}

function createCachedModelsValue(
  models: string[],
): string[] | { models: string[]; capabilities: ModelCapabilitiesByID } {
  const capabilities = getModelListCapabilities(models);
  return capabilities ? { models, capabilities } : models;
}

export interface FetchModelsParams {
  /** User ID for API requests */
  user?: string;
  /** API key for authentication */
  apiKey: string;
  /** Base URL for the API */
  baseURL?: string;
  /** Whether the base URL came from a user-stored credential */
  baseURLIsUserProvided?: boolean;
  /** Admin-approved internal host:port exemptions for user-provided base URLs */
  allowedAddresses?: string[] | null;
  /** Endpoint name (defaults to 'openAI') */
  name?: string;
  /** Whether directEndpoint was configured */
  direct?: boolean;
  /** Whether to fetch from Azure */
  azure?: boolean;
  /** Whether to send user ID as query parameter */
  userIdQuery?: boolean;
  /** Whether to create token configuration from API response */
  createTokenConfig?: boolean;
  /** Cache key for token configuration (uses name if omitted) */
  tokenKey?: string;
  /** Optional headers for the request */
  headers?: Record<string, string> | null;
  /** Optional user object for header resolution */
  userObject?: Partial<IUser>;
  /** Skip MODEL_QUERIES cache (e.g., for user-provided keys) */
  skipCache?: boolean;
}

function applyUserProvidedBaseURLProtection(
  options: AxiosRequestConfig,
  ssrfAgents?: SSRFSafeAgents,
): AxiosRequestConfig {
  if (!ssrfAgents) {
    return options;
  }

  options.maxRedirects = 0;

  options.proxy = false;
  options.httpAgent = ssrfAgents.httpAgent;
  options.httpsAgent = ssrfAgents.httpsAgent;

  return options;
}

/**
 * Fetches Ollama models from the specified base API path.
 * @param baseURL - The Ollama server URL
 * @param options - Optional configuration
 * @returns Promise resolving to array of model names
 */
async function fetchOllamaModels(
  baseURL: string,
  options: {
    headers?: Record<string, string> | null;
    ssrfAgents?: SSRFSafeAgents;
    user?: Partial<IUser>;
  } = {},
): Promise<string[]> {
  if (!baseURL) {
    return [];
  }

  const ollamaEndpoint = deriveBaseURL(baseURL);

  const resolvedHeaders = resolveHeaders({
    headers: options.headers ?? undefined,
    user: options.user,
  });

  const requestOptions: AxiosRequestConfig & {
    headers: Record<string, string>;
    timeout: number;
  } = {
    headers: resolvedHeaders,
    timeout: 5000,
  };
  applyUserProvidedBaseURLProtection(requestOptions, options.ssrfAgents);

  const response = await axios.get<{ models: Array<{ name: string }> }>(
    `${ollamaEndpoint}/api/tags`,
    requestOptions,
  );

  return response.data.models.map((tag) => tag.name);
}

async function backfillTokenConfigFromModelCache(
  cacheKey: string,
  tokenKey: string,
): Promise<boolean> {
  const cachedTokenConfig = await tokenConfigCache().get(getModelCacheTokenConfigKey(cacheKey));
  if (cachedTokenConfig == null) {
    return false;
  }

  await tokenConfigCache().set(tokenKey, cachedTokenConfig);
  return true;
}

/**
 * Splits a string by commas and trims each resulting value.
 * @param input - The input string to split.
 * @returns An array of trimmed values.
 */
export function splitAndTrim(input: string | null | undefined): string[] {
  if (!input || typeof input !== 'string') {
    return [];
  }
  return input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Fetches models from the specified base API path or Azure, based on the provided configuration.
 *
 * @param params - The parameters for fetching the models.
 * @returns A promise that resolves to an array of model identifiers.
 */
export async function fetchModels({
  user,
  apiKey,
  baseURL: _baseURL,
  baseURLIsUserProvided = false,
  allowedAddresses,
  name = EModelEndpoint.openAI,
  direct = false,
  azure = false,
  userIdQuery = false,
  createTokenConfig = true,
  tokenKey,
  headers,
  userObject,
  skipCache = false,
}: FetchModelsParams): Promise<string[]> {
  let models: string[] = [];
  const baseURL = direct ? extractBaseURL(_baseURL ?? '') : _baseURL;

  if (!baseURL && !azure) {
    return models;
  }

  if (!apiKey) {
    return models;
  }

  const ssrfAgents = baseURLIsUserProvided ? createSSRFSafeAgents(allowedAddresses) : undefined;
  if (baseURLIsUserProvided && baseURL) {
    await validateEndpointURL(baseURL, name, allowedAddresses);
  }

  // The MODEL_QUERIES cache is keyed by baseURL+apiKey only. That's safe
  // when the response is identical for every caller, but fails when callers
  // forward header templates that resolve to a user-bound value (e.g.
  // `Authorization: Bearer {{LIBRECHAT_OPENID_ID_TOKEN}}`): one user's
  // filtered list could otherwise be served to the next request that
  // shares the same baseURL+apiKey. Skip the cache whenever both `headers`
  // and `userObject` are supplied, since that's the signal the caller is
  // resolving headers against a specific user's identity.
  const hasUserScopedHeaders = !!headers && Object.keys(headers).length > 0 && !!userObject;
  const shouldCache = !skipCache && !(userIdQuery && user) && !hasUserScopedHeaders;
  const cacheKey = shouldCache ? modelsCacheKey(baseURL ?? '', apiKey) : '';
  const modelsCache = shouldCache ? standardCache(CacheKeys.MODEL_QUERIES) : null;
  if (modelsCache && cacheKey) {
    const cachedModels = restoreCachedModels(await modelsCache.get(cacheKey));
    if (cachedModels) {
      if (createTokenConfig && tokenKey) {
        const tokenConfigBackfilled = await backfillTokenConfigFromModelCache(cacheKey, tokenKey);
        if (!tokenConfigBackfilled && isScopedTokenConfigKey(tokenKey)) {
          models = cachedModels;
        } else {
          return cachedModels;
        }
      } else {
        return cachedModels;
      }
    }
  }

  if (name && name.toLowerCase().startsWith(KnownEndpoints.ollama)) {
    let ollamaModels: string[] | null = null;
    try {
      ollamaModels = await fetchOllamaModels(baseURL ?? '', {
        headers,
        ssrfAgents,
        user: userObject,
      });
    } catch (ollamaError) {
      logAxiosError({
        message:
          'Failed to fetch models from Ollama API. Attempting to fetch via OpenAI-compatible endpoint.',
        error: ollamaError as Error,
      });
    }
    if (ollamaModels !== null) {
      if (modelsCache && cacheKey && ollamaModels.length > 0) {
        await modelsCache.set(cacheKey, ollamaModels, Time.TWO_MINUTES);
      }
      return ollamaModels;
    }
  }

  try {
    // Resolve template variables (e.g. {{LIBRECHAT_OPENID_ID_TOKEN}}) in the
    // configured headers, mirroring fetchOllamaModels above. Without this,
    // placeholder strings are forwarded literally on the model-fetch path.
    const resolvedHeaders = resolveHeaders({
      headers: headers ?? undefined,
      user: userObject,
    });

    const options: AxiosRequestConfig & {
      headers: Record<string, string>;
      timeout: number;
    } = {
      headers: {
        ...resolvedHeaders,
      },
      timeout: 5000,
    };

    if (name === EModelEndpoint.anthropic) {
      // Keep configured custom headers (e.g. gateway metadata) while the
      // provider-managed auth/version headers stay authoritative.
      options.headers = {
        ...resolvedHeaders,
        'x-api-key': apiKey,
        'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01',
      };
    } else {
      // Only fall back to the apiKey-based Bearer when the configured
      // headers did not already supply an Authorization. This lets
      // auth-aware proxies (e.g. LiteLLM with JWT auth) receive the user's
      // token on /v1/models so they can return a per-user filtered list.
      const hasAuthHeader = Object.keys(options.headers).some(
        (k) => k.toLowerCase() === 'authorization',
      );
      if (!hasAuthHeader) {
        options.headers.Authorization = `Bearer ${apiKey}`;
      }
    }

    if (process.env.OPENAI_ORGANIZATION && baseURL?.includes('openai')) {
      options.headers['OpenAI-Organization'] = process.env.OPENAI_ORGANIZATION;
    }

    const url = modelsEndpoint(baseURL ?? '', name, azure);
    if (user && userIdQuery) {
      url.searchParams.append('user', user);
    }
    applyAxiosProxyConfig(options, url);
    applyUserProvidedBaseURLProtection(options, ssrfAgents);
    const res = await axios.get(url.toString(), options);

    const input = res.data;

    const validationResult = inputSchema.safeParse(input);
    if (validationResult.success && createTokenConfig) {
      const endpointTokenConfig = processModelData(input);
      const cache = tokenConfigCache();
      await cache.set(tokenKey ?? name, endpointTokenConfig);
      if (modelsCache && cacheKey) {
        await cache.set(getModelCacheTokenConfigKey(cacheKey), endpointTokenConfig);
      }
    }
    const modelsResponse = upstreamModelsResponseSchema.safeParse(input);
    if (modelsResponse.success) {
      const capabilities: ModelCapabilitiesByID = {};
      const modelIDs: string[] = [];
      for (const rawModel of modelsResponse.data.data) {
        const parsedModel = extractReasoningCapability(rawModel, name);
        if (!parsedModel) {
          continue;
        }
        modelIDs.push(parsedModel.id);
        if (parsedModel.capability) {
          capabilities[parsedModel.id] = parsedModel.capability;
        }
      }
      models = attachModelListCapabilities(modelIDs, capabilities);
    }
  } catch (error) {
    const logMessage = `Failed to fetch models from ${azure ? 'Azure ' : ''}${name} API`;
    logAxiosError({ message: logMessage, error: error as Error });
  }

  if (modelsCache && cacheKey && models.length > 0) {
    await modelsCache.set(cacheKey, createCachedModelsValue(models), Time.TWO_MINUTES);
  }

  return models;
}

function modelsCacheKey(baseURL: string, apiKey: string): string {
  return crypto.createHash('sha256').update(`${baseURL}:${apiKey}`).digest('hex').slice(0, 32);
}

function modelsEndpoint(baseURL: string, name: string, azure: boolean): URL {
  const normalizedBaseURL = baseURL.replace(/\/+$/, '');
  if (azure) {
    return new URL(normalizedBaseURL);
  }
  const pathname = new URL(normalizedBaseURL).pathname;
  const hasV1Segment = pathname.split('/').includes('v1');
  const path = name === EModelEndpoint.anthropic && !hasV1Segment ? '/v1/models' : '/models';
  return new URL(`${normalizedBaseURL}${path}`);
}

/** Options for fetching OpenAI models */
export interface GetOpenAIModelsOptions {
  /** User ID for API requests */
  user?: string;
  /** Whether to fetch from Azure */
  azure?: boolean;
  /** Whether to fetch models for the Assistants endpoint */
  assistants?: boolean;
  /** OpenAI API key (if not using environment variable) */
  openAIApiKey?: string;
  /** Models to return when discovery cannot authenticate or returns no models */
  fallbackModels?: string[];
  /** Skip MODEL_QUERIES cache (e.g., for user-provided keys) */
  skipCache?: boolean;
  /** Configured custom headers forwarded to the (gateway-fronted) provider */
  headers?: Record<string, string> | null;
  /** User object for resolving header placeholders */
  userObject?: Partial<IUser>;
}

function resolveOpenAIApiKey(opts: GetOpenAIModelsOptions): string | undefined {
  return opts.openAIApiKey || process.env.OPENAI_API_KEY;
}

/**
 * Fetches models from OpenAI or Azure based on the provided options.
 * @param opts - Options for fetching models
 * @param _models - Fallback models array
 * @returns Promise resolving to array of model IDs
 */
export async function fetchOpenAIModels(
  opts: GetOpenAIModelsOptions,
  _models: string[] = [],
): Promise<string[]> {
  let models = _models.slice() ?? [];
  const apiKey = resolveOpenAIApiKey(opts);
  const openaiBaseURL = 'https://api.openai.com/v1';
  let baseURL = openaiBaseURL;
  let reverseProxyUrl = process.env.OPENAI_REVERSE_PROXY;

  if (opts.assistants && process.env.ASSISTANTS_BASE_URL) {
    reverseProxyUrl = process.env.ASSISTANTS_BASE_URL;
  } else if (opts.azure) {
    return models;
  }

  if (reverseProxyUrl) {
    baseURL = extractBaseURL(reverseProxyUrl) ?? openaiBaseURL;
  }

  if (baseURL || opts.azure) {
    models = await fetchModels({
      apiKey: apiKey ?? '',
      baseURL,
      azure: opts.azure,
      user: opts.user,
      name: EModelEndpoint.openAI,
      skipCache: opts.skipCache,
      headers: opts.headers,
      userObject: opts.userObject,
    });
  }

  if (models.length === 0) {
    return _models;
  }

  if (baseURL === openaiBaseURL) {
    const fetchedModels = models;
    const regex = /(text-davinci-003|gpt-|o\d+|chat-latest)/;
    const excludeRegex = /audio|realtime/;
    models = models.filter((model) => regex.test(model) && !excludeRegex.test(model));
    const instructModels = models.filter((model) => model.includes('instruct'));
    const otherModels = models.filter((model) => !model.includes('instruct'));
    models = copyModelListCapabilities(fetchedModels, otherModels.concat(instructModels));
  }

  return models;
}

/**
 * Loads the default models for OpenAI or Azure.
 * @param opts - Options for getting models
 * @returns Promise resolving to array of model IDs
 */
export async function getOpenAIModels(opts: GetOpenAIModelsOptions = {}): Promise<string[]> {
  let models = opts.fallbackModels ?? defaultModels[EModelEndpoint.openAI];

  if (opts.fallbackModels == null && opts.assistants) {
    models = defaultModels[EModelEndpoint.assistants];
  } else if (opts.fallbackModels == null && opts.azure) {
    models = defaultModels[EModelEndpoint.azureAssistants];
  }

  let key: string;
  if (opts.assistants) {
    key = 'ASSISTANTS_MODELS';
  } else if (opts.azure) {
    key = 'AZURE_OPENAI_MODELS';
  } else {
    key = 'OPENAI_MODELS';
  }

  if (process.env[key]) {
    return splitAndTrim(process.env[key]);
  }

  if (isUserProvided(resolveOpenAIApiKey(opts))) {
    return models;
  }

  return await fetchOpenAIModels(opts, models);
}

/**
 * Fetches models from the Anthropic API.
 * @param opts - Options for fetching models
 * @param _models - Fallback models array
 * @returns Promise resolving to array of model IDs
 */
export async function fetchAnthropicModels(
  opts: {
    user?: string;
    anthropicApiKey?: string;
    fallbackModels?: string[];
    skipCache?: boolean;
    headers?: Record<string, string> | null;
    userObject?: Partial<IUser>;
  } = {},
  _models: string[] = [],
): Promise<string[]> {
  let models = _models.slice() ?? [];
  const apiKey = opts.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  const anthropicBaseURL = 'https://api.anthropic.com/v1';
  let baseURL = anthropicBaseURL;
  const reverseProxyUrl = process.env.ANTHROPIC_REVERSE_PROXY;

  if (reverseProxyUrl) {
    baseURL = extractBaseURL(reverseProxyUrl) ?? anthropicBaseURL;
  }

  if (!apiKey) {
    return models;
  }

  if (baseURL) {
    models = await fetchModels({
      apiKey,
      baseURL,
      user: opts.user,
      name: EModelEndpoint.anthropic,
      tokenKey: EModelEndpoint.anthropic,
      skipCache: opts.skipCache,
      headers: opts.headers,
      userObject: opts.userObject,
    });
  }

  if (models.length === 0) {
    return _models;
  }

  return models;
}

/**
 * Gets Anthropic models from environment or API.
 * @param opts - Options for fetching models
 * @returns Promise resolving to array of model IDs
 */
export async function getAnthropicModels(
  opts: {
    user?: string;
    anthropicApiKey?: string;
    /** Models to return when discovery cannot authenticate or returns no models */
    fallbackModels?: string[];
    vertexModels?: string[];
    headers?: Record<string, string> | null;
    userObject?: Partial<IUser>;
    skipCache?: boolean;
  } = {},
): Promise<string[]> {
  const models = opts.fallbackModels ?? defaultModels[EModelEndpoint.anthropic];

  // Vertex AI models from YAML config take priority
  if (opts.vertexModels && opts.vertexModels.length > 0) {
    return opts.vertexModels;
  }

  if (process.env.ANTHROPIC_MODELS) {
    return splitAndTrim(process.env.ANTHROPIC_MODELS);
  }

  if (isUserProvided(opts.anthropicApiKey || process.env.ANTHROPIC_API_KEY)) {
    return models;
  }

  try {
    return await fetchAnthropicModels(opts, models);
  } catch (error) {
    logger.error('Error fetching Anthropic models:', error);
    return models;
  }
}

export interface GetGoogleModelsOptions {
  /** Google Generative AI API key (if not using the environment variable) */
  googleApiKey?: string;
  /** Models to return when discovery cannot authenticate or returns no models */
  fallbackModels?: string[];
}

/**
 * Gets Google Generative AI models from the API, environment, or defaults.
 * @param opts - Options for fetching Google models
 * @returns Promise resolving to an array of model IDs
 */
export async function getGoogleModels(opts: GetGoogleModelsOptions = {}): Promise<string[]> {
  const fallbackModels = opts.fallbackModels ?? defaultModels[EModelEndpoint.google];
  if (process.env.GOOGLE_MODELS) {
    return splitAndTrim(process.env.GOOGLE_MODELS);
  }

  const apiKey = opts.googleApiKey || process.env.GOOGLE_KEY;
  if (!apiKey || isUserProvided(apiKey)) {
    return fallbackModels;
  }

  try {
    const response = await axios.get<{ models?: unknown[] }>(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      {
        headers: {
          'x-goog-api-key': apiKey,
        },
        timeout: 5000,
      },
    );

    const capabilities: ModelCapabilitiesByID = {};
    const models: string[] = [];
    for (const rawModel of response.data.models ?? []) {
      const googleModel = googleModelSchema.safeParse(rawModel);
      if (
        !googleModel.success ||
        !googleModel.data.supportedGenerationMethods?.includes('generateContent')
      ) {
        continue;
      }
      const id = googleModel.data.name.replace(/^models\//, '');
      models.push(id);
      const parsedModel = extractReasoningCapability(
        { ...googleModel.data, id },
        EModelEndpoint.google,
      );
      if (parsedModel?.capability) {
        capabilities[id] = parsedModel.capability;
      }
    }

    return models.length > 0 ? attachModelListCapabilities(models, capabilities) : fallbackModels;
  } catch {
    logger.debug('Failed to fetch Google models for model discovery.');
    return fallbackModels;
  }
}

/**
 * Gets Bedrock models from environment or defaults.
 * @returns Array of model IDs
 */
export function getBedrockModels(): string[] {
  let models = defaultModels[EModelEndpoint.bedrock];
  if (process.env.BEDROCK_AWS_MODELS) {
    models = splitAndTrim(process.env.BEDROCK_AWS_MODELS);
  }
  return models;
}
