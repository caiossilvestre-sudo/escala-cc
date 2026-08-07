import { AuthProvider, useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import DashboardShell from "./pages/DashboardShell";

function Shell() {
  const { user, loading } = useAuth();
  if (loading) return null;
  return user ? <DashboardShell /> : <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
