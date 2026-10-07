import { useState } from "react";
import { api } from "../api/client";
import { TopBar, Spinner, ErrorBox, Pill } from "../components/UI";
import { useApiList } from "../lib/hooks";

const NIVEIS = [
  { v: "", label: "Sem acesso" },
  { v: "n1", label: "N1 — consulta, cadastra e tira foto" },
  { v: "n2", label: "N2 — + vê senhas e edita gravadores" },
  { v: "admin", label: "Admin — + exclui e define permissões" },
];

/** Quem acessa o módulo Ferramentas e com qual nível (só admin). */
export default function Permissoes({ onVoltar, showToast }) {
  const { data, loading, error, reload } = useApiList("/ferramentas/permissoes");
  const [filtro, setFiltro] = useState("");

  const definir = async (colaborador_id, nivel) => {
    try {
      await api.post("/ferramentas/permissoes", { colaborador_id, nivel: nivel || null });
      showToast("Permissão atualizada.");
      reload();
    } catch (e) { showToast(e.message); }
  };

  const lista = data.filter((p) => !filtro || `${p.nome} ${p.equipe}`.toLowerCase().includes(filtro.toLowerCase()));

  return (
    <>
      <TopBar title="Ferramentas · Permissões" subtitle="Acesso ao LifeGuard independe do perfil na escala" right={<button className="btn btn-ghost" onClick={onVoltar}>← Voltar</button>} />
      <div className="content">
        <ErrorBox error={error} />
        <div className="info-box">Administradores do Escala têm acesso total automaticamente. Para os demais, escolha o nível abaixo — quem fica "Sem acesso" não vê o módulo.</div>
        <div className="card">
          <div className="ft-filtros" style={{ marginBottom: 12 }}>
            <input type="search" placeholder="Filtrar por nome ou setor" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          </div>
          {loading ? <Spinner /> : (
            <div className="ft-tabela-wrap">
              <table className="tbl">
                <thead><tr><th>Colaborador</th><th>Setor</th><th>Nível em Ferramentas</th></tr></thead>
                <tbody>{lista.map((p) => (
                  <tr key={p.colaborador_id}>
                    <td style={{ fontWeight: 600 }}>{p.nome}</td>
                    <td>{p.equipe}</td>
                    <td>
                      {p.fixo ? <Pill status="aprovada">Admin (administrador do Escala)</Pill> : (
                        <select value={p.nivel || ""} onChange={(e) => definir(p.colaborador_id, e.target.value)} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "6px 8px", font: "inherit", fontSize: 12.5 }}>
                          {NIVEIS.map((n) => <option key={n.v} value={n.v}>{n.label}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
