import React from 'react';
import * as Ariakit from '@ariakit/react';
import { Check, ChevronRight, Settings2 } from 'lucide-react';
import MCPServerMenuItem from '~/components/MCP/MCPServerMenuItem';
import MCPConfigDialog from '~/components/MCP/MCPConfigDialog';
import { useBadgeRowContext } from '~/Providers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface MCPSubMenuProps extends React.HTMLAttributes<HTMLButtonElement> {
  placeholder?: string;
}

const MCPSubMenu = React.forwardRef<HTMLButtonElement, MCPSubMenuProps>(
  ({ placeholder, className, ...props }, ref) => {
    const localize = useLocalize();
    const context = useBadgeRowContext();
    const { storageContextKey, mcpServerManager } = context ?? {};

    const menuStore = Ariakit.useMenuStore({
      focusLoop: true,
      showTimeout: 100,
      placement: 'right',
    });

    if (!mcpServerManager) {
      return null;
    }

    const {
      mcpValues,
      isInitializing,
      placeholderText,
      connectionStatus,
      selectableServers,
      getConfigDialogProps,
      toggleServerSelection,
      getServerStatusIconProps,
    } = mcpServerManager;

    if (!selectableServers || selectableServers.length === 0) {
      return null;
    }

    const configDialogProps = getConfigDialogProps();
    const selectedCount = mcpValues?.length ?? 0;
    const mcpLabel = placeholder || placeholderText;
    const selectedLabel =
      selectedCount > 0 ? localize('com_ui_x_selected', { 0: selectedCount }) : null;
    const accessibleLabel = selectedLabel
      ? `${localize('com_ui_advanced')}: ${mcpLabel}, ${selectedLabel}`
      : `${localize('com_ui_advanced')}: ${mcpLabel}`;

    return (
      <>
        <Ariakit.MenuProvider store={menuStore}>
          <Ariakit.MenuButton
            ref={ref}
            {...props}
            aria-label={accessibleLabel}
            data-testid="tools-menu-advanced"
            onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              menuStore.toggle();
            }}
            className={cn(
              'flex w-full cursor-pointer items-center justify-between rounded-lg p-2 hover:bg-surface-hover',
              className,
            )}
          >
            <div className="flex items-center gap-2">
              <Settings2 className="icon-md" aria-hidden="true" />
              <span>{localize('com_ui_advanced')}</span>
            </div>
            <div className="flex items-center gap-2">
              {selectedLabel && (
                <span className="text-xs text-text-secondary">{selectedLabel}</span>
              )}
              <span
                aria-hidden="true"
                data-testid="tools-menu-selection"
                className="flex size-4 shrink-0 items-center justify-center text-text-primary"
              >
                {selectedCount > 0 && <Check className="size-4" strokeWidth={2.5} />}
              </span>
              <ChevronRight className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            </div>
          </Ariakit.MenuButton>

          <Ariakit.Menu
            portal={true}
            unmountOnHide={true}
            aria-label={mcpLabel}
            className={cn(
              'animate-popover-left z-40 ml-3 flex min-w-[260px] max-w-[320px] flex-col rounded-xl',
              'border border-border-light bg-presentation p-1.5 shadow-lg',
            )}
          >
            <div className="flex max-h-[320px] flex-col gap-1 overflow-y-auto">
              {selectableServers.map((server) => (
                <MCPServerMenuItem
                  key={server.serverName}
                  server={server}
                  isSelected={mcpValues?.includes(server.serverName) ?? false}
                  connectionStatus={connectionStatus}
                  isInitializing={isInitializing}
                  statusIconProps={getServerStatusIconProps(server.serverName)}
                  onToggle={toggleServerSelection}
                />
              ))}
            </div>
          </Ariakit.Menu>
        </Ariakit.MenuProvider>
        {configDialogProps && (
          <MCPConfigDialog {...configDialogProps} storageContextKey={storageContextKey} />
        )}
      </>
    );
  },
);

MCPSubMenu.displayName = 'MCPSubMenu';

export default React.memo(MCPSubMenu);
