import {
  AnthropicEffort,
  EModelEndpoint,
  ReasoningEffort,
  ThinkingLevel,
} from './types';
import {
  applyModelAwareDefaults,
  getInlineReasoningConfig,
  paramSettings,
} from './parameterSettings';
import type { SettingDefinition } from './generate';

const googleParams = paramSettings[EModelEndpoint.google] as SettingDefinition[];
const openAIParams = paramSettings[EModelEndpoint.openAI] as SettingDefinition[];
const maxOut = (params: SettingDefinition[]) => params.find((p) => p.key === 'maxOutputTokens');

describe('applyModelAwareDefaults', () => {
  it('resolves the Google maxOutputTokens default for current Gemini models', () => {
    const result = applyModelAwareDefaults(googleParams, EModelEndpoint.google, 'gemini-2.5-pro');
    expect(maxOut(result)?.default).toBe(65535);
  });

  it('resolves the legacy default for older Gemini models', () => {
    const result = applyModelAwareDefaults(googleParams, EModelEndpoint.google, 'gemini-1.5-flash');
    expect(maxOut(result)?.default).toBe(8192);
  });

  it('resolves the image default for Gemini image models', () => {
    const result = applyModelAwareDefaults(
      googleParams,
      EModelEndpoint.google,
      'gemini-2.5-flash-image',
    );
    expect(maxOut(result)?.default).toBe(32768);
  });

  it('returns settings unchanged for non-Google endpoints', () => {
    const result = applyModelAwareDefaults(
      googleParams,
      EModelEndpoint.anthropic,
      'gemini-2.5-pro',
    );
    expect(result).toBe(googleParams);
  });

  it('returns settings unchanged when no model is provided', () => {
    expect(applyModelAwareDefaults(googleParams, EModelEndpoint.google, '')).toBe(googleParams);
  });

  it('does not mutate the original settings', () => {
    const before = maxOut(googleParams)?.default;
    applyModelAwareDefaults(googleParams, EModelEndpoint.google, 'gemini-2.5-pro');
    expect(maxOut(googleParams)?.default).toBe(before);
  });

  it('lets a configured override applied afterward take precedence', () => {
    const modelAware = applyModelAwareDefaults(
      googleParams,
      EModelEndpoint.google,
      'gemini-2.5-pro',
    );
    const override = { ...maxOut(modelAware), default: 2048 } as SettingDefinition;
    const final = modelAware.map((p) => (p.key === 'maxOutputTokens' ? override : p));
    expect(maxOut(final)?.default).toBe(2048);
  });
});

describe('OpenAI reasoning effort', () => {
  const reasoningEffort = openAIParams.find((param) => param.key === 'reasoning_effort');

  it('uses an explicit dropdown instead of an unlabeled enum slider', () => {
    expect(reasoningEffort?.component).toBe('dropdown');
  });

  it('exposes all gateway-supported effort tiers in order', () => {
    expect(reasoningEffort?.options).toEqual([
      ReasoningEffort.unset,
      ReasoningEffort.none,
      ReasoningEffort.minimal,
      ReasoningEffort.low,
      ReasoningEffort.medium,
      ReasoningEffort.high,
      ReasoningEffort.xhigh,
      ReasoningEffort.max,
      ReasoningEffort.ultra,
    ]);
  });
});

describe('getInlineReasoningConfig', () => {
  const resolve = (endpoint: string, model: string, endpointType?: string) =>
    getInlineReasoningConfig({ endpoint, endpointType, model });

  it('exposes Ultra only for GPT 5.6 and newer profiles', () => {
    expect(resolve(EModelEndpoint.openAI, 'gpt-5.6-sol')?.options).toEqual([
      '',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra',
    ]);
    expect(resolve(EModelEndpoint.openAI, 'gpt-5.5')?.options).not.toContain('ultra');
  });

  it('uses smaller profiles for earlier GPT-5 and o-series models', () => {
    expect(resolve(EModelEndpoint.openAI, 'gpt-5.2')?.options).toEqual([
      '',
      'none',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(resolve(EModelEndpoint.openAI, 'gpt-5')?.options).toEqual([
      '',
      'minimal',
      'low',
      'medium',
      'high',
    ]);
    expect(resolve(EModelEndpoint.openAI, 'o3')?.options).toEqual(['', 'low', 'medium', 'high']);
  });

  it('does not show a qualitative control for non-reasoning OpenAI models', () => {
    expect(resolve(EModelEndpoint.openAI, 'gpt-4o')).toBeNull();
  });

  it('uses the xAI low/high profile for Grok reasoning models', () => {
    const config = resolve('Grok', 'grok-3-mini', EModelEndpoint.custom);
    expect(config?.parameter).toBe('reasoning_effort');
    expect(config?.options).toEqual(['', ReasoningEffort.low, ReasoningEffort.high]);
    expect(resolve('Grok', 'grok-4', EModelEndpoint.custom)).toBeNull();
  });

  it('uses Anthropic effort only for adaptive-thinking Claude models', () => {
    const config = resolve(EModelEndpoint.anthropic, 'claude-opus-4-6');
    expect(config?.parameter).toBe('effort');
    expect(config?.options).toEqual([
      '',
      AnthropicEffort.low,
      AnthropicEffort.medium,
      AnthropicEffort.high,
      AnthropicEffort.xhigh,
      AnthropicEffort.max,
    ]);
    expect(resolve(EModelEndpoint.anthropic, 'claude-3-5-sonnet-latest')).toBeNull();
  });

  it('uses thinkingLevel for Gemini 3+ but not numeric-budget Gemini models', () => {
    const config = resolve(EModelEndpoint.google, 'gemini-3.1-pro-preview');
    expect(config?.parameter).toBe('thinkingLevel');
    expect(config?.options).toEqual([
      '',
      ThinkingLevel.minimal,
      ThinkingLevel.low,
      ThinkingLevel.medium,
      ThinkingLevel.high,
    ]);
    expect(resolve(EModelEndpoint.google, 'gemini-2.5-pro')).toBeNull();
  });
});
