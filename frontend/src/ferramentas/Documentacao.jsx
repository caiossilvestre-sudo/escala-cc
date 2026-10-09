import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { Pill, Spinner, ErrorBox, Toast, ConfirmModal } from "../components/UI";
import { useToast, useConfirm } from "../lib/hooks";
import { TIPO_INFO, STATUS_INFO, tipoDe, origemTexto, useAlturaRestante, num } from "./util";
import CameraFicha from "./CameraFicha";
import CameraForm from "./CameraForm";
import Permissoes from "./Permissoes";
import ImportarFotos from "./ImportarFotos";
import "./ferramentas.css";

const STATUS = [["", "Situação: todas"], ["online", "Online"], ["offline", "Offline"], ["desconhecido", "Sem diagnóstico"]];
const POR_PAGINA = 50;
/** LifeGuard · Documentação — página principal do módulo Ferramentas. */
export default function Documentacao({ acesso }) {
  const { toast, showToast } = useToast();
  const { confirm, confirmState, resolveConfirm } = useConfirm();
  const [modo, setModo] = useState({ tela: "lista" }); // lista | nova | editar | permissoes | importar
  const [exportando, setExportando] = useState(false);
  const [filtros, setFiltros] = useState({ q: "", tipo: "", status: "", cidade: "", gravador_id: "", sem_foto: false });
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [lista, setLista] = useState({ itens: [], total: 0, paginas: 1 });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [sel, setSel] = useState(null);
  const [resumo, setResumo] = useState(null);
  const [cidades, setCidades] = useState([]);
  const [gravadores, setGravadores] = useState([]);
  const manterSel = useRef(false);
  const [refTela, altura] = useAlturaRestante();

  // espera a pessoa parar de digitar antes de buscar
  useEffect(() => {
    const t = setTimeout(() => { setFiltros((f) => (f.q === busca ? f : { ...f, q: busca })); setPagina(1); }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  const carregar = useCallback(() => {
    setCarregando(true);
    setErro("");
    const p = new URLSearchParams({ pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    Object.entries(filtros).forEach(([k, v]) => { if (v) p.set(k, String(v)); });
    return api.get(`/ferramentas/cameras?${p}`)
      .then((r) => {
        setLista(r);
        // a ficha acompanha a lista: se a câmera aberta saiu da busca, abre a primeira
        if (manterSel.current) { manterSel.current = false; return; }
        setSel((atual) => (r.itens.some((c) => c.id === atual) ? atual : (r.itens[0]?.id ?? null)));
      })
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, [filtros, pagina]);

  const carregarResumo = () => api.get("/ferramentas/resumo").then(setResumo).catch(() => {});

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    carregarResumo();
    api.get("/ferramentas/cidades").then(setCidades).catch(() => {});
    api.get("/ferramentas/gravadores").then(setGravadores).catch(() => {});
  }, []);

  const filtro = (k, v) => { setFiltros((f) => ({ ...f, [k]: v })); setPagina(1); };

  const voltarDoForm = (id) => {
    setModo({ tela: "lista" });
    if (id) { setSel(id); manterSel.current = true; }
    carregar();
    carregarResumo();
  };

  // ↑ ↓ andam pela lista
  const teclaLista = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const itens = lista.itens;
    if (!itens.length) return;
    e.preventDefault();
    const i = itens.findIndex((c) => c.id === sel);
    const prox = e.key === "ArrowDown" ? Math.min(itens.length - 1, i + 1) : Math.max(0, i - 1);
    const id = itens[prox].id;
    setSel(id);
    const linha = document.getElementById(`ft-linha-${id}`);
    linha?.focus({ preventScroll: true });
    linha?.scrollIntoView({ block: "nearest" });
  };

  if (modo.tela === "nova" || modo.tela === "editar") {
    return (<><CameraForm cameraId={modo.id} substituir={!!modo.substituir} onVoltar={voltarDoForm} showToast={showToast} confirm={confirm} /><Toast toast={toast} /><ConfirmModal state={confirmState} onResolve={resolveConfirm} /></>);
  }
  if (modo.tela === "permissoes") {
    return (<><Permissoes onVoltar={() => setModo({ tela: "lista" })} showToast={showToast} /><Toast toast={toast} /></>);
  }
  if (modo.tela === "importar") {
    return (<><ImportarFotos onVoltar={() => voltarDoForm(null)} showToast={showToast} /><Toast toast={toast} /></>);
  }

  // CSV com os filtros atuais de tipo/cidade (sem senhas) — base para o script externo
  const exportarCsv = async () => {
    setExportando(true);
    try {
      const p = new URLSearchParams();
      if (filtros.tipo) p.set("tipo", filtros.tipo);
      if (filtros.cidade) p.set("cidade", filtros.cidade);
      if (filtros.gravador_id) p.set("gravador_id", filtros.gravador_id);
      const linhas = await api.get(`/ferramentas/cameras-exportar?${p}`);
      if (!linhas.length) { showToast("Nada para exportar com esses filtros."); return; }
      const cols = Object.keys(linhas[0]);
      const cel = (v) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = "﻿" + [cols.join(";"), ...linhas.map((l) => cols.map((c) => cel(l[c])).join(";"))].join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `cameras_documentacao_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      showToast(`${linhas.length} câmeras exportadas.`);
    } catch (e) { showToast(e.message); } finally { setExportando(false); }
  };

  const tipos = [
    ["", "Todas", resumo?.total],
    ["nvr_life", "NVR Life", resumo?.cameras_nvr_life],
    ["nvr_cliente", "NVR externo", resumo?.cameras_nvr_cliente],
    ["lifeguard", "LifeGuard", resumo?.cameras_lifeguard],
  ];

  return (
    <>
      <div className="ft-doc" ref={refTela} style={altura ? { height: altura } : undefined}>
        <header className="ft-doc-topo">
          <div className="ft-doc-titulo">
            <h1>LifeGuard · Documentação</h1>
            <span>{num(resumo?.gravadores)} gravadores · {num(resumo?.total)} câmeras</span>
          </div>
          <div className="ft-doc-acoes">
            {acesso.tem("ft.admin") && <button className="btn btn-ghost" onClick={() => setModo({ tela: "permissoes" })}>Permissões</button>}
            <button className="btn btn-ghost" disabled={exportando} onClick={exportarCsv}>{exportando ? "Exportando…" : "Exportar lista (CSV)"}</button>
            {acesso.tem("doc.editar") && <button className="btn btn-ghost" onClick={() => setModo({ tela: "importar" })}>Importar fotos</button>}
            {acesso.tem("doc.editar") && <button className="btn btn-primary" onClick={() => setModo({ tela: "nova" })}>+ Nova câmera</button>}
          </div>
        </header>

        <div className="ft-doc-filtros">
          <input type="search" aria-label="Buscar" placeholder="Buscar por nome, contrato, cliente, IP, MAC, PPPoE, NVR ou ID LifeGuard" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div className="ft-seg" role="group" aria-label="Tipo">
            {tipos.map(([v, l, n]) => (
              <button key={v} type="button" className={filtros.tipo === v ? "on" : ""} aria-pressed={filtros.tipo === v} onClick={() => filtro("tipo", v)}>
                {l} <span className="qtd">{num(n)}</span>
              </button>
            ))}
          </div>
          <button type="button" className={`ft-chip ${filtros.sem_foto ? "on" : ""}`} aria-pressed={filtros.sem_foto} onClick={() => filtro("sem_foto", !filtros.sem_foto)}>
            Sem foto <span className="qtd">{num(resumo?.sem_foto)}</span>
          </button>
          <select aria-label="Gravador" value={filtros.gravador_id} onChange={(e) => filtro("gravador_id", e.target.value)} style={{ maxWidth: 230 }}>
            <option value="">NVR: todos</option>
            <optgroup label="NVR Life">{gravadores.filter((g) => g.origem === "life").map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}</optgroup>
            <optgroup label="NVR externo">{gravadores.filter((g) => g.origem === "cliente").map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}</optgroup>
          </select>
          <select aria-label="Cidade" value={filtros.cidade} onChange={(e) => filtro("cidade", e.target.value)}>
            <option value="">Cidade: todas</option>
            {cidades.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select aria-label="Situação" value={filtros.status} onChange={(e) => filtro("status", e.target.value)}>
            {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {erro && <div style={{ padding: "10px 20px 0" }}><ErrorBox error={erro} /></div>}

        <div className="ft-doc-corpo">
          <section className="ft-doc-lista" aria-label="Lista de câmeras">
            <div className="ft-linha ft-linha-cab" aria-hidden="true">
              <span>Foto</span><span>Câmera / local</span><span className="c-origem">Origem</span><span>Cliente / contrato</span><span className="c-rede">IP / MAC</span>
            </div>
            <div className="ft-rolagem" onKeyDown={teclaLista}>
              {carregando && lista.itens.length === 0 ? <Spinner /> : lista.itens.length === 0 ? <div className="empty">Nenhuma câmera encontrada com esses filtros.</div> : (
                lista.itens.map((c) => {
                  const t = TIPO_INFO[tipoDe(c)];
                  const st = STATUS_INFO[c.status] || STATUS_INFO.desconhecido;
                  const ativa = c.id === sel;
                  return (
                    <button key={c.id} id={`ft-linha-${c.id}`} type="button" className={`ft-linha ${ativa ? "sel" : ""}`} aria-pressed={ativa} onClick={() => setSel(c.id)}>
                      <span className={`ft-thumb ${c.tem_foto ? "tem" : "nao"}`} title={c.tem_foto ? "Tem foto de documentação" : "Sem foto"} />
                      <span className="cel">
                        <span className="l1"><span className={`ft-dot ${c.status}`} title={st.label} />{c.nome}</span>
                        <span className="l2">{c.descricao_local || "—"}</span>
                      </span>
                      <span className="cel c-origem ft-origem">
                        <Pill status={t.pill}>{t.label}</Pill>
                        <span className="l2">{origemTexto(c)}</span>
                      </span>
                      <span className="cel">
                        <span className="l1 n">{c.nome_cliente || "—"}</span>
                        <span className="l2">{c.contrato_ixc ? <span className="mono">{c.contrato_ixc}</span> : "—"}{c.cidade ? ` · ${c.cidade}` : ""}</span>
                      </span>
                      <span className="cel c-rede mono">
                        <span className="l1 n">{c.ip || "—"}</span>
                        <span className="l2">{c.mac || ""}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="ft-paginacao">
              <span>{num(lista.total)} câmera{lista.total === 1 ? "" : "s"}{carregando ? " · atualizando…" : " · use ↑ ↓ para navegar"}</span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button className="btn btn-ghost btn-sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</button>
                Página {lista.pagina || pagina} de {lista.paginas}
                <button className="btn btn-ghost btn-sm" disabled={pagina >= lista.paginas} onClick={() => setPagina((p) => p + 1)}>Próxima</button>
              </span>
            </div>
          </section>

          <aside className="ft-doc-ficha" aria-label="Ficha da câmera">
            {sel ? (
              <CameraFicha
                key={sel}
                cameraId={sel}
                onEditar={(id) => setModo({ tela: "editar", id })}
                onSubstituir={(id) => setModo({ tela: "editar", id, substituir: true })}
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
