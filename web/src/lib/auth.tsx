import { createContext, useContext, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type User } from "./api";

// Why the current session is blocked, if it is (expired / suspended / closing).
export type BlockedReason = "account_expired" | "account_suspended" | "account_closing" | null;

interface MeResult {
  user: User | null;
  blocked: BlockedReason;
}

interface AuthState {
  user: User | null;
  blocked: BlockedReason;
  loading: boolean;
  refresh: () => void;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthState>({ user: null, blocked: null, loading: true, refresh: () => {}, logout: async () => {} });

export function useAuth() {
  return useContext(AuthCtx);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<MeResult>({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return { user: (await api.get<{ user: User }>("/auth/me")).user, blocked: null };
      } catch (err) {
        if (err instanceof ApiError && (err.code === "account_expired" || err.code === "account_suspended" || err.code === "account_closing")) {
          return { user: null, blocked: err.code };
        }
        return { user: null, blocked: null };
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  const logout = async () => {
    await api.post("/auth/logout").catch(() => {});
    qc.setQueryData(["me"], { user: null, blocked: null } satisfies MeResult);
    qc.clear();
  };

  return (
    <AuthCtx.Provider value={{ user: data?.user ?? null, blocked: data?.blocked ?? null, loading: isLoading, refresh: () => qc.invalidateQueries({ queryKey: ["me"] }), logout }}>
      {children}
    </AuthCtx.Provider>
  );
}
