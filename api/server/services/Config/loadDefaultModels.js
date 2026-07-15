const { logger } = require('@librechat/data-schemas');
const { AuthKeys, EModelEndpoint } = require('librechat-data-provider');
const {
  mergeHeaders,
  getAnthropicModels,
  getBedrockModels,
  getOpenAIModels,
  getGoogleModels,
  isUserProvided,
} = require('@librechat/api');
const { getAppConfig } = require('./app');
const { getUserKey } = require('~/models');

/**
 * Loads the default models for the application.
 * @async
 * @function
 * @param {ServerRequest} req - The Express request object.
 */
async function loadDefaultModels(req) {
  try {
    const userId = req.user?.id;
    const appConfig =
      req.config ??
      (await getAppConfig({
        role: req.user?.role,
        userId: req.user?.id,
        tenantId: req.user?.tenantId,
      }));
    const vertexConfig = appConfig?.endpoints?.[EModelEndpoint.anthropic]?.vertexConfig;

    /** Forward configured custom headers (endpoint over global `all`) so model
     *  fetches reach a gateway-fronted provider the same as chat requests. */
    const allHeaders = appConfig?.endpoints?.all?.headers;
    const openAIHeaders = mergeHeaders(
      allHeaders,
      appConfig?.endpoints?.[EModelEndpoint.openAI]?.headers,
    );
    const anthropicHeaders = mergeHeaders(
      allHeaders,
      appConfig?.endpoints?.[EModelEndpoint.anthropic]?.headers,
    );

    const loadUserKey = async (environmentKey, endpoint, property) => {
      if (!userId || !isUserProvided(process.env[environmentKey])) {
        return undefined;
      }

      try {
        const storedKey = await getUserKey({ userId, name: endpoint });
        if (!property) {
          return storedKey;
        }

        const values = JSON.parse(storedKey);
        const value = values?.[property];
        return typeof value === 'string' && value.trim() ? value : undefined;
      } catch {
        logger.debug(`Unable to load the ${endpoint} user key for model discovery.`);
        return undefined;
      }
    };

    const [openAIApiKey, anthropicApiKey, googleApiKey] = await Promise.all([
      loadUserKey('OPENAI_API_KEY', EModelEndpoint.openAI, 'apiKey'),
      loadUserKey('ANTHROPIC_API_KEY', EModelEndpoint.anthropic),
      loadUserKey('GOOGLE_KEY', EModelEndpoint.google, AuthKeys.GOOGLE_API_KEY),
    ]);
    const openAIUsesUserKey = isUserProvided(process.env.OPENAI_API_KEY);
    const anthropicUsesUserKey = isUserProvided(process.env.ANTHROPIC_API_KEY);
    const googleUsesUserKey = isUserProvided(process.env.GOOGLE_KEY);

    const [openAI, anthropic, azureOpenAI, assistants, azureAssistants, google, bedrock] =
      await Promise.all([
        getOpenAIModels({
          user: userId,
          openAIApiKey,
          fallbackModels: openAIUsesUserKey ? [] : undefined,
          skipCache: Boolean(openAIApiKey),
          headers: openAIHeaders,
          userObject: req.user,
        }).catch((error) => {
          logger.error('Error fetching OpenAI models:', error);
          return [];
        }),
        getAnthropicModels({
          user: userId,
          anthropicApiKey,
          fallbackModels: anthropicUsesUserKey ? [] : undefined,
          skipCache: Boolean(anthropicApiKey),
          vertexModels: vertexConfig?.modelNames,
          headers: anthropicHeaders,
          userObject: req.user,
        }).catch((error) => {
          logger.error('Error fetching Anthropic models:', error);
          return [];
        }),
        getOpenAIModels({ user: req.user.id, azure: true }).catch((error) => {
          logger.error('Error fetching Azure OpenAI models:', error);
          return [];
        }),
        getOpenAIModels({ assistants: true }).catch((error) => {
          logger.error('Error fetching OpenAI Assistants API models:', error);
          return [];
        }),
        getOpenAIModels({ azureAssistants: true }).catch((error) => {
          logger.error('Error fetching Azure OpenAI Assistants API models:', error);
          return [];
        }),
        getGoogleModels({
          googleApiKey,
          fallbackModels: googleUsesUserKey ? [] : undefined,
        }).catch((error) => {
          logger.error('Error getting Google models:', error);
          return [];
        }),
        Promise.resolve(getBedrockModels()).catch((error) => {
          logger.error('Error getting Bedrock models:', error);
          return [];
        }),
      ]);

    return {
      [EModelEndpoint.openAI]: openAI,
      [EModelEndpoint.google]: google,
      [EModelEndpoint.anthropic]: anthropic,
      [EModelEndpoint.azureOpenAI]: azureOpenAI,
      [EModelEndpoint.assistants]: assistants,
      [EModelEndpoint.azureAssistants]: azureAssistants,
      [EModelEndpoint.bedrock]: bedrock,
    };
  } catch (error) {
    logger.error('Error fetching default models:', error);
    throw new Error(`Failed to load default models: ${error.message}`);
  }
}

module.exports = loadDefaultModels;
