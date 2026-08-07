import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, setAccessToken, setSessionExpiredHandler } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // { colaborador_id, nome, role, must_change_password }
  const [loading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    try { await api.post("/auth/logout"); } catch (_) { /* ignore */ }
    setAccessToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
    // Tenta restaurar a sessão via refresh cookie (ex: depois de um F5).
    (async () => {
      try {
        const res = await fetch(`${api.API_URL}/auth/refresh`, { method: "POST", credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setAccessToken(data.access_token);
          setUser(data);
        }
      } catch (_) { /* sem sessão anterior, tudo bem */ }
      setLoading(false);
    })();
  }, []);

  const login = async (email, password) => {
    const data = await api.post("/auth/login", { email, password });
    setAccessToken(data.access_token);
    setUser(data);
    return data;
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
