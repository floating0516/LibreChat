import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import ToolsDropdown from '../ToolsDropdown';

const mockFileSearchChange = jest.fn();
const mockWebSearchChange = jest.fn();
const mockSkillsChange = jest.fn();
const mockCodeChange = jest.fn();
const mockArtifactsChange = jest.fn();
const mockSetSearchDialogOpen = jest.fn();

const mockContext = {
  agentsConfig: { capabilities: [] },
  fileSearch: { toggleState: true, debouncedChange: mockFileSearchChange },
  webSearch: {
    toggleState: true,
    debouncedChange: mockWebSearchChange,
    authData: { authenticated: true, authTypes: [] },
  },
  skills: { toggleState: false, debouncedChange: mockSkillsChange },
  codeInterpreter: { toggleState: false, debouncedChange: mockCodeChange },
  artifacts: { toggleState: 'default', debouncedChange: mockArtifactsChange },
  searchApiKeyForm: {
    setIsDialogOpen: mockSetSearchDialogOpen,
    menuTriggerRef: { current: null },
  },
  mcpServerManager: {
    availableMCPServers: [{ serverName: 'server-a' }],
    mcpValues: [],
  },
};

jest.mock('~/Providers', () => ({
  useBadgeRowContext: () => mockContext,
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useHasAccess: () => true,
  useAgentCapabilities: () => ({
    codeEnabled: true,
    webSearchEnabled: true,
    artifactsEnabled: true,
    fileSearchEnabled: true,
    skillsEnabled: true,
  }),
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: { interface: { mcpServers: {} } } }),
}));

jest.mock('../ArtifactsSubMenu', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    __esModule: true,
    default: () => R.createElement('div', { 'data-testid': 'artifacts-submenu' }, 'artifacts'),
  };
});

jest.mock('../MCPSubMenu', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    __esModule: true,
    default: () => R.createElement('div', { 'data-testid': 'advanced-submenu' }, 'advanced'),
  };
});

jest.mock('@librechat/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    TooltipAnchor: (props) => props.render,
    VectorIcon: () => R.createElement('span', { 'data-testid': 'vector-icon' }),
    DropdownPopup: (props) =>
      R.createElement(
        'div',
        null,
        props.trigger,
        R.createElement(
          'div',
          { role: 'menu' },
          props.items.map((item, index) => {
            if (typeof item.render !== 'function') {
              return R.createElement(R.Fragment, { key: index }, item.render);
            }
            return R.createElement(
              R.Fragment,
              { key: index },
              item.render({
                role: item.ariaChecked === undefined ? 'menuitem' : 'menuitemcheckbox',
                'aria-checked': item.ariaChecked,
                onClick: item.onClick,
              }),
            );
          }),
        ),
      ),
  };
});

jest.mock('@ariakit/react', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    MenuButton: (props) => R.createElement('button', props, props.children),
  };
});

describe('ToolsDropdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows stable enabled states without pin controls and keeps advanced tools last', () => {
    render(<ToolsDropdown />);

    expect(screen.getByRole('button', { name: 'com_ui_tools' })).toBeInTheDocument();
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'com_assistants_file_search' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemcheckbox', { name: 'com_ui_web_search' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'com_ui_skills' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.queryByRole('button', { name: /com_ui_(un)?pin/i })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'com_ui_configure: com_ui_web_search' }),
    ).toBeInTheDocument();

    const menu = screen.getByRole('menu');
    expect(menu.lastElementChild).toBe(within(menu).getByTestId('advanced-submenu'));
  });

  it('toggles an inactive tool directly from the menu', async () => {
    const user = userEvent.setup();
    render(<ToolsDropdown />);

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'com_ui_skills' }));
    expect(mockSkillsChange).toHaveBeenCalledWith({ value: true });
  });
});
