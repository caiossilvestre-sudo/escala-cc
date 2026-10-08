// Páginas do grupo Ferramentas › LifeGuard (id da aba -> permissão + página).
// Página nova do módulo entra só aqui, sem mexer no App.jsx.
import { createElement } from "react";
import Documentacao from "./Documentacao";

export const PAGINAS_LIFEGUARD = [
  { id: "lg-documentacao", label: "Documentação", permissao: "doc.ver", render: (acesso) => createElement(Documentacao, { acesso }) },
];
