"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { get, post, tokenStore } from "@/lib/api";
import { applyTheme } from "@/lib/theme";
import type { Organization, Session, User } from "@/lib/types";

type AuthState = {
  user: User | null;
  organization: Organization | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: { organizationSlug: string; name: string; email: string; password: string }) => Promise<void>;
  onboard: (input: { organizationName: string; name: string; email: string; password: string }) => Promise<Session>;
  logout: () => void;
  refresh: () => Promise<void>;
  setOrganization: (organization: Organization) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const adopt = useCallback((session: Session) => {
    tokenStore.set(session.token);
    setUser(session.user);
    setOrganization(session.organization);

    // Re-skin the entire app to the organization's brand. One call, because every
    // Tailwind colour reads a CSS variable (see globals.css / lib/theme.ts).
    applyTheme(session.organization.theme);
  }, []);

  /** Restore the session from the stored token on first load. */
  const refresh = useCallback(async () => {
    if (!tokenStore.get()) {
      setIsLoading(false);
      return;
    }

    try {
      const session = await get<Session>("/auth/me");
      setUser(session.user);
      setOrganization(session.organization);
      applyTheme(session.organization.theme);
    } catch {
      // The token is stale — api() has already cleared it.
      setUser(null);
      setOrganization(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      adopt(await post<Session>("/auth/login", { email, password }));
      router.push("/dashboard");
    },
    [adopt, router],
  );

  const signup = useCallback(
    async (input: { organizationSlug: string; name: string; email: string; password: string }) => {
      adopt(await post<Session>("/auth/signup", input));
      router.push("/dashboard");
    },
    [adopt, router],
  );

  const onboard = useCallback(
    async (input: { organizationName: string; name: string; email: string; password: string }) => {
      const session = await post<Session>("/auth/onboard", input);
      adopt(session);
      return session;
    },
    [adopt],
  );

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setOrganization(null);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider
      value={{
        user,
        organization,
        isLoading,
        login,
        signup,
        onboard,
        logout,
        refresh,
        setOrganization,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>.");
  return context;
}

/** Convenience for hiding actions a role cannot perform. */
export function useCan() {
  const { user } = useAuth();
  const role = user?.role;

  return {
    role,
    isAdmin: role === "admin",
    manageOrg: role === "admin",
    manageAssets: role === "admin" || role === "asset_manager",
    allocate: role === "admin" || role === "asset_manager",
    approveTransfer: role === "admin" || role === "asset_manager" || role === "department_head",
    moveMaintenance: role === "admin" || role === "asset_manager" || role === "department_head",
    closeAudit: role === "admin" || role === "asset_manager",
  };
}
