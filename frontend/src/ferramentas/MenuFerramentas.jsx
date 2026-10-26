import { useState } from "react";
import { PAGINAS_LIFEGUARD } from "./paginas";
import "./ferramentas.css";

const ICONES = {
  LifeGuard: <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
  Plantão: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9 2h6" /></>,
};

/** Um subgrupo do menu (abre/fecha) com as páginas liberadas para a pessoa. */
function Subgrupo({ nome, itens, ativo, onIr }) {
  const [aberto, setAberto] = useState(true);
  return (
    <>
      <button type="button" className="ft-menu-pai" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#E8752E" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONES[nome] || ICONES.LifeGuard}</svg>
        {nome}
        <svg className="seta" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9AA2B8" strokeWidth="2.4" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {aberto && (
        <div className="ft-menu-filhos">
          {itens.map((p) => (
            <button key={p.id} type="button" className={ativo === p.id ? "active" : ""} aria-current={ativo === p.id ? "page" : undefined} onClick={() => onIr(p.id)}>{p.label}</button>
          ))}
        </div>
      )}
    </>
  );
}

/** Grupo "Ferramentas" do menu lateral: LifeGuard, Plantão… › páginas liberadas. */
export default function MenuFerramentas({ acesso, ativo, onIr }) {
  const itens = PAGINAS_LIFEGUARD.filter((p) => acesso.tem(p.permissao));
  if (!itens.length) return null;
  const grupos = [...new Set(itens.map((p) => p.grupo || "LifeGuard"))];
  return (
    <div className="nav-group">
      <div className="nav-group-label">Ferramentas</div>
      {grupos.map((g) => (
        <Subgrupo key={g} nome={g} itens={itens.filter((p) => (p.grupo || "LifeGuard") === g)} ativo={ativo} onIr={onIr} />
      ))}
    </div>
  );
}
