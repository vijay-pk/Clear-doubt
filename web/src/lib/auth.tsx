import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type User } from "./api";

interface AuthState {
  user: User | null;
  loading: boolean;
  refresh: () => void;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthState>({ user: null, loading: true, refresh: () => {}, logout: async () => {} });

export function useAuth() {
  return useContext(AuthCtx);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await api.get<{ user: User }>("/auth/me")).user;
      } catch {
        return null;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  const logout = async () => {
    await api.post("/auth/logout").catch(() => {});
    qc.setQueryData(["me"], null);
    qc.clear();
  };

  return (
    <AuthCtx.Provider value={{ user: data ?? null, loading: isLoading, refresh: () => qc.invalidateQueries({ queryKey: ["me"] }), logout }}>
      {children}
    </AuthCtx.Provider>
  );
}
