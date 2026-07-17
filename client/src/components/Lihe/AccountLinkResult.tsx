import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@librechat/client';
import { CheckCircle2, CircleAlert, Link2, LoaderCircle } from 'lucide-react';
import { QueryKeys } from 'librechat-data-provider';
import { useStartOpenIdLinkMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

export default function AccountLinkResult() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const startLink = useStartOpenIdLinkMutation();
  const connected = searchParams.get('result') === 'connected';

  useEffect(() => {
    if (!connected) {
      return;
    }
    queryClient.invalidateQueries([QueryKeys.user]);
    queryClient.invalidateQueries([QueryKeys.liheConnection]);
    const timeout = window.setTimeout(() => navigate('/c/new', { replace: true }), 1000);
    return () => window.clearTimeout(timeout);
  }, [connected, navigate, queryClient]);

  const retry = () => {
    startLink.mutate(
      { returnTo: '/connect/lihe-account?result=connected' },
      { onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl) },
    );
  };

  return (
    <main className="flex h-full min-h-[360px] w-full items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        {connected ? (
          <>
            <CheckCircle2 className="h-10 w-10 text-green-600" aria-hidden="true" />
            <h1 className="text-xl font-semibold text-text-primary">
              {localize('com_ui_lihe_account_linked')}
            </h1>
          </>
        ) : (
          <>
            <CircleAlert className="h-10 w-10 text-red-600" aria-hidden="true" />
            <h1 className="text-xl font-semibold text-text-primary">
              {localize('com_ui_lihe_account_link_failed')}
            </h1>
            <div className="flex w-full justify-center gap-3">
              <Button variant="outline" onClick={() => navigate('/c/new', { replace: true })}>
                {localize('com_ui_cancel')}
              </Button>
              <Button onClick={retry} disabled={startLink.isLoading}>
                {startLink.isLoading ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                {localize('com_ui_retry')}
              </Button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
