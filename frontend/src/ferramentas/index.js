// Ponto de entrada do módulo Ferramentas para o App.jsx do Escala.
//
// No App.jsx (ver INTEGRACAO.md):
//   const ft = useFerramentasAcesso(user?.colaborador_id);
//   <MenuFerramentas acesso={ft} ativo={activeTab} onIr={setTab} />   (dentro do <nav>)
//   <FerramentasPagina tab={activeTab} acesso={ft} />                  (dentro do <main>)
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { PAGINAS_LIFEGUARD } from "./paginas";

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
  return { permissoes, tem };
}

/** Renderiza a página de Ferramentas da aba ativa (ou nada, se a aba não é do módulo). */
export function FerramentasPagina({ tab, acesso }) {
  const pagina = PAGINAS_LIFEGUARD.find((p) => p.id === tab);
  if (!pagina || !acesso.tem(pagina.permissao)) return null;
  return pagina.render(acesso);
}
