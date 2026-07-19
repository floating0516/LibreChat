import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@librechat/client';
import { CheckCircle2, CircleAlert, Link2, LoaderCircle } from 'lucide-react';
import { parseLiheApiKeyId, QueryKeys } from 'librechat-data-provider';
import {
  useLiheConnectionStatusQuery,
  useStartLiheConnectionMutation,
  useStartOpenIdLinkMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

type ConnectPhase = 'loading' | 'confirm' | 'success' | 'error' | 'unavailable';

export default function LiheConnect() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const status = useLiheConnectionStatusQuery();
  const startConnection = useStartLiheConnectionMutation();
  const startAccountLink = useStartOpenIdLinkMutation();
  const started = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const [attemptFailed, setAttemptFailed] = useState(false);
  const [phase, setPhase] = useState<ConnectPhase>('loading');

  const result = searchParams.get('result');
  const reconnect = searchParams.get('reconnect') === '1';
  const apiKeyIdValues = searchParams.getAll('api_key_id');
  const apiKeyId = parseLiheApiKeyId(apiKeyIdValues);
  const apiKeyIdMissing = apiKeyIdValues.length === 0;
  const apiKeyIdInvalid = !apiKeyIdMissing && apiKeyId == null;

  const begin = useCallback(
    (replaceExisting: boolean) => {
      if (started.current) {
        return;
      }
      if (!apiKeyId) {
        setAttemptFailed(true);
        setPhase('error');
        return;
      }
      started.current = true;
      setPhase('loading');
      startConnection.mutate(
        { apiKeyId, replaceExisting },
        {
          onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
          onError: () => {
            setAttemptFailed(true);
            setPhase('error');
          },
        },
      );
    },
    [apiKeyId, startConnection],
  );

  const beginAccountLink = useCallback(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    setPhase('loading');
    startAccountLink.mutate(
      { returnTo: `${window.location.pathname}${window.location.search}` },
      {
        onSuccess: ({ authorizationUrl }) => window.location.assign(authorizationUrl),
        onError: () => {
          setAttemptFailed(true);
          setPhase('error');
        },
      },
    );
  }, [startAccountLink]);

  useEffect(() => {
    if (result === 'connected') {
      setPhase('success');
      queryClient.invalidateQueries([QueryKeys.liheConnection]);
      queryClient.invalidateQueries([QueryKeys.name]);
      queryClient.invalidateQueries([QueryKeys.models]);
      queryClient.invalidateQueries([QueryKeys.tokenConfig]);
      const timeout = window.setTimeout(() => navigate('/c/new', { replace: true }), 800);
      return () => window.clearTimeout(timeout);
    }
    if (result === 'error') {
      setPhase('error');
      return;
    }
    if (attemptFailed) {
      setPhase('error');
      return;
    }
    if (status.isLoading) {
      setPhase('loading');
      return;
    }
    if (!status.data?.enabled) {
      setPhase('unavailable');
      return;
    }
    if (apiKeyIdInvalid) {
      setPhase('error');
      return;
    }
    if (status.data.requiresAccountLink) {
      beginAccountLink();
      return;
    }
    // The API selection round trip drops reconnect=1; a returned api_key_id is explicit intent.
    if (status.data.connected && !reconnect && apiKeyIdMissing) {
      navigate('/c/new', { replace: true });
      return;
    }
    if (apiKeyIdMissing) {
      if (status.data.selectionUrl) {
        window.location.assign(status.data.selectionUrl);
      } else {
        setPhase('error');
      }
      return;
    }
    if (status.data.hasExistingKeys && !reconnect && !confirmed) {
      setPhase('confirm');
      return;
    }
    begin(reconnect || confirmed || status.data.needsReconnect || status.data.connected);
  }, [
    attemptFailed,
    apiKeyIdInvalid,
    apiKeyIdMissing,
    begin,
    beginAccountLink,
    confirmed,
    navigate,
    queryClient,
    reconnect,
    result,
    status.data,
    status.isLoading,
  ]);

  const retry = () => {
    started.current = false;
    setAttemptFailed(false);
    if (status.data?.requiresAccountLink) {
      beginAccountLink();
      return;
    }
    navigate('/connect/lihe?reconnect=1', { replace: true });
  };

  return (
    <main className="flex h-full min-h-[360px] w-full items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-5 text-center">
        {phase === 'loading' && (
          <>
            <LoaderCircle className="h-9 w-9 animate-spin text-text-secondary" aria-hidden="true" />
            <h1 className="text-xl font-semibold text-text-primary">
              {status.data?.requiresAccountLink
                ? localize('com_ui_lihe_account_linking')
                : localize('com_ui_lihe_connecting')}
            </h1>
          </>
        )}
        {phase === 'success' && (
          <>
            <CheckCircle2 className="h-10 w-10 text-green-600" aria-hidden="true" />
            <h1 className="text-xl font-semibold text-text-primary">
              {localize('com_ui_lihe_connected')}
            </h1>
          </>
        )}
        {phase === 'confirm' && (
          <>
            <Link2 className="h-10 w-10 text-text-secondary" aria-hidden="true" />
            <h1 className="text-xl font-semibold text-text-primary">
              {localize('com_ui_lihe_replace_title')}
            </h1>
            <p className="text-sm leading-6 text-text-secondary">
              {localize('com_ui_lihe_replace_description')}
            </p>
            <div className="flex w-full justify-center gap-3">
              <Button variant="outline" onClick={() => navigate('/c/new', { replace: true })}>
                {localize('com_ui_cancel')}
              </Button>
              <Button onClick={() => setConfirmed(true)}>
                <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
                {localize('com_ui_continue')}
              </Button>
            </div>
          </>
        )}
        {(phase === 'error' || phase === 'unavailable') && (
          <>
            <CircleAlert className="h-10 w-10 text-red-600" aria-hidden="true" />
            <h1 className="text-xl font-semibold text-text-primary">
              {phase === 'unavailable'
                ? localize('com_ui_lihe_unavailable')
                : localize('com_ui_lihe_failed')}
            </h1>
            <div className="flex w-full justify-center gap-3">
              <Button variant="outline" onClick={() => navigate('/c/new', { replace: true })}>
                {localize('com_ui_cancel')}
              </Button>
              {phase === 'error' && <Button onClick={retry}>{localize('com_ui_retry')}</Button>}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
