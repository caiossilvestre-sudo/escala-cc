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
const NAV_COLAB = [
  { id: "meus-plantoes", label: "Meus plantões" },
  { id: "cronograma-equipe", label: "Cronograma do setor" },
  { id: "solicitar-folga", label: "Solicitar folga" },
  { id: "ferias", label: "Minhas férias" },
  { id: "atestados", label: "Meus atestados" },
  { id: "avisos", label: "Painel de avisos" },
  { id: "senha", label: "Trocar senha" },
];

function Shell() {
  const { user, loading, logout } = useAuth();
  const [tab, setTab] = useState(null);

  const isAdmin = user?.role === "admin";
  useEffect(() => { setTab(null); }, [user?.role]);
  useIdleLogout(logout, 15 * 60 * 1000, !!user);

  if (loading) return null;
  if (!user) return <Login />;

  const nav = isAdmin ? NAV_ADMIN : NAV_COLAB;
  const activeTab = tab || (isAdmin ? "dashboard" : "meus-plantoes");

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="mark">EC</div>
          <div><div className="name display">Escala Suporte Técnico</div><div className="sub">Sistema de escalas</div></div>
        </div>
        <div className="sidebar-user">
          <div className="name">{user.nome}</div>
          <div className="role">{isAdmin ? "Administrador" : "Colaborador"}{user.equipe ? ` · ${user.equipe}` : ""}</div>
          <button onClick={logout}>Sair</button>
        </div>
        <nav className="nav">
          {nav.map((item) => (
            <button key={item.id} className={activeTab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>
          ))}
        </nav>
        <div className="nav-footnote">
          {isAdmin ? "Você cadastra pessoas, plantões, aprova folgas, férias e atestados." : "Você consulta seus plantões e solicita folgas/férias — a aprovação é do admin."}
        </div>
      </aside>

      <main className="main">
        {activeTab === "dashboard" && isAdmin && <Dashboard />}
        {activeTab === "cronograma" && isAdmin && <CronogramaAdmin />}
        {activeTab === "colaboradores" && isAdmin && <Colaboradores />}
        {activeTab === "plantoes" && isAdmin && <Plantoes />}
        {activeTab === "feriados" && isAdmin && <Feriados />}
        {activeTab === "aprovacoes" && isAdmin && <Aprovacoes />}
        {activeTab === "ferias" && (isAdmin ? <FeriasAdmin /> : <MinhasFerias user={user} />)}
        {activeTab === "atestados" && (isAdmin ? <AtestadosAdmin /> : <MeusAtestados user={user} />)}
        {activeTab === "avisos" && (isAdmin ? <AvisosAdmin /> : <PainelAvisos />)}
        {activeTab === "meus-plantoes" && !isAdmin && <MeusPlantoes user={user} />}
        {activeTab === "cronograma-equipe" && !isAdmin && <CronogramaEquipe user={user} />}
        {activeTab === "solicitar-folga" && !isAdmin && <SolicitarFolga user={user} />}
        {activeTab === "senha" && <ChangePassword />}
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
