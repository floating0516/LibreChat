import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';
import debounce from 'lodash/debounce';
import { EModelEndpoint, isAgentsEndpoint, isAssistantsEndpoint } from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';
import type { Endpoint, SelectedValues } from '~/common';
import {
  useAgentDefaultPermissionLevel,
  useSelectorEffects,
  useKeyDialog,
  useEndpoints,
  useLocalize,
} from '~/hooks';
import { useAgentsMapContext, useAssistantsMapContext, useLiveAnnouncer } from '~/Providers';
import { useGetEndpointsQuery, useListAgentsQuery } from '~/data-provider';
import {
  getThinkingBaseModel,
  resolveThinkingModel,
  isThinkingModelEnabled,
} from '~/utils/thinking';
import { useModelSelectorChatContext } from './ModelSelectorChatContext';
import useSelectMention from '~/hooks/Input/useSelectMention';
import { filterItems } from './utils';

type ModelSelectorContextType = {
  // State
  searchValue: string;
  selectedValues: SelectedValues;
  endpointSearchValues: Record<string, string>;
  searchResults: (t.TModelSpec | Endpoint)[] | null;
  // LibreChat
  modelSpecs: t.TModelSpec[];
  mappedEndpoints: Endpoint[];
  agentsMap: t.TAgentsMap | undefined;
  assistantsMap: t.TAssistantsMap | undefined;
  endpointsConfig: t.TEndpointsConfig;

  // Functions
  endpointRequiresUserKey: (endpoint: string) => boolean;
  setSelectedValues: React.Dispatch<React.SetStateAction<SelectedValues>>;
  setSearchValue: (value: string) => void;
  setEndpointSearchValue: (endpoint: string, value: string) => void;
  handleSelectSpec: (spec: t.TModelSpec) => void;
  handleSelectEndpoint: (endpoint: Endpoint) => void;
  handleSelectModel: (endpoint: Endpoint, model: string) => void;
} & ReturnType<typeof useKeyDialog>;

const ModelSelectorContext = createContext<ModelSelectorContextType | undefined>(undefined);

export function useModelSelectorContext() {
  const context = useContext(ModelSelectorContext);
  if (context === undefined) {
    throw new Error('useModelSelectorContext must be used within a ModelSelectorProvider');
  }
  return context;
}

interface ModelSelectorProviderProps {
  children: React.ReactNode;
  startupConfig: t.TStartupConfig | undefined;
}

export function ModelSelectorProvider({ children, startupConfig }: ModelSelectorProviderProps) {
  const agentsMap = useAgentsMapContext();
  const assistantsMap = useAssistantsMapContext();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const {
    endpoint: conversationEndpoint,
    model: conversationModel,
    spec,
    agent_id,
    assistant_id,
    getConversation,
    newConversation,
  } = useModelSelectorChatContext();
  const localize = useLocalize();
  const { announcePolite } = useLiveAnnouncer();
  const modelSpecs = useMemo(() => {
    const specs = startupConfig?.modelSpecs?.list ?? [];
    if (!agentsMap) {
      return specs;
    }

    /**
     * Filter modelSpecs to only include agents the user has access to.
     * Use agentsMap which already contains permission-filtered agents (consistent with other components).
     */
    return specs.filter((spec) => {
      if (spec.preset?.endpoint === EModelEndpoint.agents && spec.preset?.agent_id) {
        return spec.preset.agent_id in agentsMap;
      }
      /** Keep non-agent modelSpecs */
      return true;
    });
  }, [startupConfig, agentsMap]);

  const permissionLevel = useAgentDefaultPermissionLevel();
  const { data: agents = null } = useListAgentsQuery(
    { requiredPermission: permissionLevel },
    {
      select: (data) => data?.data,
    },
  );

  const { mappedEndpoints, modelsConfig, endpointRequiresUserKey } = useEndpoints({
    agents,
    assistantsMap,
    startupConfig,
    endpointsConfig,
  });
  const displayedConversationModel = useMemo(
    () => getThinkingBaseModel(modelsConfig?.[conversationEndpoint ?? ''], conversationModel),
    [conversationEndpoint, conversationModel, modelsConfig],
  );

  const getModelDisplayName = useCallback(
    (endpoint: Endpoint, model: string): string => {
      if (isAgentsEndpoint(endpoint.value)) {
        return endpoint.agentNames?.[model] ?? agentsMap?.[model]?.name ?? model;
      }

      if (isAssistantsEndpoint(endpoint.value)) {
        return endpoint.assistantNames?.[model] ?? model;
      }

      return model;
    },
    [agentsMap],
  );

  const { onSelectEndpoint, onSelectSpec } = useSelectMention({
    // presets,
    modelSpecs,
    getConversation,
    assistantsMap,
    endpointsConfig,
    newConversation,
    returnHandlers: true,
  });

  // State
  const [selectedValues, setSelectedValues] = useState<SelectedValues>(() => {
    let initialModel = displayedConversationModel;
    if (isAgentsEndpoint(conversationEndpoint) && agent_id) {
      initialModel = agent_id;
    } else if (isAssistantsEndpoint(conversationEndpoint) && assistant_id) {
      initialModel = assistant_id;
    }
    return {
      endpoint: conversationEndpoint || '',
      model: initialModel,
      modelSpec: spec || '',
    };
  });
  useSelectorEffects({
    agentsMap,
    conversation: conversationEndpoint
      ? ({
          endpoint: conversationEndpoint ?? null,
          model: displayedConversationModel || null,
          spec: spec ?? null,
          agent_id: agent_id ?? null,
          assistant_id: assistant_id ?? null,
        } as any)
      : null,
    assistantsMap,
    setSelectedValues,
  });

  const [searchValue, setSearchValueState] = useState('');
  const [endpointSearchValues, setEndpointSearchValues] = useState<Record<string, string>>({});

  const keyProps = useKeyDialog();

  /** Memoized search results */
  const searchResults = useMemo(() => {
    if (!searchValue) {
      return null;
    }
    const allItems = [...modelSpecs, ...mappedEndpoints];
    return filterItems(allItems, searchValue, agentsMap, assistantsMap || {}, localize);
  }, [searchValue, modelSpecs, mappedEndpoints, agentsMap, assistantsMap, localize]);

  const setDebouncedSearchValue = useMemo(
    () =>
      debounce((value: string) => {
        setSearchValueState(value);
      }, 200),
    [],
  );
  const setEndpointSearchValue = useCallback((endpoint: string, value: string) => {
    setEndpointSearchValues((prev) => ({
      ...prev,
      [endpoint]: value,
    }));
  }, []);

  const handleSelectSpec = useCallback(
    (spec: t.TModelSpec) => {
      let model = spec.preset.model ?? null;
      onSelectSpec?.(spec);
      if (isAgentsEndpoint(spec.preset.endpoint)) {
        model = spec.preset.agent_id ?? '';
      } else if (isAssistantsEndpoint(spec.preset.endpoint)) {
        model = spec.preset.assistant_id ?? '';
      }
      setSelectedValues({
        endpoint: spec.preset.endpoint,
        model: getThinkingBaseModel(modelsConfig?.[spec.preset.endpoint ?? ''], model),
        modelSpec: spec.name,
      });
    },
    [modelsConfig, onSelectSpec],
  );

  const handleSelectEndpoint = useCallback(
    (endpoint: Endpoint) => {
      if (!endpoint.hasModels) {
        if (endpoint.value) {
          onSelectEndpoint?.(endpoint.value);
        }
        setSelectedValues({
          endpoint: endpoint.value,
          model: '',
          modelSpec: '',
        });
      }
    },
    [onSelectEndpoint],
  );

  const handleSelectModel = useCallback(
    (endpoint: Endpoint, model: string) => {
      if (isAgentsEndpoint(endpoint.value)) {
        onSelectEndpoint?.(endpoint.value, {
          agent_id: model,
          model: agentsMap?.[model]?.model ?? '',
        });
      } else if (isAssistantsEndpoint(endpoint.value)) {
        onSelectEndpoint?.(endpoint.value, {
          assistant_id: model,
          model: assistantsMap?.[endpoint.value]?.[model]?.model ?? '',
        });
      } else if (endpoint.value) {
        const thinkingEnabled = isThinkingModelEnabled(
          modelsConfig?.[conversationEndpoint ?? ''],
          conversationModel,
        );
        const resolvedModel = resolveThinkingModel(
          modelsConfig?.[endpoint.value],
          model,
          thinkingEnabled,
        );
        onSelectEndpoint?.(endpoint.value, { model: resolvedModel });
      }
      setSelectedValues({
        endpoint: endpoint.value,
        model: getThinkingBaseModel(modelsConfig?.[endpoint.value], model),
        modelSpec: '',
      });

      const modelDisplayName = getModelDisplayName(
        endpoint,
        getThinkingBaseModel(modelsConfig?.[endpoint.value], model),
      );
      const announcement = localize('com_ui_model_selected', { 0: modelDisplayName });
      announcePolite({ message: announcement, isStatus: true });
    },
    [
      agentsMap,
      announcePolite,
      assistantsMap,
      conversationEndpoint,
      conversationModel,
      getModelDisplayName,
      localize,
      modelsConfig,
      onSelectEndpoint,
    ],
  );

  const value = useMemo(
    () => ({
      searchValue,
      searchResults,
      selectedValues,
      endpointSearchValues,
      agentsMap,
      modelSpecs,
      assistantsMap,
      mappedEndpoints,
      endpointsConfig,
      handleSelectSpec,
      handleSelectModel,
      setSelectedValues,
      handleSelectEndpoint,
      setEndpointSearchValue,
      endpointRequiresUserKey,
      setSearchValue: setDebouncedSearchValue,
      ...keyProps,
    }),
    [
      searchValue,
      searchResults,
      selectedValues,
      endpointSearchValues,
      agentsMap,
      modelSpecs,
      assistantsMap,
      mappedEndpoints,
      endpointsConfig,
      handleSelectSpec,
      handleSelectModel,
      setSelectedValues,
      handleSelectEndpoint,
      setEndpointSearchValue,
      endpointRequiresUserKey,
      setDebouncedSearchValue,
      keyProps,
    ],
  );

  return <ModelSelectorContext.Provider value={value}>{children}</ModelSelectorContext.Provider>;
}
