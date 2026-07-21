import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Endpoint } from '~/common';
import { ModelSelectorProvider, useModelSelectorContext } from '../ModelSelectorContext';

const mockOnSelectEndpoint = jest.fn();
const mockAnnouncePolite = jest.fn();
let mockConversationModel = 'claude-haiku-4-5-20251001';

const mockModels = [
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5-20251001-thinking',
  'claude-opus-4-6',
  'claude-opus-4-6-thinking',
];

const mockEndpoint: Endpoint = {
  value: 'Grok',
  label: 'Grok',
  hasModels: true,
  icon: null,
  models: mockModels.map((name) => ({ name, isGlobal: false })),
};

jest.mock('~/hooks', () => ({
  useAgentDefaultPermissionLevel: () => 0,
  useSelectorEffects: () => undefined,
  useKeyDialog: () => ({}),
  useEndpoints: () => ({
    mappedEndpoints: [mockEndpoint],
    modelsConfig: { Grok: mockModels },
    endpointRequiresUserKey: () => false,
  }),
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/Providers', () => ({
  useAgentsMapContext: () => undefined,
  useAssistantsMapContext: () => undefined,
  useLiveAnnouncer: () => ({ announcePolite: mockAnnouncePolite }),
}));

jest.mock('~/data-provider', () => ({
  useGetEndpointsQuery: () => ({ data: {} }),
  useListAgentsQuery: () => ({ data: null }),
}));

jest.mock('../ModelSelectorChatContext', () => ({
  useModelSelectorChatContext: () => ({
    endpoint: 'Grok',
    model: mockConversationModel,
    spec: null,
    agent_id: null,
    assistant_id: null,
    getConversation: () => null,
    newConversation: jest.fn(),
  }),
}));

jest.mock('~/hooks/Input/useSelectMention', () => () => ({
  onSelectEndpoint: mockOnSelectEndpoint,
  onSelectSpec: jest.fn(),
}));

function ModelSelectionProbe() {
  const { handleSelectModel, selectedValues } = useModelSelectorContext();
  return (
    <>
      <output data-testid="selected-model">{selectedValues.model}</output>
      <button type="button" onClick={() => handleSelectModel(mockEndpoint, 'claude-opus-4-6')}>
        Select Opus
      </button>
    </>
  );
}

describe('ModelSelectorProvider Thinking model routing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('preserves enabled Thinking state when selecting another paired model', () => {
    mockConversationModel = 'claude-haiku-4-5-20251001-thinking';
    render(
      <ModelSelectorProvider startupConfig={undefined}>
        <ModelSelectionProbe />
      </ModelSelectorProvider>,
    );

    expect(screen.getByTestId('selected-model')).toHaveTextContent('claude-haiku-4-5-20251001');
    fireEvent.click(screen.getByRole('button', { name: 'Select Opus' }));

    expect(mockOnSelectEndpoint).toHaveBeenCalledWith('Grok', {
      model: 'claude-opus-4-6-thinking',
    });
    expect(screen.getByTestId('selected-model')).toHaveTextContent('claude-opus-4-6');
  });

  it('keeps Thinking disabled when selecting another paired model', () => {
    mockConversationModel = 'claude-haiku-4-5-20251001';
    render(
      <ModelSelectorProvider startupConfig={undefined}>
        <ModelSelectionProbe />
      </ModelSelectorProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Select Opus' }));

    expect(mockOnSelectEndpoint).toHaveBeenCalledWith('Grok', {
      model: 'claude-opus-4-6',
    });
  });
});
