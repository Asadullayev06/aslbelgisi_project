import { createContext, useContext } from "react";

export interface User { id: number; username: string; role: "admin" | "operator" | string; }

export interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const v = useContext(AuthContext);
  if (!v) throw new Error("AuthProvider missing");
  return v;
}

export function isAdmin(u: User | null): boolean {
  return !!u && u.role === "admin";
}
