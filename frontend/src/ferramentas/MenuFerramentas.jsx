import { useEffect, useState } from "react";
import { api } from "../api/client";
import { PAGINAS_LIFEGUARD, paginaLiberada } from "./paginas";
import "./ferramentas.css";

/** Grupo "Ferramentas" do menu lateral: LifeGuard (abre/fecha) › páginas liberadas para a pessoa. */
export default function MenuFerramentas({ acesso, ativo, onIr }) {
  const [aberto, setAberto] = useState(true);
  const itens = PAGINAS_LIFEGUARD.filter((p) => paginaLiberada(p, acesso));
  const trata = acesso.tem("doc.tratar");
  const [abertas, setAbertas] = useState(0);
  // contador de solicitações abertas (para o N2), atualiza a cada minuto
  useEffect(() => {
    if (!trata) { setAbertas(0); return undefined; }
    const ler = () => api.get("/ferramentas/solicitacoes-contagem").then((r) => setAbertas(r.abertas || 0)).catch(() => {});
    ler();
    const t = setInterval(ler, 60000);
    window.addEventListener("ft-solicitacoes-mudou", ler); // tratada agora na tela de Solicitações
    return () => { clearInterval(t); window.removeEventListener("ft-solicitacoes-mudou", ler); };
  }, [trata, ativo]);
  if (!itens.length) return null;
  return (
    <div className="nav-group">
      <div className="nav-group-label">Ferramentas</div>
      <button type="button" className="ft-menu-pai" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#E8752E" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /></svg>
        LifeGuard
        <svg className="seta" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9AA2B8" strokeWidth="2.4" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {aberto && (
        <div className="ft-menu-filhos">
          {itens.map((p) => (
            <button key={p.id} type="button" className={ativo === p.id ? "active" : ""} aria-current={ativo === p.id ? "page" : undefined} onClick={() => onIr(p.id)}>{p.label}{p.contador && abertas > 0 && <span className="badge">{abertas}</span>}</button>
          ))}
        </div>
      )}
    </div>
  );
}
