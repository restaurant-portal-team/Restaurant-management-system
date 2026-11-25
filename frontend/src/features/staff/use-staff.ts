import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api-client';
import { sessionQueryKey } from '../auth/use-auth';
import {
  activateStaff,
  createStaff,
  deactivateStaff,
  fetchStaff,
  regenerateSetupLink,
  type StaffInput,
  updateStaff,
} from './staff-api';

export const staffQueryKey = ['staff'] as const;

/**
 * A 401 means the session ended (expired, revoked or the account was deactivated). Re-checking /auth/me
 * lets the existing RequireAuth flow send the user to the sign-in page. A 403 means the role changed.
 */
function useSessionRecovery() {
  const queryClient = useQueryClient();
  return (error: unknown) => {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    }
  };
}

export function useStaffList() {
  const recover = useSessionRecovery();
  return useQuery({
    queryKey: staffQueryKey,
    queryFn: async ({ signal }) => {
      try {
        return await fetchStaff(signal);
      } catch (error: unknown) {
        recover(error);
        throw error;
      }
    },
    retry: false,
  });
}

function useStaffMutation<TVariables, TResult>(fn: (variables: TVariables) => Promise<TResult>) {
  const queryClient = useQueryClient();
  const recover = useSessionRecovery();
  return useMutation({
    mutationFn: fn,
    onError: recover,
    onSettled: () => queryClient.invalidateQueries({ queryKey: staffQueryKey }),
  });
}

export const useCreateStaff = () => useStaffMutation((input: StaffInput) => createStaff(input));
export const useUpdateStaff = () =>
  useStaffMutation(({ id, changes }: { id: string; changes: Partial<StaffInput> }) => updateStaff(id, changes));
export const useDeactivateStaff = () => useStaffMutation((id: string) => deactivateStaff(id));
export const useActivateStaff = () => useStaffMutation((id: string) => activateStaff(id));
export const useRegenerateSetupLink = () => useStaffMutation((id: string) => regenerateSetupLink(id));
