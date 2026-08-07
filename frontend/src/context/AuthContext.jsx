import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, setAccessToken, setSessionExpiredHandler } from "../api/client";

const AuthContext = createContext(null);

async function fetchFullProfile(base) {
  try {
    const me = await api.get("/colaboradores/me");
    return { ...base, ...me };
  } catch (_) {
    return base; // se falhar, segue só com o básico do login/refresh
  }
}

export function AuthProvider({ children }) {
  // user: { colaborador_id, nome, role, must_change_password, equipe, turno, escala_tipo, horario_inicio, horario_fim, email }
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(async () => {
    try { await api.post("/auth/logout"); } catch (_) { /* ignore */ }
    setAccessToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
    (async () => {
      try {
        const res = await fetch(`${api.API_URL}/auth/refresh`, { method: "POST", credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setAccessToken(data.access_token);
          const full = await fetchFullProfile(data);
          setUser(full);
        }
      } catch (_) { /* sem sessão anterior, tudo bem */ }
      setLoading(false);
    })();
  }, []);

  const login = async (email, password) => {
    const data = await api.post("/auth/login", { email, password });
    setAccessToken(data.access_token);
    const full = await fetchFullProfile(data);
    setUser(full);
    return full;
  };

  const reloadUser = useCallback(async () => {
    const me = await api.get("/colaboradores/me");
    setUser((prev) => ({ ...prev, ...me }));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, reloadUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
