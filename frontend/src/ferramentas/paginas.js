// Páginas do grupo Ferramentas › LifeGuard (id da aba -> permissão + página).
// Página nova do módulo entra só aqui, sem mexer no App.jsx.
// "visivel" (opcional) refina quem vê o item no menu.
import { createElement } from "react";
import Documentacao from "./Documentacao";
import Gravadores from "./Gravadores";
import Solicitacoes from "./Solicitacoes";

export const PAGINAS_LIFEGUARD = [
  { id: "lg-documentacao", label: "Documentação", permissao: "doc.ver", render: (acesso) => createElement(Documentacao, { acesso }) },
  { id: "lg-solicitacoes", label: "Solicitações", permissao: "doc.tratar", contador: true, render: (acesso) => createElement(Solicitacoes, { acesso }) },
  { id: "lg-meus-pedidos", label: "Meus pedidos", permissao: "doc.solicitar", visivel: (a) => !a.tem("doc.tratar"), render: (acesso) => createElement(Solicitacoes, { acesso }) },
  { id: "lg-gravadores", label: "Gravadores", permissao: "nvr.gerenciar", render: (acesso) => createElement(Gravadores, { acesso }) },
];

export const paginaLiberada = (p, acesso) => acesso.tem(p.permissao) && (!p.visivel || p.visivel(acesso));
