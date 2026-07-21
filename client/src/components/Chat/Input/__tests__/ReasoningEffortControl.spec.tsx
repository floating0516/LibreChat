import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { EModelEndpoint } from 'librechat-data-provider';
import type { TConversation, TModelsConfig } from 'librechat-data-provider';
import ReasoningEffortControl from '../ReasoningEffortControl';

const mockSetModel = jest.fn();
const mockSetOption = jest.fn((parameter: string) =>
  parameter === 'model' ? mockSetModel : jest.fn(),
);
let mockModels: TModelsConfig;

jest.mock('librechat-data-provider/react-query', () => ({
  useGetModelsQuery: () => ({ data: mockModels }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useSetIndexOptions: () => ({ setOption: mockSetOption }),
}));

jest.mock('@librechat/client', () => ({
  TooltipAnchor: ({ render }: { render: React.ReactNode }) => render,
}));

jest.mock('@ariakit/react', () => ({
  useMenuStore: () => ({ useState: () => false }),
}));

const pairedModels = ['claude-opus-4-6', 'claude-opus-4-6-thinking'];

function conversation(model: string): TConversation {
  return {
    conversationId: 'new',
    endpoint: EModelEndpoint.openAI,
    endpointType: EModelEndpoint.openAI,
    title: 'New Chat',
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    model,
  };
}

describe('ReasoningEffortControl Thinking model toggle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    mockModels = { [EModelEndpoint.openAI]: pairedModels } as TModelsConfig;
  });

  it('routes a standard model to its Thinking pair', () => {
    render(
      <ReasoningEffortControl conversation={conversation('claude-opus-4-6')} disabled={false} />,
    );

    const toggle = screen.getByRole('switch', { name: 'com_endpoint_thinking: com_ui_off' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);

    expect(mockSetModel).toHaveBeenCalledWith('claude-opus-4-6-thinking');
  });

  it('derives enabled state from history and routes back to the standard model', () => {
    render(
      <ReasoningEffortControl
        conversation={conversation('claude-opus-4-6-thinking')}
        disabled={false}
      />,
    );

    const toggle = screen.getByRole('switch', { name: 'com_endpoint_thinking: com_ui_on' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);

    expect(mockSetModel).toHaveBeenCalledWith('claude-opus-4-6');
  });

  it('does not show a toggle or invent a pair for an unpaired model', () => {
    mockModels = { [EModelEndpoint.openAI]: ['unpaired-model'] } as TModelsConfig;
    render(
      <ReasoningEffortControl conversation={conversation('unpaired-model')} disabled={false} />,
    );

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('prevents model changes while a response is being generated', () => {
    render(<ReasoningEffortControl conversation={conversation('claude-opus-4-6')} disabled />);

    const toggle = screen.getByRole('switch');
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(mockSetModel).not.toHaveBeenCalled();
  });
});
