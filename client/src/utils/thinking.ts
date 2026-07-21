const THINKING_MODEL_SUFFIX = '-thinking';

export interface ThinkingModelPair {
  model: string;
  thinkingModel: string;
}

function getBaseModel(model: string): string {
  if (!model.endsWith(THINKING_MODEL_SUFFIX)) {
    return model;
  }
  return model.slice(0, -THINKING_MODEL_SUFFIX.length);
}

export function getThinkingModelPair(
  models: readonly string[] | undefined,
  model: string | null | undefined,
): ThinkingModelPair | null {
  if (!models?.length || !model) {
    return null;
  }

  const baseModel = getBaseModel(model);
  if (!baseModel) {
    return null;
  }

  const thinkingModel = `${baseModel}${THINKING_MODEL_SUFFIX}`;
  let hasBaseModel = false;
  let hasThinkingModel = false;

  for (const candidate of models) {
    if (candidate === baseModel) {
      hasBaseModel = true;
    } else if (candidate === thinkingModel) {
      hasThinkingModel = true;
    }
    if (hasBaseModel && hasThinkingModel) {
      return { model: baseModel, thinkingModel };
    }
  }

  return null;
}

export function getThinkingBaseModel(
  models: readonly string[] | undefined,
  model: string | null | undefined,
): string {
  return getThinkingModelPair(models, model)?.model ?? model ?? '';
}

export function isThinkingModelEnabled(
  models: readonly string[] | undefined,
  model: string | null | undefined,
): boolean {
  const pair = getThinkingModelPair(models, model);
  return pair?.thinkingModel === model;
}

export function resolveThinkingModel(
  models: readonly string[] | undefined,
  model: string,
  thinkingEnabled: boolean,
): string {
  const pair = getThinkingModelPair(models, model);
  if (!pair) {
    return model;
  }
  return thinkingEnabled ? pair.thinkingModel : pair.model;
}

export function collapseThinkingModelPairs(models: readonly string[]): string[] {
  const availableModels = new Set(models);

  return models.filter((model) => {
    if (!model.endsWith(THINKING_MODEL_SUFFIX)) {
      return true;
    }
    const baseModel = getBaseModel(model);
    return !baseModel || !availableModels.has(baseModel);
  });
}
