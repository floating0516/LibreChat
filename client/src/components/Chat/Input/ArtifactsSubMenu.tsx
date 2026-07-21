import React from 'react';
import * as Ariakit from '@ariakit/react';
import { ArtifactModes } from 'librechat-data-provider';
import { Check, ChevronRight, WandSparkles } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface ArtifactsSubMenuProps extends React.HTMLAttributes<HTMLButtonElement> {
  artifactsMode: string;
  handleArtifactsToggle: () => void;
  handleShadcnToggle: () => void;
  handleCustomToggle: () => void;
}

const ArtifactsSubMenu = React.forwardRef<HTMLButtonElement, ArtifactsSubMenuProps>(
  (
    {
      artifactsMode,
      handleArtifactsToggle,
      handleShadcnToggle,
      handleCustomToggle,
      className,
      ...props
    },
    ref,
  ) => {
    const localize = useLocalize();

    const menuStore = Ariakit.useMenuStore({
      focusLoop: true,
      showTimeout: 100,
      placement: 'right',
    });

    const isEnabled = artifactsMode !== '' && artifactsMode !== undefined;
    const isShadcnEnabled = artifactsMode === ArtifactModes.SHADCNUI;
    const isCustomEnabled = artifactsMode === ArtifactModes.CUSTOM;

    return (
      <>
        <Ariakit.MenuProvider store={menuStore}>
          <Ariakit.MenuButton
            ref={ref}
            {...props}
            onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              handleArtifactsToggle();
            }}
            onMouseEnter={() => {
              if (isEnabled) {
                menuStore.show();
              }
            }}
            className={cn(
              'flex w-full cursor-pointer items-center justify-between rounded-lg p-2 hover:bg-surface-hover',
              className,
            )}
          >
            <div className="flex items-center gap-2">
              <WandSparkles className="icon-md" aria-hidden="true" />
              <span>{localize('com_ui_artifacts')}</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                data-testid="tools-menu-selection"
                className="flex size-4 shrink-0 items-center justify-center text-text-primary"
              >
                {isEnabled && <Check className="size-4" strokeWidth={2.5} />}
              </span>
              <ChevronRight
                className={cn('h-3 w-3', !isEnabled && 'invisible')}
                aria-hidden="true"
              />
            </div>
          </Ariakit.MenuButton>

          {isEnabled && (
            <Ariakit.Menu
              portal={true}
              unmountOnHide={true}
              className={cn(
                'animate-popover-left z-40 ml-3 mt-6 flex min-w-[250px] flex-col rounded-xl',
                'border border-border-light bg-surface-secondary shadow-lg',
              )}
            >
              <div className="px-2 py-1.5">
                <div className="mb-2 text-xs font-medium text-text-secondary">
                  {localize('com_ui_artifacts_options')}
                </div>

                {/* Include shadcn/ui Option */}
                <Ariakit.MenuItem
                  hideOnClick={false}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleShadcnToggle();
                  }}
                  className={cn(
                    'mb-1 flex items-center justify-between gap-2 rounded-lg px-2 py-2',
                    'cursor-pointer bg-surface-secondary text-text-primary outline-none transition-colors',
                    'hover:bg-surface-hover data-[active-item]:bg-surface-hover',
                    isShadcnEnabled && 'bg-surface-active',
                  )}
                >
                  <span className="text-sm">{localize('com_ui_include_shadcnui' as any)}</span>
                  <div className="ml-auto flex items-center">
                    <Ariakit.MenuItemCheck checked={isShadcnEnabled} />
                  </div>
                </Ariakit.MenuItem>

                {/* Custom Prompt Mode Option */}
                <Ariakit.MenuItem
                  hideOnClick={false}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleCustomToggle();
                  }}
                  className={cn(
                    'mb-1 flex items-center justify-between gap-2 rounded-lg px-2 py-2',
                    'cursor-pointer bg-surface-secondary text-text-primary outline-none transition-colors',
                    'hover:bg-surface-hover data-[active-item]:bg-surface-hover',
                    isCustomEnabled && 'bg-surface-active',
                  )}
                >
                  <span className="text-sm">{localize('com_ui_custom_prompt_mode' as any)}</span>
                  <div className="ml-auto flex items-center">
                    <Ariakit.MenuItemCheck checked={isCustomEnabled} />
                  </div>
                </Ariakit.MenuItem>
              </div>
            </Ariakit.Menu>
          )}
        </Ariakit.MenuProvider>
      </>
    );
  },
);

ArtifactsSubMenu.displayName = 'ArtifactsSubMenu';

export default React.memo(ArtifactsSubMenu);
