import React from 'react';
import * as Ariakit from '@ariakit/react';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import MCPSubMenu from '../MCPSubMenu';

const mockToggleServerSelection = jest.fn();

const defaultMcpServerManager = {
  isPinned: true,
  mcpValues: [] as string[],
  placeholderText: 'MCP Servers',
  selectableServers: [
    { serverName: 'server-a', config: { title: 'Server A' } },
    { serverName: 'server-b', config: { title: 'Server B', description: 'Second server' } },
  ],
  connectionStatus: {},
  isInitializing: () => false,
  getConfigDialogProps: () => null,
  toggleServerSelection: mockToggleServerSelection,
  getServerStatusIconProps: () => null,
};

let mockMcpServerManager = { ...defaultMcpServerManager };

jest.mock('~/Providers', () => ({
  useBadgeRowContext: () => ({
    storageContextKey: undefined,
    mcpServerManager: mockMcpServerManager,
  }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<number, number>) =>
    key === 'com_ui_x_selected' ? `${values?.[0]} selected` : key,
  useHasAccess: () => true,
}));

jest.mock('@librechat/client', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require('react');
  return {
    MCPIcon: ({ className }: { className?: string }) => R.createElement('span', { className }),
    Spinner: ({ className }: { className?: string }) => R.createElement('span', { className }),
  };
});

jest.mock('~/components/MCP/MCPConfigDialog', () => ({
  __esModule: true,
  default: () => null,
}));

function ParentMenu({ children }: { children: React.ReactNode }) {
  return (
    <Ariakit.MenuProvider>
      {/* eslint-disable-next-line i18next/no-literal-string */}
      <Ariakit.MenuButton>Parent</Ariakit.MenuButton>
      <Ariakit.Menu open={true}>{children}</Ariakit.Menu>
    </Ariakit.MenuProvider>
  );
}

function renderSubMenu(props: React.ComponentProps<typeof MCPSubMenu> = {}) {
  return render(
    <ParentMenu>
      <MCPSubMenu {...props} />
    </ParentMenu>,
  );
}

describe('MCPSubMenu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMcpServerManager = { ...defaultMcpServerManager };
  });

  it('renders nothing when selectableServers is empty', () => {
    mockMcpServerManager = { ...defaultMcpServerManager, selectableServers: [] };
    renderSubMenu();
    expect(screen.queryByTestId('tools-menu-advanced')).not.toBeInTheDocument();
  });

  it('renders MCP behind the advanced trigger', () => {
    renderSubMenu();
    const trigger = screen.getByTestId('tools-menu-advanced');
    expect(trigger).toHaveTextContent('com_ui_advanced');
    expect(trigger).toHaveAccessibleName('com_ui_advanced: MCP Servers');
  });

  it('uses the custom placeholder in the accessible label', () => {
    renderSubMenu({ placeholder: 'Custom Label' });
    expect(screen.getByTestId('tools-menu-advanced')).toHaveAccessibleName(
      'com_ui_advanced: Custom Label',
    );
  });

  it('opens submenu and shows real server items', async () => {
    const user = userEvent.setup();
    renderSubMenu();

    await user.click(screen.getByTestId('tools-menu-advanced'));

    const menu = screen.getByRole('menu', { name: /MCP Servers/i });
    expect(menu).toBeVisible();
    expect(within(menu).getByRole('menuitemcheckbox', { name: /Server A/i })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitemcheckbox', { name: /Server B/i })).toBeInTheDocument();
  });

  it('keeps menu open after toggling a server item', async () => {
    const user = userEvent.setup();
    renderSubMenu();

    await user.click(screen.getByTestId('tools-menu-advanced'));
    await user.click(screen.getByRole('menuitemcheckbox', { name: /Server A/i }));

    expect(mockToggleServerSelection).toHaveBeenCalledWith('server-a');
    expect(screen.getByRole('menu', { name: /MCP Servers/i })).toBeVisible();
  });

  it('shows the selected server count without pin controls', () => {
    mockMcpServerManager = {
      ...defaultMcpServerManager,
      mcpValues: ['server-a'],
    };
    renderSubMenu();

    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /com_ui_(un)?pin/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('tools-menu-selection').querySelector('svg')).not.toBeNull();
  });

  it('arrow-key navigation wraps from last item to first', async () => {
    const user = userEvent.setup();
    renderSubMenu();

    await user.click(screen.getByTestId('tools-menu-advanced'));
    const items = screen.getAllByRole('menuitemcheckbox');
    expect(items).toHaveLength(2);

    await user.click(items[1]);
    expect(items[1]).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(items[0]).toHaveFocus();
  });
});
