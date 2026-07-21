import { memo, useCallback, useEffect, useMemo } from 'react';
import * as Ariakit from '@ariakit/react';
import { Brain, ChevronDown } from 'lucide-react';
import {
  getInlineReasoningConfig,
  inlineReasoningParameterKeys,
  modelCapabilitiesSymbol,
} from 'librechat-data-provider';
import type { InlineReasoningParameter, TConversation } from 'librechat-data-provider';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import { TooltipAnchor } from '@librechat/client';
import type { TranslationKeys } from '~/hooks';
import { useLocalize, useSetIndexOptions } from '~/hooks';
import { getThinkingModelPair } from '~/utils/thinking';
import { cn, updateLastSelectedModel } from '~/utils';

const labelKeys: Record<string, TranslationKeys> = {
  '': 'com_ui_auto',
  none: 'com_ui_none',
  minimal: 'com_ui_minimal',
  low: 'com_ui_low',
  medium: 'com_ui_medium',
  high: 'com_ui_high',
  xhigh: 'com_ui_xhigh',
  max: 'com_ui_max',
  ultra: 'com_ui_ultra',
};

function getConversationValue(
  conversation: TConversation | null,
  parameter: InlineReasoningParameter,
): string | null | undefined {
  if (parameter === 'effort') {
    return conversation?.effort;
  }
  if (parameter === 'thinkingLevel') {
    return conversation?.thinkingLevel;
  }
  return conversation?.reasoning_effort;
}

function ReasoningEffortControl({
  conversation,
  disabled,
}: {
  conversation: TConversation | null;
  disabled: boolean;
}) {
  const localize = useLocalize();
  const { setOption } = useSetIndexOptions();
  const modelsQuery = useGetModelsQuery();
  const menuStore = Ariakit.useMenuStore({ placement: 'top-end', focusLoop: true });
  const isOpen = menuStore.useState('open');
  const capabilities = modelsQuery.data?.[modelCapabilitiesSymbol];
  const endpointModels = modelsQuery.data?.[conversation?.endpoint ?? ''];
  const thinkingPair = useMemo(
    () => (conversation?.spec ? null : getThinkingModelPair(endpointModels, conversation?.model)),
    [conversation?.model, conversation?.spec, endpointModels],
  );
  const thinkingEnabled = thinkingPair?.thinkingModel === conversation?.model;

  const config = useMemo(() => {
    if (thinkingPair) {
      return null;
    }
    return getInlineReasoningConfig({
      endpoint: conversation?.endpoint,
      endpointType: conversation?.endpointType,
      model: conversation?.model,
      capabilities,
    });
  }, [
    capabilities,
    conversation?.endpoint,
    conversation?.endpointType,
    conversation?.model,
    thinkingPair,
  ]);

  const storedValue = config ? getConversationValue(conversation, config.parameter) : undefined;
  const selectedValue =
    config && storedValue != null && config.options.includes(storedValue)
      ? storedValue
      : (config?.defaultValue ?? '');

  useEffect(() => {
    for (const parameter of inlineReasoningParameterKeys) {
      const value = getConversationValue(conversation, parameter);
      if (parameter !== config?.parameter) {
        if (value != null && value !== '') {
          setOption(parameter)('');
        }
        continue;
      }

      if (value != null && !config.options.includes(value)) {
        setOption(parameter)(config.defaultValue);
      }
    }
  }, [
    config,
    conversation?.effort,
    conversation?.reasoning_effort,
    conversation?.thinkingLevel,
    setOption,
  ]);

  const getLabel = useCallback(
    (value: string) => localize(labelKeys[value] ?? ('com_ui_auto' as TranslationKeys)),
    [localize],
  );

  const handleValuesChange = useCallback(
    (values: Record<string, unknown>) => {
      const value = values.reasoningEffort;
      if (!config || typeof value !== 'string' || !config.options.includes(value)) {
        return;
      }
      setOption(config.parameter)(value);
    },
    [config, setOption],
  );

  const handleThinkingToggle = useCallback(() => {
    if (!thinkingPair || !conversation?.endpoint) {
      return;
    }
    const nextModel = thinkingEnabled ? thinkingPair.model : thinkingPair.thinkingModel;
    setOption('model')(nextModel);
    updateLastSelectedModel({ endpoint: conversation.endpoint, model: nextModel });
  }, [conversation?.endpoint, setOption, thinkingEnabled, thinkingPair]);

  if (thinkingPair) {
    const controlLabel = localize('com_endpoint_thinking');
    const stateLabel = localize(thinkingEnabled ? 'com_ui_on' : 'com_ui_off');

    return (
      <TooltipAnchor
        description={`${controlLabel}: ${stateLabel}`}
        render={
          <button
            type="button"
            role="switch"
            data-testid="thinking-model-toggle"
            aria-label={`${controlLabel}: ${stateLabel}`}
            aria-checked={thinkingEnabled}
            onClick={handleThinkingToggle}
            disabled={disabled}
            className={cn(
              'inline-flex h-9 w-[3.75rem] shrink-0 items-center justify-center gap-1.5 rounded-full',
              'border border-border-medium bg-transparent px-2 transition-colors',
              'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:pointer-events-none disabled:opacity-50',
              thinkingEnabled && 'bg-surface-active-alt',
            )}
          />
        }
      >
        <Brain
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            thinkingEnabled ? 'text-text-primary' : 'text-text-secondary',
          )}
          aria-hidden="true"
        />
        <span
          className={cn(
            'relative h-4 w-7 shrink-0 rounded-full transition-colors',
            thinkingEnabled ? 'bg-surface-submit' : 'bg-surface-tertiary',
          )}
          aria-hidden="true"
        >
          <span
            className={cn(
              'absolute left-0.5 top-0.5 size-3 rounded-full bg-white shadow-sm transition-transform',
              thinkingEnabled && 'translate-x-3',
            )}
          />
        </span>
      </TooltipAnchor>
    );
  }

  if (!config) {
    return null;
  }

  const displayLabel = getLabel(selectedValue);
  const controlLabel = localize('com_endpoint_reasoning_effort');

  return (
    <Ariakit.MenuProvider
      store={menuStore}
      values={{ reasoningEffort: selectedValue }}
      setValues={handleValuesChange}
    >
      <TooltipAnchor
        description={`${controlLabel}: ${displayLabel}`}
        disabled={isOpen}
        render={
          <Ariakit.MenuButton
            type="button"
            disabled={disabled}
            data-testid="reasoning-effort-control"
            aria-label={`${controlLabel}: ${displayLabel}`}
            className={cn(
              'group inline-flex h-9 w-[5.75rem] shrink-0 items-center justify-center gap-1 rounded-full',
              'border border-border-medium bg-transparent px-2 text-xs font-medium text-text-primary',
              'transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:pointer-events-none disabled:opacity-50',
              isOpen && 'bg-surface-hover',
            )}
          />
        }
      >
        <Brain className="h-3.5 w-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-center">{displayLabel}</span>
        <ChevronDown
          className={cn(
            'h-3 w-3 shrink-0 text-text-secondary transition-transform',
            isOpen && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </TooltipAnchor>

      <Ariakit.Menu
        portal
        modal
        gutter={8}
        unmountOnHide
        aria-label={controlLabel}
        className={cn(
          'z-[200] flex min-w-40 flex-col rounded-lg border border-border-light bg-presentation p-1 shadow-lg',
          'origin-bottom opacity-0 transition-[opacity,transform] duration-150',
          'data-[enter]:scale-100 data-[leave]:scale-95 data-[enter]:opacity-100 data-[leave]:opacity-0',
        )}
      >
        {config.options.map((option) => (
          <Ariakit.MenuItemRadio
            key={option || 'auto'}
            name="reasoningEffort"
            value={option}
            className={cn(
              'flex h-9 cursor-default items-center gap-2 rounded-md px-2 text-sm text-text-primary outline-none',
              'data-[active-item]:bg-surface-hover',
            )}
          >
            <span className="flex-1">{getLabel(option)}</span>
            <Ariakit.MenuItemCheck />
          </Ariakit.MenuItemRadio>
        ))}
      </Ariakit.Menu>
    </Ariakit.MenuProvider>
  );
}

export default memo(ReasoningEffortControl);
