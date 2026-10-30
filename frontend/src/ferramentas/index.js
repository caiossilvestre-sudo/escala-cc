// Ponto de entrada do módulo Ferramentas para o App.jsx do Escala.
//
// No App.jsx (ver INTEGRACAO.md):
//   const ft = useFerramentasAcesso(user?.colaborador_id);
//   <MenuFerramentas acesso={ft} ativo={activeTab} onIr={setTab} />   (dentro do <nav>)
//   <FerramentasPagina tab={activeTab} acesso={ft} />                  (dentro do <main>)
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { PAGINAS_LIFEGUARD, paginaLiberada } from "./paginas";

export { PAGINAS_LIFEGUARD };
export { default as MenuFerramentas } from "./MenuFerramentas";

/** Permissões da pessoa logada em Ferramentas. */
export function useFerramentasAcesso(userId) {
  const [permissoes, setPermissoes] = useState([]);
  useEffect(() => {
    if (!userId) { setPermissoes([]); return; }
    api.get("/ferramentas/me").then((r) => setPermissoes(r.permissoes || [])).catch(() => setPermissoes([]));
  }, [userId]);
  const tem = (p) => permissoes.includes(p);
  // primeira página liberada (para quem só vê Ferramentas)
  const inicial = PAGINAS_LIFEGUARD.find((p) => !p.link && paginaLiberada(p, { tem }))?.id || null;
  return { permissoes, tem, inicial };
}

/** Renderiza a página de Ferramentas da aba ativa (ou nada, se a aba não é do módulo). */
export function FerramentasPagina({ tab, acesso }) {
  const pagina = PAGINAS_LIFEGUARD.find((p) => p.id === tab);
  if (!pagina || pagina.link || !paginaLiberada(pagina, acesso)) return null;
  return pagina.render(acesso);
}
