import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import OwnerDashboard from './pages/OwnerDashboard';
import AdminDashboard from './pages/AdminDashboard';
import TableMonitor from './pages/TableMonitor';
import POSPage from './pages/POSPage';
import InventoryPage from './pages/InventoryPage';
import SalesHistory from './pages/SalesHistory';
import DailyStock from './pages/DailyStock';

function ProtectedRoute({ children, role }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen bg-gray-950 text-white">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children;
}

function RootRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'owner') return <Navigate to="/owner/dashboard" replace />;
  return <Navigate to="/admin/dashboard" replace />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RootRedirect />} />

          {/* Owner Routes */}
          <Route path="/owner/dashboard" element={
            <ProtectedRoute role="owner"><OwnerDashboard /></ProtectedRoute>
          } />
          <Route path="/owner/inventory" element={
            <ProtectedRoute role="owner"><InventoryPage /></ProtectedRoute>
          } />
          <Route path="/daily-stock" element={
            <ProtectedRoute role="owner"><DailyStock /></ProtectedRoute>
          } />
          <Route path="/owner/sales" element={
            <ProtectedRoute role="owner"><SalesHistory /></ProtectedRoute>
          } />

          {/* Admin Routes */}
          <Route path="/admin/dashboard" element={
            <ProtectedRoute role="admin"><AdminDashboard /></ProtectedRoute>
          } />
          <Route path="/admin/tables" element={
            <ProtectedRoute role="admin"><TableMonitor /></ProtectedRoute>
          } />
          <Route path="/admin/pos" element={
            <ProtectedRoute role="admin"><POSPage /></ProtectedRoute>
          } />
          <Route path="/admin/sales" element={
            <ProtectedRoute role="admin"><SalesHistory /></ProtectedRoute>
          } />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
