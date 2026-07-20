import { memo, useCallback, lazy, Suspense } from 'react';
import { useRecoilValue } from 'recoil';
import { Ellipsis, SquarePen } from 'lucide-react';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Sidebar,
  Skeleton,
  TooltipAnchor,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@librechat/client';
import type { NavLink } from '~/common';
import { useShortcutAriaKey, useShortcutHint } from '~/hooks/useKeyboardShortcuts';
import { useActivePanel, resolveActivePanel, DEFAULT_PANEL } from '~/Providers';
import { CLOSE_SIDEBAR_ID } from '~/components/Chat/Menus/OpenSidebar';
import { useLocalize, useNewConvo } from '~/hooks';
import { clearMessagesCache, cn } from '~/utils';
import store from '~/store';

const AccountSettings = lazy(() => import('~/components/Nav/AccountSettings'));
const MAX_PRIMARY_LINKS = 2;

const NewChatButton = memo(function NewChatButton({
  setActive,
}: {
  setActive: (id: string) => void;
}) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { newConversation } = useNewConvo();
  const conversation = useRecoilValue(store.conversationByIndex(0));
  const switchToHistory = useRecoilValue(store.newChatSwitchToHistory);
  const tooltipDescription = useShortcutHint('newChat', localize('com_ui_new_chat'));
  const ariaKey = useShortcutAriaKey('newChat');

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.button === 0 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        clearMessagesCache(queryClient, conversation?.conversationId);
        queryClient.invalidateQueries([QueryKeys.messages]);
        newConversation();
        if (switchToHistory) {
          setActive(DEFAULT_PANEL);
        }
      }
    },
    [queryClient, conversation?.conversationId, newConversation, switchToHistory, setActive],
  );

  return (
    <TooltipAnchor
      side="right"
      description={tooltipDescription}
      render={
        <a
          href="/c/new"
          data-testid="new-chat-button"
          aria-label={localize('com_ui_new_chat')}
          aria-keyshortcuts={ariaKey}
          className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-hover"
          onClick={handleClick}
        >
          <SquarePen className="h-5 w-5 text-text-primary" />
        </a>
      }
    />
  );
});

const NavIconButton = memo(function NavIconButton({
  link,
  isActive,
  expanded,
  setActive,
  onExpand,
  onCollapse,
}: {
  link: NavLink;
  isActive: boolean;
  expanded: boolean;
  setActive: (id: string) => void;
  onExpand?: () => void;
  onCollapse?: () => void;
}) {
  const localize = useLocalize();

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (link.onClick) {
        link.onClick(e);
        return;
      }
      if (isActive && expanded) {
        onCollapse?.();
        return;
      }
      if (!isActive) {
        setActive(link.id);
      }
      if (!expanded) {
        onExpand?.();
      }
    },
    [link, isActive, setActive, expanded, onExpand, onCollapse],
  );

  return (
    <TooltipAnchor
      description={localize(link.title)}
      side="right"
      render={
        <Button
          size="icon"
          variant="ghost"
          aria-label={localize(link.title)}
          aria-pressed={isActive}
          data-testid={`nav-panel-${link.id}`}
          className={cn(
            'h-9 w-9 rounded-lg',
            isActive ? 'bg-surface-active-alt text-text-primary' : 'text-text-secondary',
          )}
          onClick={handleClick}
        >
          <link.icon className="h-5 w-5" aria-hidden="true" />
        </Button>
      }
    />
  );
});

const ToolsMenu = memo(function ToolsMenu({
  links,
  active,
  expanded,
  setActive,
  onExpand,
}: {
  links: NavLink[];
  active: string;
  expanded: boolean;
  setActive: (id: string) => void;
  onExpand?: () => void;
}) {
  const localize = useLocalize();
  const isActive = links.some((link) => link.id === active);

  const handleSelect = useCallback(
    (link: NavLink) => {
      if (link.onClick) {
        link.onClick();
        return;
      }
      setActive(link.id);
      if (!expanded) {
        onExpand?.();
      }
    },
    [expanded, onExpand, setActive],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          title={localize('com_ui_tools')}
          aria-label={localize('com_ui_tools')}
          aria-pressed={isActive}
          data-testid="nav-panel-tools"
          className={cn(
            'h-9 w-9 rounded-lg',
            isActive ? 'bg-surface-active-alt text-text-primary' : 'text-text-secondary',
          )}
        >
          <Ellipsis className="h-5 w-5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="z-[120] min-w-52">
        {links.map((link) => {
          const linkIsActive = link.id === active;
          return (
            <DropdownMenuItem
              key={link.id}
              aria-current={linkIsActive ? 'page' : undefined}
              data-testid={`nav-tools-${link.id}`}
              className={cn(
                'cursor-pointer',
                linkIsActive && 'bg-surface-active-alt text-text-primary',
              )}
              onSelect={() => handleSelect(link)}
            >
              <link.icon className="h-4 w-4" aria-hidden="true" />
              <span>{localize(link.title)}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

function ExpandedPanel({
  links,
  expanded = true,
  onCollapse,
  onExpand,
}: {
  links: NavLink[];
  expanded?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
}) {
  const localize = useLocalize();
  const { active, setActive } = useActivePanel();
  const effectiveActive = resolveActivePanel(active, links);
  const primaryLinks = links.slice(0, MAX_PRIMARY_LINKS);
  const toolLinks = links.slice(MAX_PRIMARY_LINKS);

  const toggleLabel = expanded ? 'com_nav_close_sidebar' : 'com_nav_open_sidebar';
  const toggleClick = expanded ? onCollapse : onExpand;
  const toggleSidebarHint = useShortcutHint('toggleSidebar', localize(toggleLabel));
  const toggleSidebarAriaKey = useShortcutAriaKey('toggleSidebar');

  return (
    <div className="flex h-full flex-shrink-0 flex-col gap-2 border-r border-border-light bg-surface-primary-alt px-2 py-2">
      <TooltipAnchor
        side="right"
        description={toggleSidebarHint}
        render={
          <Button
            id={expanded ? CLOSE_SIDEBAR_ID : undefined}
            data-testid={expanded ? 'close-sidebar-button' : 'open-sidebar-button'}
            size="icon"
            variant="ghost"
            aria-label={localize(toggleLabel)}
            aria-expanded={expanded}
            aria-keyshortcuts={toggleSidebarAriaKey}
            className="h-9 w-9 rounded-lg"
            onClick={toggleClick}
          >
            <Sidebar aria-hidden="true" className="h-5 w-5 text-text-primary" />
          </Button>
        }
      />
      <NewChatButton setActive={setActive} />
      <div className="mx-2 border-b border-border-light" />
      <div className="flex flex-col gap-1 overflow-y-auto">
        {primaryLinks.map((link) => (
          <NavIconButton
            key={link.id}
            link={link}
            isActive={link.id === effectiveActive}
            expanded={expanded ?? true}
            setActive={setActive}
            onExpand={onExpand}
            onCollapse={onCollapse}
          />
        ))}
        {toolLinks.length > 0 && (
          <ToolsMenu
            links={toolLinks}
            active={effectiveActive}
            expanded={expanded}
            setActive={setActive}
            onExpand={onExpand}
          />
        )}
      </div>

      <div className="mt-auto">
        <Suspense fallback={<Skeleton className="h-9 w-9 rounded-lg" />}>
          <AccountSettings collapsed />
        </Suspense>
      </div>
    </div>
  );
}

export default memo(ExpandedPanel);
