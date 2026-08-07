import { useState } from "react";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErro("");
    setCarregando(true);
    try {
      await login(email, password);
    } catch (err) {
      setErro(err.message || "Não foi possível entrar.");
    } finally {
      setCarregando(false);
    }
  };

  return (
    <div className="login-wrap">
      <form onSubmit={submit} className="login-card">
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 20 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg, var(--primary), #F0A268)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13, color: "white" }}>EC</div>
          <div>
            <div className="display" style={{ fontWeight: 600, fontSize: 15 }}>Escala Suporte Técnico</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Sistema de escalas</div>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label>E-mail</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 16 }}>
          <label>Senha</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        {erro && <div className="warn-box" style={{ background: "#FBE2E5", borderColor: "#F3C3CB", color: "#A32E42" }}>{erro}</div>}

        <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center", padding: 10 }} type="submit" disabled={carregando}>
          {carregando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
