import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TLiheProvider } from 'librechat-data-provider';
import {
  Button,
  AlertDialog,
  AlertDialogTitle,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogContent,
  AlertDialogDescription,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
  useToastContext,
} from '@librechat/client';
import { CheckCircle2, Link2, RefreshCw, Unplug } from 'lucide-react';
import {
  useLiheConnectionStatusQuery,
  useDisconnectLiheConnectionMutation,
  useStartOpenIdLinkMutation,
} from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';

const providerLabels: Record<TLiheProvider, string> = {
  openAI: 'OpenAI',
  anthropic: 'Claude',
  google: 'Google',
  grok: 'Grok',
};

function providerGroupLabel(providers: TLiheProvider[]): string {
  return providers.map((provider) => providerLabels[provider]).join(' + ');
}

type DisconnectTarget = {
  provider?: TLiheProvider;
  label: string;
};

export default function LiheConnectionRow() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { showToast } = useToastContext();
  const status = useLiheConnectionStatusQuery();
  const disconnect = useDisconnectLiheConnectionMutation();
  const startAccountLink = useStartOpenIdLinkMutation();
  const [disconnectTarget, setDisconnectTarget] = useState<DisconnectTarget | null>(null);

  if (!status.data?.enabled) {
    return null;
  }

  const isConnected = status.data.connected;
  const requiresAccountLink = status.data.requiresAccountLink === true;
  const hasConnection = isConnected || status.data.needsReconnect;
  const connectedProviders = hasConnection ? status.data.providers : [];
  const providerSummary = hasConnection ? providerGroupLabel(status.data.providers) : '';
  const connect = () => {
    if (requiresAccountLink) {
      startAccountLink.mutate(
        { returnTo: '/connect/lihe' },
        {
          onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
          onError: () =>
            showToast({
              message: localize('com_ui_lihe_account_link_failed'),
              status: NotificationSeverity.ERROR,
            }),
        },
      );
      return;
    }
    navigate(`/connect/lihe${hasConnection ? '?reconnect=1' : ''}`);
  };
  const handleDisconnect = () => {
    if (!disconnectTarget) {
      return;
    }
    const payload = disconnectTarget.provider ? { provider: disconnectTarget.provider } : {};
    disconnect.mutate(payload, {
      onSuccess: () => {
        setDisconnectTarget(null);
        showToast({
          message: localize('com_ui_lihe_disconnect_success'),
          status: NotificationSeverity.SUCCESS,
        });
      },
      onError: () =>
        showToast({
          message: localize('com_ui_lihe_disconnect_failed'),
          status: NotificationSeverity.ERROR,
        }),
    });
  };

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center" aria-hidden="true">
          {isConnected ? (
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          ) : (
            <Link2 className="h-5 w-5 text-text-secondary" />
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate font-medium text-text-primary">
            {localize('com_ui_lihe_connection')}
          </div>
          <div className="truncate text-xs text-text-secondary">
            {isConnected
              ? [
                  status.data.accountLabel || localize('com_ui_lihe_status_connected'),
                  providerSummary,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : requiresAccountLink
                ? localize('com_ui_lihe_account_link_required')
                : status.data.needsReconnect
                  ? localize('com_ui_lihe_status_reconnect')
                  : localize('com_ui_lihe_status_disconnected')}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" onClick={connect} disabled={startAccountLink.isLoading}>
          {hasConnection ? (
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          ) : (
            <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {requiresAccountLink
            ? localize('com_ui_lihe_account_link')
            : hasConnection
              ? localize('com_ui_lihe_reconnect')
              : localize('com_ui_lihe_connect')}
        </Button>
        {hasConnection && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label={localize('com_ui_lihe_disconnect')}>
                  <Unplug className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-48">
                {connectedProviders.map((provider) => {
                  const label = providerLabels[provider];
                  return (
                    <DropdownMenuItem
                      key={provider}
                      onSelect={() => setDisconnectTarget({ provider, label })}
                    >
                      <Unplug className="mr-2 h-4 w-4" aria-hidden="true" />
                      {localize('com_ui_lihe_disconnect_provider', { 0: label })}
                    </DropdownMenuItem>
                  );
                })}
                {connectedProviders.length > 1 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() =>
                        setDisconnectTarget({
                          label: localize('com_ui_lihe_all_providers'),
                        })
                      }
                    >
                      <Unplug className="mr-2 h-4 w-4" aria-hidden="true" />
                      {localize('com_ui_lihe_disconnect_all')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialog
              open={disconnectTarget != null}
              onOpenChange={(open) => !open && setDisconnectTarget(null)}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {disconnectTarget
                      ? localize('com_ui_lihe_disconnect_provider_title', {
                          0: disconnectTarget.label,
                        })
                      : localize('com_ui_lihe_disconnect_title')}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {localize('com_ui_lihe_disconnect_description')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{localize('com_ui_cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDisconnect} disabled={disconnect.isLoading}>
                    {localize('com_ui_lihe_disconnect')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>
    </div>
  );
}
