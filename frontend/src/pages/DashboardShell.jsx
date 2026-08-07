import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";

export default function DashboardShell() {
  const { user, logout } = useAuth();
  const [colaboradores, setColaboradores] = useState([]);
  const [erro, setErro] = useState("");

  useEffect(() => {
    api.get("/colaboradores").then(setColaboradores).catch((e) => setErro(e.message));
  }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 28, maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 18, margin: 0 }}>Olá, {user.nome}</h1>
          <p style={{ fontSize: 12.5, color: "#6B7280", margin: "2px 0 0" }}>Perfil: {user.role}</p>
        </div>
        <button onClick={logout} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #E4E7EC", background: "white", cursor: "pointer" }}>Sair</button>
      </div>

      {user.must_change_password && (
        <div style={{ background: "#FFF6E8", border: "1px solid #F2D8A0", color: "#8A5E10", padding: 12, borderRadius: 10, marginBottom: 16, fontSize: 13 }}>
          Você está usando uma senha provisória. Troque-a em <code>/auth/change-password</code> assim que possível
          (essa tela ainda precisa ser portada do protótipo — veja o README).
        </div>
      )}

      <div style={{ background: "white", border: "1px solid #E4E7EC", borderRadius: 12, padding: 18 }}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Colaboradores ativos</h2>
        {erro && <div style={{ color: "#A32E42", fontSize: 12.5 }}>{erro}</div>}
        {!erro && colaboradores.length === 0 && <div style={{ fontSize: 12.5, color: "#6B7280" }}>Nenhum colaborador cadastrado ainda.</div>}
        <ul style={{ fontSize: 13, paddingLeft: 18 }}>
          {colaboradores.map((c) => (
            <li key={c.id}>{c.nome} — {c.equipe} · {c.turno}</li>
          ))}
        </ul>
      </div>

      <p style={{ fontSize: 12, color: "#6B7280", marginTop: 20 }}>
        Esta é uma tela de exemplo já conectada à API real (login, sessão e dados vêm do backend).
        As demais telas do protótipo (Plantões, Cronograma, Aprovações, Férias, Feriados, Avisos)
        seguem o mesmo padrão — veja o README para o passo a passo de portá-las.
      </p>
    </div>
  );
}
