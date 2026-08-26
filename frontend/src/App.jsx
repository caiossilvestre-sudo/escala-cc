import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { useIdleLogout } from "./lib/hooks";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import CronogramaAdmin from "./pages/CronogramaAdmin";
import Colaboradores from "./pages/Colaboradores";
import Plantoes from "./pages/Plantoes";
import Feriados from "./pages/Feriados";
import Aprovacoes from "./pages/Aprovacoes";
import MinhasFerias, { FeriasAdmin } from "./pages/Ferias";
import MeusAtestados, { AtestadosAdmin } from "./pages/Atestados";
import PainelAvisos, { AvisosAdmin } from "./pages/Avisos";
import MeusPlantoes from "./pages/MeusPlantoes";
import CronogramaEquipe from "./pages/CronogramaEquipe";
import SolicitarFolga from "./pages/SolicitarFolga";
import ChangePassword from "./pages/ChangePassword";

const NAV_ADMIN = [
  { id: "dashboard", label: "Dashboard" },
  { id: "cronograma", label: "Cronograma" },
  { id: "colaboradores", label: "Colaboradores" },
  { id: "plantoes", label: "Plantões" },
  { id: "feriados", label: "Feriados" },
  { id: "aprovacoes", label: "Aprovações" },
  { id: "ferias", label: "Férias" },
  { id: "atestados", label: "Atestados" },
  { id: "avisos", label: "Avisos" },
  { id: "senha", label: "Trocar senha" },
];
// Supervisor: só o operacional do próprio setor. Sem Colaboradores (contas),
// sem Feriados (política da empresa inteira) e sem Avisos (rotina global).
const NAV_SUPERVISOR = [
  { id: "dashboard", label: "Dashboard" },
  { id: "cronograma", label: "Cronograma" },
  { id: "plantoes", label: "Plantões" },
  { id: "aprovacoes", label: "Aprovações" },
  { id: "ferias", label: "Férias" },
  { id: "atestados", label: "Atestados" },
  { id: "senha", label: "Trocar senha" },
];
const NAV_COLAB = [
  { id: "meus-plantoes", label: "Meus plantões" },
  { id: "cronograma-equipe", label: "Cronograma do setor" },
  { id: "solicitar-folga", label: "Solicitar folga" },
  { id: "ferias", label: "Minhas férias" },
  { id: "atestados", label: "Meus atestados" },
  { id: "avisos", label: "Painel de avisos" },
  { id: "senha", label: "Trocar senha" },
];

const ROLE_LABEL = { admin: "Administrador", visualizador: "Visualizador (só leitura)", supervisor: "Supervisor", colaborador: "Colaborador" };

function Shell() {
  const { user, loading, logout } = useAuth();
  const [tab, setTab] = useState(null);

  const isAdmin = user?.role === "admin";
  const isViewer = user?.role === "visualizador";
  const isSupervisor = user?.role === "supervisor";
  // Visualizador enxerga as mesmas telas do admin — só não consegue submeter nada.
  const showAdminPages = isAdmin || isViewer;

  useEffect(() => { setTab(null); }, [user?.role]);
  useIdleLogout(logout, 15 * 60 * 1000, !!user);

  if (loading) return null;
  if (!user) return <Login />;

  const nav = showAdminPages ? NAV_ADMIN : isSupervisor ? NAV_SUPERVISOR : NAV_COLAB;
  const activeTab = tab || (showAdminPages || isSupervisor ? "dashboard" : "meus-plantoes");

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="mark">EC</div>
          <div><div className="name display">Escala Suporte Técnico</div><div className="sub">Sistema de escalas</div></div>
        </div>
        <div className="sidebar-user">
          <div className="name">{user.nome}</div>
          <div className="role">{ROLE_LABEL[user.role] || user.role}{user.equipe ? ` · ${user.equipe}` : ""}</div>
          <button onClick={logout}>Sair</button>
        </div>
        <nav className="nav">
          {nav.map((item) => (
            <button key={item.id} className={activeTab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>
          ))}
        </nav>
        <div className="nav-footnote">
          {isAdmin && "Você cadastra pessoas, plantões, aprova folgas, férias e atestados — em todos os setores."}
          {isViewer && "Você enxerga tudo, mas não consegue cadastrar, aprovar ou alterar nada — acesso só de leitura."}
          {isSupervisor && "Você cadastra plantões, aprova folgas, férias e atestados — só do seu próprio setor."}
          {!isAdmin && !isViewer && !isSupervisor && "Você consulta seus plantões e solicita folgas/férias — a aprovação é do admin."}
        </div>
      </aside>

      <main className="main">
        {isViewer && (
          <div style={{ background: "#EEF0F3", borderBottom: "1px solid var(--border)", padding: "8px 26px", fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
            👁️ Modo somente leitura — você pode ver tudo, mas os campos e botões de ação estão desabilitados.
          </div>
        )}
        {isSupervisor && (
          <div style={{ background: "#F0F4FF", borderBottom: "1px solid #DCE1FB", padding: "8px 26px", fontSize: 12, color: "#2A4FA0", display: "flex", alignItems: "center", gap: 6 }}>
            🧭 Acesso de supervisor — as ações valem só para o setor {user.equipe}.
          </div>
        )}
        {/* fieldset desabilita todo input/select/textarea/button descendente de uma vez,
            sem precisar mexer em cada tela individualmente — só pro visualizador. */}
        <fieldset disabled={isViewer} style={{ border: "none", margin: 0, padding: 0 }}>
          {activeTab === "dashboard" && (showAdminPages || isSupervisor) && <Dashboard onNavigate={setTab} />}
          {activeTab === "cronograma" && (showAdminPages || isSupervisor) && <CronogramaAdmin />}
          {activeTab === "colaboradores" && showAdminPages && <Colaboradores />}
          {activeTab === "plantoes" && (showAdminPages || isSupervisor) && <Plantoes />}
          {activeTab === "feriados" && showAdminPages && <Feriados />}
          {activeTab === "aprovacoes" && (showAdminPages || isSupervisor) && <Aprovacoes />}
          {activeTab === "ferias" && ((showAdminPages || isSupervisor) ? <FeriasAdmin /> : <MinhasFerias user={user} />)}
          {activeTab === "atestados" && ((showAdminPages || isSupervisor) ? <AtestadosAdmin /> : <MeusAtestados user={user} />)}
          {activeTab === "avisos" && (showAdminPages ? <AvisosAdmin /> : <PainelAvisos />)}
          {activeTab === "meus-plantoes" && !showAdminPages && !isSupervisor && <MeusPlantoes user={user} />}
          {activeTab === "cronograma-equipe" && !showAdminPages && !isSupervisor && <CronogramaEquipe user={user} />}
          {activeTab === "solicitar-folga" && !showAdminPages && !isSupervisor && <SolicitarFolga user={user} />}
          {activeTab === "senha" && <ChangePassword />}
        </fieldset>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
