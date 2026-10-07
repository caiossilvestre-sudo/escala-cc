import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { TopBar, Pill, Spinner, ErrorBox, Toast, ConfirmModal } from "../components/UI";
import { useToast, useConfirm } from "../lib/hooks";
import { TIPO_INFO, STATUS_INFO, tipoDe, origemTexto } from "./util";
import CameraFicha from "./CameraFicha";
import CameraForm from "./CameraForm";
import Permissoes from "./Permissoes";
import "./ferramentas.css";

const TIPOS = [["", "Todas"], ["nvr_life", "NVR Life"], ["nvr_cliente", "NVR externo"], ["lifeguard", "LifeGuard"]];
const STATUS = [["", "Todos"], ["online", "Online"], ["offline", "Offline"], ["desconhecido", "Sem diagnóstico"]];
const POR_PAGINA = 50;

function Stat({ valor, label, cor }) {
  return (
    <div className="card stat" style={{ padding: "14px 16px" }}>
      <div className="num">{valor ?? "—"}</div>
      <div className="label"><span className="dot" style={{ background: cor }} />{label}</div>
    </div>
  );
}

/** LifeGuard · Documentação — página principal do módulo Ferramentas. */
export default function Documentacao({ acesso }) {
  const { toast, showToast } = useToast();
  const { confirm, confirmState, resolveConfirm } = useConfirm();
  const [modo, setModo] = useState({ tela: "lista" }); // lista | nova | editar | permissoes
  const [filtros, setFiltros] = useState({ q: "", tipo: "", status: "", cidade: "", sem_foto: false });
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [lista, setLista] = useState({ itens: [], total: 0, paginas: 1 });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [sel, setSel] = useState(null);
  const [resumo, setResumo] = useState(null);
  const [cidades, setCidades] = useState([]);

  // espera a pessoa parar de digitar antes de buscar
  useEffect(() => {
    const t = setTimeout(() => { setFiltros((f) => ({ ...f, q: busca })); setPagina(1); }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  const carregar = useCallback(() => {
    setCarregando(true);
    setErro("");
    const p = new URLSearchParams({ pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    Object.entries(filtros).forEach(([k, v]) => { if (v) p.set(k, String(v)); });
    return api.get(`/ferramentas/cameras?${p}`)
      .then((r) => { setLista(r); if (!sel && r.itens[0]) setSel(r.itens[0].id); })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, [filtros, pagina]); // eslint-disable-line react-hooks/exhaustive-deps

  const carregarResumo = () => api.get("/ferramentas/resumo").then(setResumo).catch(() => {});

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { carregarResumo(); api.get("/ferramentas/cidades").then(setCidades).catch(() => {}); }, []);

  const filtro = (k, v) => { setFiltros((f) => ({ ...f, [k]: v })); setPagina(1); };

  const voltarDoForm = (id) => {
    setModo({ tela: "lista" });
    if (id) setSel(id);
    carregar();
    carregarResumo();
  };

  if (modo.tela === "nova" || modo.tela === "editar") {
    return (<><CameraForm cameraId={modo.id} onVoltar={voltarDoForm} showToast={showToast} /><Toast toast={toast} /></>);
  }
  if (modo.tela === "permissoes") {
    return (<><Permissoes onVoltar={() => setModo({ tela: "lista" })} showToast={showToast} /><Toast toast={toast} /></>);
  }

  return (
    <>
      <TopBar
        title="LifeGuard · Documentação"
        subtitle="Câmeras de NVR Life, NVR externo e LifeGuard, com a foto registrada no cadastro"
        right={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {acesso.tem("ft.admin") && <button className="btn btn-ghost" onClick={() => setModo({ tela: "permissoes" })}>Permissões</button>}
            {acesso.tem("doc.editar") && <button className="btn btn-primary" onClick={() => setModo({ tela: "nova" })}>+ Nova câmera</button>}
          </div>
        }
      />
      <div className="content">
        <ErrorBox error={erro} />

        <div className="ft-stats">
          <Stat valor={resumo?.cameras_nvr_life} label="Câmeras em NVR Life" cor="#2F6FE8" />
          <Stat valor={resumo?.cameras_nvr_cliente} label="Câmeras em NVR externo" cor="#6A55C2" />
          <Stat valor={resumo?.cameras_lifeguard} label="Câmeras LifeGuard" cor="var(--primary)" />
          <Stat valor={resumo?.gravadores} label="Gravadores" cor="var(--ink)" />
          <Stat valor={resumo?.sem_foto} label="Sem foto de documentação" cor="var(--pendente)" />
        </div>

        <div className="card ft-filtros" style={{ padding: 12 }}>
          <input type="search" aria-label="Buscar" placeholder="Buscar por nome, contrato, cliente, IP, MAC, PPPoE, NVR ou ID LifeGuard" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div className="ft-seg" role="group" aria-label="Tipo">
            {TIPOS.map(([v, l]) => <button key={v} type="button" className={filtros.tipo === v ? "on" : ""} onClick={() => filtro("tipo", v)}>{l}</button>)}
          </div>
          <select aria-label="Situação" value={filtros.status} onChange={(e) => filtro("status", e.target.value)}>
            {STATUS.map(([v, l]) => <option key={v} value={v}>{v ? l : "Situação: todas"}</option>)}
          </select>
          <select aria-label="Cidade" value={filtros.cidade} onChange={(e) => filtro("cidade", e.target.value)}>
            <option value="">Cidade: todas</option>
            {cidades.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <label className="chk"><input type="checkbox" checked={filtros.sem_foto} onChange={(e) => filtro("sem_foto", e.target.checked)} /> Só sem foto</label>
        </div>

        <div className="ft-layout">
          <div className="card ft-lista">
            <div className="ft-tabela-wrap">
              {carregando && lista.itens.length === 0 ? <Spinner /> : lista.itens.length === 0 ? <div className="empty">Nenhuma câmera encontrada com esses filtros.</div> : (
                <table className="tbl ft-tbl">
                  <thead><tr><th style={{ width: 34 }}>Foto</th><th>Câmera / local</th><th>Origem</th><th>Cliente / contrato</th><th>IP / MAC</th></tr></thead>
                  <tbody>{lista.itens.map((c) => {
                    const t = TIPO_INFO[tipoDe(c)];
                    const st = STATUS_INFO[c.status] || STATUS_INFO.desconhecido;
                    return (
                      <tr key={c.id} className={c.id === sel ? "sel" : ""} onClick={() => setSel(c.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(c.id); } }} aria-selected={c.id === sel}>
                        <td><span className={`ft-thumb ${c.tem_foto ? "tem" : "nao"}`} title={c.tem_foto ? "Tem foto de documentação" : "Sem foto"} /></td>
                        <td><div className="ft-ellipsis" style={{ fontWeight: 600 }}><span className={`ft-dot ${c.status}`} title={st.label} />{c.nome}</div><div className="sub ft-ellipsis">{c.descricao_local || "—"}</div></td>
                        <td><Pill status={t.pill}>{t.label}</Pill><div className="sub ft-ellipsis">{origemTexto(c)}</div></td>
                        <td><div className="ft-ellipsis">{c.nome_cliente || "—"}</div><div className="sub">{c.contrato_ixc ? <span className="mono">{c.contrato_ixc}</span> : "—"}{c.cidade ? ` · ${c.cidade}` : ""}</div></td>
                        <td className="mono" style={{ fontSize: 11.5 }}><div>{c.ip || "—"}</div><div className="sub">{c.mac || ""}</div></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              )}
            </div>
            <div className="ft-paginacao">
              <span>{lista.total} câmera{lista.total === 1 ? "" : "s"}{carregando ? " · atualizando…" : ""}</span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button className="btn btn-ghost btn-sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
                Página {lista.pagina || pagina} de {lista.paginas}
                <button className="btn btn-ghost btn-sm" disabled={pagina >= lista.paginas} onClick={() => setPagina((p) => p + 1)}>Próxima</button>
              </span>
            </div>
          </div>

          <aside className="card ft-lado" aria-label="Ficha da câmera">
            {sel ? (
              <CameraFicha
                key={sel}
                cameraId={sel}
                onEditar={(id) => setModo({ tela: "editar", id })}
                onMudou={(excluida) => { if (excluida) setSel(null); carregar(); carregarResumo(); }}
                showToast={showToast}
                confirm={confirm}
              />
            ) : <div className="empty">Escolha uma câmera na lista.</div>}
          </aside>
        </div>
      </div>
      <Toast toast={toast} />
      <ConfirmModal state={confirmState} onResolve={resolveConfirm} />
    </>
  );
}
