const { logger } = require('@librechat/data-schemas');
const { getModelListCapabilities } = require('@librechat/api');
const { modelCapabilitiesResponseKey } = require('librechat-data-provider');
const { loadDefaultModels, loadConfigModels } = require('~/server/services/Config');

const getModelsConfig = (req) => loadModels(req);

async function loadModels(req) {
  const defaultModelsConfig = await loadDefaultModels(req);
  const customModelsConfig = await loadConfigModels(req);
  return { ...defaultModelsConfig, ...customModelsConfig };
}

function collectModelCapabilities(modelConfig) {
  const capabilities = {};
  for (const [endpoint, models] of Object.entries(modelConfig)) {
    if (!Array.isArray(models)) {
      continue;
    }
    const endpointCapabilities = getModelListCapabilities(models);
    if (endpointCapabilities && Object.keys(endpointCapabilities).length > 0) {
      capabilities[endpoint] = endpointCapabilities;
    }
  }
  return capabilities;
}

async function modelController(req, res) {
  try {
    const modelConfig = await loadModels(req);
    res.send({
      ...modelConfig,
      [modelCapabilitiesResponseKey]: collectModelCapabilities(modelConfig),
    });
  } catch (error) {
    logger.error('Error fetching models:', error);
    res.status(500).send({ error: error.message });
  }
}

module.exports = { collectModelCapabilities, modelController, loadModels, getModelsConfig };
