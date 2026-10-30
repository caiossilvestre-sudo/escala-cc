// Páginas do módulo Ferramentas (id da aba -> grupo do menu + permissão + página).
// Página nova do módulo entra só aqui, sem mexer no App.jsx — desde que o id
// comece com "lg-" ou "ft-" (é o que o App.jsx reconhece como aba do módulo).
// "visivel" (opcional) refina quem vê o item; "contador" mostra o número de
// solicitações abertas ao lado do item. "link" (opcional) faz o item abrir
// esse endereço numa aba nova em vez de uma página do sistema.
import { createElement } from "react";
import Documentacao from "./Documentacao";
import Gravadores from "./Gravadores";
import Passagem from "./Passagem";
import Acessos from "./Acessos";
import EmConstrucao from "./EmConstrucao";
import Solicitacoes from "./Solicitacoes";

export const PAGINAS_LIFEGUARD = [
  { id: "lg-documentacao", grupo: "LifeGuard", label: "Documentação", permissao: "doc.ver", render: (acesso) => createElement(Documentacao, { acesso }) },
  { id: "lg-solicitacoes", grupo: "LifeGuard", label: "Solicitações", permissao: "doc.tratar", contador: true, render: (acesso) => createElement(Solicitacoes, { acesso }) },
  { id: "lg-meus-pedidos", grupo: "LifeGuard", label: "Meus pedidos", permissao: "doc.solicitar", visivel: (a) => !a.tem("doc.tratar"), render: (acesso) => createElement(Solicitacoes, { acesso }) },
  { id: "lg-gravadores", grupo: "LifeGuard", label: "Gravadores", permissao: "nvr.gerenciar", render: (acesso) => createElement(Gravadores, { acesso }) },
  { id: "ft-passagem", grupo: "Plantão", label: "Passagem de plantão", permissao: "passagem.registrar", render: (acesso) => createElement(Passagem, { acesso }) },
  { id: "ft-acessos", grupo: "Setor", label: "Acessos do setor", permissao: "acessos.usar", render: () => createElement(Acessos) },
  // http dentro do sistema (https) é bloqueado pelo navegador — por isso abre em aba nova
  { id: "ft-escalation-infra", grupo: "Setor", label: "Escalation Infraestrutura", permissao: "escalation.infra", link: "http://cet.soon.it:5000/publico" },
  { id: "ft-escalation-n2", grupo: "Setor", label: "Escalation Operações (N2)", permissao: "escalation.n2", render: () => createElement(EmConstrucao, { titulo: "Escalation Operações (N2)" }) },
];

export const paginaLiberada = (p, acesso) => acesso.tem(p.permissao) && (!p.visivel || p.visivel(acesso));
