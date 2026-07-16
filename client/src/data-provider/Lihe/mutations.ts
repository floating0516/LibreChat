import { useMutation, useQueryClient } from '@tanstack/react-query';
import { dataService, MutationKeys, QueryKeys } from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import type {
  TLiheStartRequest,
  TLiheStartResponse,
  TLiheDisconnectResponse,
} from 'librechat-data-provider';

export function useStartLiheConnectionMutation(): UseMutationResult<
  TLiheStartResponse,
  Error,
  TLiheStartRequest
> {
  return useMutation([MutationKeys.liheStart], (payload: TLiheStartRequest) =>
    dataService.startLiheConnection(payload),
  );
}

export function useDisconnectLiheConnectionMutation(): UseMutationResult<
  TLiheDisconnectResponse,
  Error,
  void
> {
  const queryClient = useQueryClient();
  return useMutation([MutationKeys.liheDisconnect], () => dataService.disconnectLiheConnection(), {
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.liheConnection]);
      queryClient.invalidateQueries([QueryKeys.name]);
      queryClient.invalidateQueries([QueryKeys.models]);
      queryClient.invalidateQueries([QueryKeys.tokenConfig]);
    },
  });
}
