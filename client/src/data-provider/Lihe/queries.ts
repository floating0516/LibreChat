import { useQuery } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';
import type { QueryObserverResult } from '@tanstack/react-query';
import type { TLiheConnectionStatus } from 'librechat-data-provider';

export function useLiheConnectionStatusQuery(): QueryObserverResult<TLiheConnectionStatus> {
  return useQuery<TLiheConnectionStatus>(
    [QueryKeys.liheConnection],
    () => dataService.getLiheConnectionStatus(),
    {
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: 30_000,
    },
  );
}
