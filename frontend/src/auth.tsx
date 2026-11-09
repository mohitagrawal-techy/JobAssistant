import { useMutation, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";

import { api, ApiError, send } from "./api/client";
import type { Role, User } from "./api/types";

export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<User>("/auth/me");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: () => send<void>("POST", "/auth/logout"),
    // A full load drops all cached user data. queryClient.clear() would leave mounted components,
    // like the nav bar, showing the old user because it doesn't notify them.
    onSuccess: () => window.location.assign("/"),
  });
}

export function homeFor(user: User): string {
  if (user.role === "seeker") return "/matches";
  return user.organization ? "/recruiter/jobs" : "/recruiter/setup";
}

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { data: user, isPending } = useCurrentUser();
  if (isPending) return <p className="p-8 text-sm text-ink-muted">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}
