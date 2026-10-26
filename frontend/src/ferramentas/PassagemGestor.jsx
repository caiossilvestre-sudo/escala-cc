import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { Spinner, ErrorBox } from "../components/UI";
import { PendenciaCard } from "./passagemUtil";

const PERIODOS = [[7, "7 dias"], [30, "30 dias"], [90, "90 dias"]];

function minutos(m) {
  if (m === null || m === undefined) return "—";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

/** Visão do gestor: o que ficou para o horário comercial + indicadores. */
export default function PassagemGestor({ equipe, showToast, onPermissoes }) {
  const [dias, setDias] = useState(30);
  const [ind, setInd] = useState(null);
  const [comercial, setComercial] = useState(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(() => {
    const eq = equipe ? `&equipe=${encodeURIComponent(equipe)}` : "";
    setErro("");
    api.get(`/ferramentas/passagem/indicadores?dias=${dias}${eq}`).then(setInd).catch((e) => setErro(e.message));
    api.get(`/ferramentas/passagem/pendencias?status=aberta&para=horario_comercial${eq}`).then(setComercial).catch((e) => setErro(e.message));
  }, [dias, equipe]);
  useEffect(() => { carregar(); }, [carregar]);

  const atualizar = (nova) => {
    setComercial((l) => (nova.status === "aberta" ? l.map((x) => (x.id === nova.id ? nova : x)) : l.filter((x) => x.id !== nova.id)));
    carregar();
  };

  return (
    <>
      <ErrorBox error={erro} />
      <div className="card pp-bloco">
        <div className="pp-cat-topo">
          <div>
            <div className="pp-bloco-titulo">Para o horário comercial</div>
            <div className="pp-dica">Tudo que os plantões deixaram para ser visto em horário comercial e ainda está aberto — prioridade alta primeiro.</div>
          </div>
          {onPermissoes && <button type="button" className="btn btn-ghost btn-sm" onClick={onPermissoes}>Permissões</button>}
        </div>
        {!comercial ? <Spinner /> : comercial.length === 0 ? <div className="empty">Nada pendente para o horário comercial. 🎉</div> : (
          <div className="pp-lista">
            {[...comercial].sort((a, b) => (a.prioridade === "alta" ? 0 : 1) - (b.prioridade === "alta" ? 0 : 1)).map((p) => (
              <PendenciaCard key={p.id} p={p} showToast={showToast} onMudou={atualizar} />
            ))}
          </div>
        )}
      </div>

      <div className="pp-cat-topo" style={{ margin: "18px 0 10px" }}>
        <div className="pp-bloco-titulo">Indicadores</div>
        <div className="ft-seg" role="group" aria-label="Período">
          {PERIODOS.map(([d, l]) => <button key={d} type="button" className={dias === d ? "on" : ""} aria-pressed={dias === d} onClick={() => setDias(d)}>{l}</button>)}
        </div>
      </div>
      {!ind ? <Spinner /> : (
        <>
          <div className="pp-stats">
            <div className="card stat"><div className="num">{ind.passagens}</div><div className="label">passagens no período</div></div>
            <div className="card stat"><div className="num" style={{ color: ind.sem_ciencia ? "var(--pendente)" : undefined }}>{ind.sem_ciencia}</div><div className="label">sem ciência do próximo plantão</div></div>
            <div className="card stat"><div className="num">{minutos(ind.ciencia_media_min)}</div><div className="label">tempo médio até a ciência</div></div>
            <div className="card stat"><div className="num" style={{ color: ind.abertas_alta ? "var(--danger)" : undefined }}>{ind.pendencias_abertas}</div><div className="label">pendências abertas · {ind.abertas_alta} alta · {ind.abertas_mais_24h} há +24h</div></div>
            <div className="card stat"><div className="num">{ind.resolvidas}/{ind.criadas}</div><div className="label">resolvidas / lançadas no período</div></div>
            <div className="card stat"><div className="num">{ind.resolucao_media_h === null ? "—" : `${ind.resolucao_media_h} h`}</div><div className="label">tempo médio de resolução</div></div>
          </div>

          <div className="pp-duas">
            <div className="card">
              <div className="pp-bloco-titulo" style={{ marginBottom: 10 }}>Por categoria</div>
              <table className="tbl">
                <thead><tr><th>Categoria</th><th style={{ textAlign: "right" }}>Abertas agora</th><th style={{ textAlign: "right" }}>Lançadas</th><th style={{ textAlign: "right" }}>Resolvidas</th></tr></thead>
                <tbody>
                  {ind.por_categoria.map((c) => (
                    <tr key={c.categoria}>
                      <td><span className={`pill pp-${c.categoria}`}>{c.nome}</span></td>
                      <td className="mono" style={{ textAlign: "right" }}>{c.abertas}</td>
                      <td className="mono" style={{ textAlign: "right" }}>{c.criadas}</td>
                      <td className="mono" style={{ textAlign: "right" }}>{c.resolvidas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <div className="pp-bloco-titulo" style={{ marginBottom: 10 }}>Por plantonista</div>
              {ind.por_autor.length === 0 ? <div className="empty">Nenhuma passagem no período.</div> : (
                <table className="tbl">
                  <thead><tr><th>Plantonista</th><th style={{ textAlign: "right" }}>Passagens</th><th style={{ textAlign: "right" }}>Pendências lançadas</th></tr></thead>
                  <tbody>
                    {ind.por_autor.map((a) => (
                      <tr key={a.nome}><td>{a.nome}</td><td className="mono" style={{ textAlign: "right" }}>{a.passagens}</td><td className="mono" style={{ textAlign: "right" }}>{a.pendencias}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
