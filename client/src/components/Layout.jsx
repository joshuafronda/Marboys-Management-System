import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Home, Users, DollarSign, Clock, Sun, Moon, LogOut, MonitorCheck } from 'lucide-react';

const ownerLinks = [
  { to: '/owner/dashboard', label: 'Dashboard', icon: <Home size={15} /> },
  { to: '/owner/inventory', label: 'Inventory', icon: <Users size={15} /> },
  { to: '/owner/sales', label: 'Sales History', icon: <DollarSign size={15} /> },
];

const adminLinks = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: <Home size={15} /> },
  { to: '/admin/tables', label: 'Table Monitor', icon: <Clock size={15} /> },
  { to: '/admin/pos', label: 'POS', icon: <MonitorCheck size={15} /> },
  { to: '/admin/sales', label: 'Sales History', icon: <DollarSign size={15} /> },
];

export default function Layout({ children, fullWidth }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const confirmLogout = () => {
    logout();
    navigate('/login');
    setShowLogoutModal(false);
  };

  const links = user?.role === 'owner' ? ownerLinks : adminLinks;

  return (
    <div className="min-h-screen flex flex-col bg-gray-950">
      {/* ── Top Nav ── */}
      <header className="border-b border-gray-800 bg-gray-950 fixed top-0 left-0 right-0 z-50">
        <div className="max-w-screen-xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-2">

          {/* Logo */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xl font-black tracking-tighter text-white">MARBOYS</span>
          </div>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
            {links.map(link => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 flex items-center gap-1.5 ` +
                  (isActive
                    ? 'bg-white text-black'
                    : 'text-gray-400 hover:text-white hover:bg-gray-900')
                }
              >
                <span className="leading-none">{link.icon}</span>
                <span>{link.label}</span>
              </NavLink>
            ))}
          </nav>

          {/* Right Controls */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* User name — hidden on mobile */}
            <div className="hidden sm:block text-right">
              <p className="text-xs text-white font-semibold leading-none truncate max-w-[110px]">{user?.name}</p>
            </div>

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-full border border-gray-700 flex items-center justify-center transition-all hover:border-gray-500 hover:scale-110 flex-shrink-0"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>

            {/* Logout — desktop only */}
            <button
              onClick={() => setShowLogoutModal(true)}
              className="hidden sm:flex w-8 h-8 rounded-full border border-gray-700 items-center justify-center transition-all hover:border-gray-500 hover:scale-110 flex-shrink-0"
              title="Logout"
            >
              <LogOut size={14} />
            </button>

          </div>
        </div>

      </header>

      {/* ── Logout Modal ── */}
      {showLogoutModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
          <div className="card w-full max-w-xs p-6 text-center">
            <h2 className="text-lg font-bold text-white mb-2">Confirm Logout</h2>
            <p className="text-sm text-gray-400 mb-6">Are you sure you want to logout?</p>
            <div className="flex gap-3">
              <button onClick={() => setShowLogoutModal(false)} className="btn-outline flex-1 py-2">
                Cancel
              </button>
              <button onClick={confirmLogout} className="btn-primary flex-1 py-2">
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main Content ── */}
      <main className={`flex-1 mx-auto w-full px-3 sm:px-4 lg:px-6 py-4 sm:py-6 pt-[72px] sm:pt-20 pb-[80px] md:pb-6 page-enter ${fullWidth ? '' : 'max-w-screen-xl'}`}>
        {children}
      </main>

      {/* ── Bottom Navigation Bar (Mobile Only) ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 z-50">
        <div className="flex items-center justify-around h-16">
          {links.map(link => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all ` +
                (isActive
                  ? 'text-white'
                  : 'text-gray-500 hover:text-gray-300')
              }
            >
              <span className="leading-none">{link.icon}</span>
              <span className="text-[10px] font-medium">{link.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
