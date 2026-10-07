import { useEffect, useState } from "react";
import { api } from "../api/client";
import { TopBar, Spinner, ErrorBox } from "../components/UI";

// Cabeçalho curto de cada coluna (o texto completo vem do backend, no title)
const CURTO = {
  "doc.ver": "Consultar", "doc.editar": "Cadastrar / foto", "doc.senhas": "Senhas", "doc.excluir": "Excluir",
  referencia: "Referência", provisionamento: "Provisionamento", diagnostico: "Diagnosticar", aovivo: "Ao vivo", "ft.admin": "Permissões",
};
const IMPLICA = { "doc.editar": "doc.ver", "doc.senhas": "doc.ver", "doc.excluir": "doc.ver" };

/** Permissões de Ferramentas por página/tópico, por colaborador. */
export default function Permissoes({ onVoltar, showToast }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState("");
  const [salvando, setSalvando] = useState(null);

  const carregar = () => api.get("/ferramentas/permissoes").then(setDados).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, []);

  const salvar = async (pessoa, lista) => {
    setSalvando(pessoa.colaborador_id);
    try {
      const r = await api.post("/ferramentas/permissoes", { colaborador_id: pessoa.colaborador_id, permissoes: lista });
      setDados((d) => ({ ...d, pessoas: d.pessoas.map((p) => (p.colaborador_id === pessoa.colaborador_id ? { ...p, permissoes: r.permissoes } : p)) }));
    } catch (e) { showToast(e.message); } finally { setSalvando(null); }
  };

  const alternar = (pessoa, codigo) => {
    const atual = new Set(pessoa.permissoes);
    if (atual.has(codigo)) {
      atual.delete(codigo);
      // tirar "consultar" tira junto o que depende dele
      if (codigo === "doc.ver") Object.keys(IMPLICA).forEach((k) => atual.delete(k));
    } else {
      atual.add(codigo);
    }
    salvar(pessoa, [...atual]);
  };

  if (!dados) return (<><TopBar title="Ferramentas · Permissões" /><div className="content"><ErrorBox error={erro} />{!erro && <Spinner />}</div></>);

  const cat = dados.catalogo;
  const docCols = cat.filter((c) => c.codigo.startsWith("doc."));
  const outras = cat.filter((c) => !c.codigo.startsWith("doc."));
  const lista = dados.pessoas.filter((p) => !filtro || `${p.nome} ${p.equipe}`.toLowerCase().includes(filtro.toLowerCase()));

  const celula = (p, c) => (
    <td key={c.codigo} style={{ textAlign: "center" }}>
      <input
        type="checkbox"
        aria-label={`${c.label} — ${p.nome}`}
        title={c.label}
        checked={p.permissoes.includes(c.codigo)}
        disabled={p.fixo || salvando === p.colaborador_id}
        onChange={() => alternar(p, c.codigo)}
        style={{ width: 16, height: 16, cursor: p.fixo ? "default" : "pointer", accentColor: "var(--primary)" }}
      />
    </td>
  );

  return (
    <>
      <TopBar title="Ferramentas · Permissões" subtitle="Acesso por página/tópico do LifeGuard — independe do perfil na escala" right={<button className="btn btn-ghost" onClick={onVoltar}>← Voltar</button>} />
      <div className="content">
        <ErrorBox error={erro} />
        <div className="info-box">Cada caixinha salva na hora. Administradores do Escala têm tudo automaticamente. Os atalhos N1 e N2 só preenchem as caixinhas — depois dá para ajustar uma a uma. Toda alteração fica no log de auditoria.</div>
        <div className="card">
          <div className="ft-filtros" style={{ marginBottom: 12 }}>
            <input type="search" placeholder="Filtrar por nome ou setor" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          </div>
          <div className="ft-tabela-wrap">
            <table className="tbl" style={{ minWidth: 980 }}>
              <thead>
                <tr>
                  <th rowSpan={2}>Colaborador</th>
                  <th colSpan={docCols.length} style={{ textAlign: "center", borderBottom: "1px solid var(--border)" }}>Documentação</th>
                  {outras.map((c) => <th key={c.codigo} rowSpan={2} style={{ textAlign: "center" }} title={c.label}>{CURTO[c.codigo] || c.label}</th>)}
                  <th rowSpan={2}>Atalhos</th>
                </tr>
                <tr>{docCols.map((c) => <th key={c.codigo} style={{ textAlign: "center" }} title={c.label}>{CURTO[c.codigo] || c.label}</th>)}</tr>
              </thead>
              <tbody>
                {lista.map((p) => (
                  <tr key={p.colaborador_id}>
                    <td><div style={{ fontWeight: 600 }}>{p.nome}</div><div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{p.fixo ? "Admin do Escala" : p.equipe}</div></td>
                    {docCols.map((c) => celula(p, c))}
                    {outras.map((c) => celula(p, c))}
                    <td>
                      {!p.fixo && (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button className="btn btn-ghost btn-sm" disabled={salvando === p.colaborador_id} onClick={() => salvar(p, dados.presets.n1)}>N1</button>
                          <button className="btn btn-ghost btn-sm" disabled={salvando === p.colaborador_id} onClick={() => salvar(p, dados.presets.n2)}>N2</button>
                          <button className="btn btn-ghost btn-sm" disabled={salvando === p.colaborador_id} onClick={() => salvar(p, [])} title="Remover todo o acesso">Nenhum</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
