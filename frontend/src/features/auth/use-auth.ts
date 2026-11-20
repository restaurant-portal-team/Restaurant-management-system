import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchCurrentStaff, login, logout, type StaffProfile } from './auth-api';

export const sessionQueryKey = ['auth', 'me'] as const;

/**
 * Current session from the server (single source of truth). The role shown in the UI always comes
 * from /auth/me; route guards here are UX only — the API enforces every permission itself.
 */
export function useSession() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: ({ signal }) => fetchCurrentStaff(signal),
    staleTime: 60_000,
    retry: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => login(email, password),
    onSuccess: (user: StaffProfile) => {
      queryClient.setQueryData(sessionQueryKey, user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSettled: () => {
      // Drop every cached staff-only response, then mark the session as signed out.
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' });
      queryClient.setQueryData(sessionQueryKey, null);
    },
  });
}
