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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F4F5F7", fontFamily: "system-ui, sans-serif" }}>
      <form onSubmit={submit} style={{ background: "white", padding: 32, borderRadius: 14, border: "1px solid #E4E7EC", width: 340 }}>
        <h1 style={{ fontSize: 18, marginBottom: 4 }}>Escala CC</h1>
        <p style={{ fontSize: 12.5, color: "#6B7280", marginBottom: 20 }}>Entre com seu e-mail e senha</p>

        <label style={{ fontSize: 11.5, fontWeight: 600, color: "#6B7280" }}>E-mail</label>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          style={{ width: "100%", padding: 9, marginTop: 4, marginBottom: 12, border: "1px solid #E4E7EC", borderRadius: 8 }} />

        <label style={{ fontSize: 11.5, fontWeight: 600, color: "#6B7280" }}>Senha</label>
        <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", padding: 9, marginTop: 4, marginBottom: 16, border: "1px solid #E4E7EC", borderRadius: 8 }} />

        {erro && <div style={{ background: "#FBE2E5", color: "#A32E42", fontSize: 12.5, padding: 8, borderRadius: 8, marginBottom: 12 }}>{erro}</div>}

        <button type="submit" disabled={carregando}
          style={{ width: "100%", padding: 10, borderRadius: 8, border: "none", background: "#E8752E", color: "white", fontWeight: 600, cursor: "pointer" }}>
          {carregando ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
