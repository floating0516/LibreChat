import { Button, Label, useToastContext } from '@librechat/client';
import { CheckCircle2, Link2, LoaderCircle } from 'lucide-react';
import { useStartOpenIdLinkMutation } from '~/data-provider';
import { NotificationSeverity } from '~/common';
import { useAuthContext, useLocalize } from '~/hooks';

export default function OpenIdAccountLink() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const { showToast } = useToastContext();
  const startLink = useStartOpenIdLinkMutation();
  const linked = user?.openidLinked === true;

  const beginLink = () => {
    startLink.mutate(
      { returnTo: '/connect/lihe-account?result=connected' },
      {
        onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
        onError: () =>
          showToast({
            message: localize('com_ui_lihe_account_link_failed'),
            status: NotificationSeverity.ERROR,
          }),
      },
    );
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <Label id="lihe-account-link-label">{localize('com_ui_lihe_account')}</Label>
      {linked ? (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          <span>{localize('com_ui_lihe_account_linked')}</span>
        </div>
      ) : (
        <Button
          variant="outline"
          onClick={beginLink}
          disabled={startLink.isLoading}
          aria-labelledby="lihe-account-link-label"
        >
          {startLink.isLoading ? (
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {localize('com_ui_lihe_account_link')}
        </Button>
      )}
    </div>
  );
}
