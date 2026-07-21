import {
  getThinkingBaseModel,
  getThinkingModelPair,
  resolveThinkingModel,
  isThinkingModelEnabled,
  collapseThinkingModelPairs,
} from '../thinking';

const models = [
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5-20251001-thinking',
  'claude-opus-4-5-20251101',
  'claude-opus-4-5-20251101-thinking',
  'claude-opus-4-6',
  'claude-opus-4-6-thinking',
];

describe('thinking model pairs', () => {
  it('collapses complete pairs to their standard model in API order', () => {
    expect(collapseThinkingModelPairs(models)).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-opus-4-5-20251101',
      'claude-opus-4-6',
    ]);
  });

  it('keeps an unpaired thinking model visible', () => {
    expect(collapseThinkingModelPairs(['custom-thinking', 'other-model'])).toEqual([
      'custom-thinking',
      'other-model',
    ]);
    expect(getThinkingModelPair(['custom-thinking'], 'custom-thinking')).toBeNull();
  });

  it('resolves either member of a complete pair', () => {
    expect(getThinkingModelPair(models, 'claude-opus-4-6')).toEqual({
      model: 'claude-opus-4-6',
      thinkingModel: 'claude-opus-4-6-thinking',
    });
    expect(getThinkingModelPair(models, 'claude-opus-4-6-thinking')).toEqual({
      model: 'claude-opus-4-6',
      thinkingModel: 'claude-opus-4-6-thinking',
    });
  });

  it('derives display and toggle state from the actual model ID', () => {
    expect(getThinkingBaseModel(models, 'claude-opus-4-6-thinking')).toBe('claude-opus-4-6');
    expect(isThinkingModelEnabled(models, 'claude-opus-4-6-thinking')).toBe(true);
    expect(isThinkingModelEnabled(models, 'claude-opus-4-6')).toBe(false);
  });

  it('routes to the requested pair member without guessing unavailable models', () => {
    expect(resolveThinkingModel(models, 'claude-opus-4-6', true)).toBe('claude-opus-4-6-thinking');
    expect(resolveThinkingModel(models, 'claude-opus-4-6-thinking', false)).toBe('claude-opus-4-6');
    expect(resolveThinkingModel(models, 'unpaired-model', true)).toBe('unpaired-model');
  });
});
