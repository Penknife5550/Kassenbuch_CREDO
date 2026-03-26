import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { DailyClosing } from './pages/DailyClosing';
import { Schools } from './pages/admin/Schools';
import { Users } from './pages/admin/Users';
import { Accounts } from './pages/admin/Accounts';
import { CostCenters } from './pages/admin/CostCenters';
import { DatevExport } from './pages/admin/DatevExport';
import { KassenStatus } from './pages/admin/KassenStatus';
import { ReactNode } from 'react';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Laden...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

function AdminRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Laden...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Laden...</div>;
  if (user) return <Navigate to="/" replace />;
  return <Login />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/tagesabschluss" element={<ProtectedRoute><DailyClosing /></ProtectedRoute>} />
          <Route path="/admin/schulen" element={<AdminRoute><Schools /></AdminRoute>} />
          <Route path="/admin/benutzer" element={<AdminRoute><Users /></AdminRoute>} />
          <Route path="/admin/konten" element={<AdminRoute><Accounts /></AdminRoute>} />
          <Route path="/admin/kostenstellen" element={<AdminRoute><CostCenters /></AdminRoute>} />
          <Route path="/admin/datev" element={<AdminRoute><DatevExport /></AdminRoute>} />
          <Route path="/admin/kassenstatus" element={<AdminRoute><KassenStatus /></AdminRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
