import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => send<void>("POST", "/auth/logout"),
    onSuccess: () => client.clear(),
  });
}

export function homeFor(user: User): string {
  if (user.role === "seeker") return "/matches";
  return user.organization ? "/recruiter/jobs" : "/recruiter/setup";
}

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { data: user, isPending } = useCurrentUser();
  if (isPending) return <p className="p-8 text-sm text-slate-500">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />;
  return <>{children}</>;
}
