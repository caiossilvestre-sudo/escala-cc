// Ponto de entrada do módulo Ferramentas para o App.jsx do Escala.
//
// No App.jsx são só 3 ajustes (ver INTEGRACAO.md):
//   const ft = useFerramentasAcesso(user?.colaborador_id);
//   const nav = ft.nav ? [...navBase, ft.nav] : navBase;
//   <FerramentasPagina tab={activeTab} acesso={ft} />
// Páginas novas do módulo entram aqui, sem mexer de novo no App.jsx.
import { createElement, useEffect, useState } from "react";
import { api } from "../api/client";
import Documentacao from "./Documentacao";
import Referencia from "./Referencia";
import EmConstrucao from "./EmConstrucao";

// id da aba no menu -> permissão necessária + página
export const PAGINAS_LIFEGUARD = [
  { id: "lg-documentacao", label: "Documentação", permissao: "doc.ver", render: (acesso) => createElement(Documentacao, { acesso }) },
  { id: "lg-referencia", label: "Referência", permissao: "referencia", render: () => createElement(Referencia) },
  { id: "lg-provisionamento", label: "Auxílio p/ provisionamento", permissao: "provisionamento", render: () => createElement(EmConstrucao, { titulo: "Auxílio para provisionamento", sub: "Checklist, portas, links de teste e ONVIF" }) },
  { id: "lg-diagnostico", label: "Diagnosticar", permissao: "diagnostico", render: () => createElement(EmConstrucao, { titulo: "Diagnosticar", sub: "Teste de porta e frame ao vivo, com comprovante em PDF" }) },
  { id: "lg-aovivo", label: "Ao vivo", permissao: "aovivo", render: () => createElement(EmConstrucao, { titulo: "Ao vivo", sub: "Mosaico de canais do NVR, sem gravação" }) },
];

/** Permissões da pessoa logada em Ferramentas + o grupo do menu já montado. */
export function useFerramentasAcesso(userId) {
  const [permissoes, setPermissoes] = useState([]);
  useEffect(() => {
    if (!userId) { setPermissoes([]); return; }
    api.get("/ferramentas/me").then((r) => setPermissoes(r.permissoes || [])).catch(() => setPermissoes([]));
  }, [userId]);
  const tem = (p) => permissoes.includes(p);
  const itens = PAGINAS_LIFEGUARD.filter((p) => tem(p.permissao)).map(({ id, label }) => ({ id, label }));
  return { permissoes, tem, nav: itens.length ? { grupo: "Ferramentas · LifeGuard", itens } : null };
}

/** Renderiza a página de Ferramentas da aba ativa (ou nada, se a aba não é do módulo). */
export function FerramentasPagina({ tab, acesso }) {
  const pagina = PAGINAS_LIFEGUARD.find((p) => p.id === tab);
  if (!pagina || !acesso.tem(pagina.permissao)) return null;
  return pagina.render(acesso);
}
