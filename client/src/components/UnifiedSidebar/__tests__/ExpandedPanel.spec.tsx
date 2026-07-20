import React from 'react';
import { RecoilRoot } from 'recoil';
import '@testing-library/jest-dom/extend-expect';
import { Brain, FileText, MessagesSquare, NotebookPen } from 'lucide-react';
import { render, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MutableSnapshot } from 'recoil';
import { ActivePanelProvider, DEFAULT_PANEL } from '~/Providers/ActivePanelContext';

const mockNewConversation = jest.fn();
const mockClearMessagesCache = jest.fn();

jest.mock('~/store', () => {
  const { atom } = jest.requireActual('recoil');
  let counter = 0;
  const switchAtom = atom({
    key: 'mock-newChatSwitchToHistory',
    default: true,
  });
  const customShortcutsAtom = atom({
    key: 'mock-customShortcuts',
    default: {},
  });
  return {
    __esModule: true,
    default: {
      conversationByIndex: () =>
        atom({ key: `mock-conversationByIndex-${counter++}`, default: null }),
      newChatSwitchToHistory: switchAtom,
      customShortcuts: customShortcutsAtom,
    },
  };
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
  useNewConvo: () => ({ newConversation: mockNewConversation }),
}));

jest.mock('~/utils', () => ({
  clearMessagesCache: (...args: unknown[]) => mockClearMessagesCache(...args),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  CLOSE_SIDEBAR_ID: 'close-sidebar',
}));

jest.mock('~/components/Nav/AccountSettings', () => ({
  __esModule: true,
  default: () => <div data-testid="account-settings" />,
}));

import ExpandedPanel from '../ExpandedPanel';
import store from '~/store';

const createLinks = () => [
  {
    title: 'com_ui_chat_history' as const,
    icon: MessagesSquare,
    id: DEFAULT_PANEL,
  },
  {
    title: 'com_ui_prompts' as const,
    icon: NotebookPen,
    id: 'prompts',
  },
  {
    title: 'com_ui_memories' as const,
    icon: Brain,
    id: 'memories',
  },
  {
    title: 'com_ui_files' as const,
    icon: FileText,
    id: 'files',
  },
];

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderPanel({
  expanded = true,
  onCollapse = jest.fn(),
  onExpand = jest.fn(),
  initialPanel = DEFAULT_PANEL,
  initializeState,
}: {
  expanded?: boolean;
  onCollapse?: jest.Mock;
  onExpand?: jest.Mock;
  initialPanel?: string;
  initializeState?: (snapshot: MutableSnapshot) => void;
} = {}) {
  if (initialPanel !== DEFAULT_PANEL) {
    localStorage.setItem('side:active-panel', initialPanel);
  }

  const result = render(
    <QueryClientProvider client={createQueryClient()}>
      <RecoilRoot initializeState={initializeState}>
        <ActivePanelProvider>
          <ExpandedPanel
            links={createLinks()}
            expanded={expanded}
            onCollapse={onCollapse}
            onExpand={onExpand}
          />
        </ActivePanelProvider>
      </RecoilRoot>
    </QueryClientProvider>,
  );

  return { ...result, onCollapse, onExpand };
}

describe('ExpandedPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  describe('NavIconButton collapse toggle', () => {
    it('collapses sidebar when clicking the active icon while expanded', () => {
      const { onCollapse } = renderPanel({ expanded: true });
      const activeButton = screen.getByRole('button', { name: 'com_ui_chat_history' });
      fireEvent.click(activeButton);
      expect(onCollapse).toHaveBeenCalledTimes(1);
    });

    it('switches panel when clicking an inactive icon while expanded', () => {
      const { onCollapse } = renderPanel({ expanded: true });
      const inactiveButton = screen.getByRole('button', { name: 'com_ui_prompts' });
      fireEvent.click(inactiveButton);
      expect(onCollapse).not.toHaveBeenCalled();
      expect(localStorage.getItem('side:active-panel')).toBe('prompts');
    });

    it('expands sidebar when clicking any icon while collapsed', () => {
      const { onExpand } = renderPanel({ expanded: false });
      const activeButton = screen.getByRole('button', { name: 'com_ui_chat_history' });
      fireEvent.click(activeButton);
      expect(onExpand).toHaveBeenCalledTimes(1);
    });

    it('sets active panel and expands when clicking an inactive icon while collapsed', () => {
      const { onExpand } = renderPanel({ expanded: false });
      const inactiveButton = screen.getByRole('button', { name: 'com_ui_prompts' });
      fireEvent.click(inactiveButton);
      expect(onExpand).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('side:active-panel')).toBe('prompts');
    });
  });

  describe('tools overflow menu', () => {
    it('keeps only primary links in the icon strip', () => {
      renderPanel();

      expect(screen.getByRole('button', { name: 'com_ui_chat_history' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'com_ui_prompts' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'com_ui_memories' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'com_ui_files' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'com_ui_tools' })).toBeInTheDocument();
    });

    it('opens a secondary panel from the tools menu', async () => {
      renderPanel();

      await userEvent.click(screen.getByRole('button', { name: 'com_ui_tools' }));
      const filesLink = await screen.findByRole('menuitem', { name: 'com_ui_files' });
      await userEvent.click(filesLink);

      expect(localStorage.getItem('side:active-panel')).toBe('files');
    });

    it('marks the tools button active for a secondary panel', () => {
      renderPanel({ initialPanel: 'memories' });

      expect(screen.getByRole('button', { name: 'com_ui_tools' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('expands the sidebar after choosing a secondary panel while collapsed', async () => {
      const { onExpand } = renderPanel({ expanded: false });

      await userEvent.click(screen.getByRole('button', { name: 'com_ui_tools' }));
      const memoriesLink = await screen.findByRole('menuitem', { name: 'com_ui_memories' });
      await userEvent.click(memoriesLink);

      expect(onExpand).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('side:active-panel')).toBe('memories');
    });
  });

  describe('NewChatButton panel switch', () => {
    it('switches to chat history panel on new chat click when setting is enabled', () => {
      renderPanel({ expanded: true, initialPanel: 'prompts' });

      const newChatLink = screen.getByTestId('new-chat-button');
      fireEvent.click(newChatLink);

      expect(mockNewConversation).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('side:active-panel')).toBe(DEFAULT_PANEL);
    });

    it('does not switch panel on new chat click when setting is disabled', () => {
      renderPanel({
        expanded: true,
        initialPanel: 'prompts',
        initializeState: ({ set }: MutableSnapshot) => {
          set(store.newChatSwitchToHistory, false);
        },
      });

      const newChatLink = screen.getByTestId('new-chat-button');
      fireEvent.click(newChatLink);

      expect(mockNewConversation).toHaveBeenCalledTimes(1);
      expect(localStorage.getItem('side:active-panel')).toBe('prompts');
    });
  });
});
