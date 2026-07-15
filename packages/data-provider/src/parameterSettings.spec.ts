import { EModelEndpoint, ReasoningEffort } from './types';
import { applyModelAwareDefaults, paramSettings } from './parameterSettings';
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
