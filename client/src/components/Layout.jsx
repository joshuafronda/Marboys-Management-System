import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Home, Users, DollarSign, Clock, Sun, Moon, LogOut, MonitorCheck } from 'lucide-react';


const ownerLinks = [
  { to: '/owner/dashboard', label: 'Dashboard', icon: <Home size={14} /> },
  { to: '/owner/inventory', label: 'Inventory', icon: <Users size={14} /> },
  { to: '/owner/sales', label: 'Sales History', icon: <DollarSign size={14} /> },
];

const adminLinks = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: <Home size={14} /> },
  { to: '/admin/tables', label: 'Table Monitor', icon: <Clock size={14} /> },
  { to: '/admin/pos', label: 'POS', icon: <MonitorCheck size={14} /> } ,
  { to: '/admin/sales', label: 'Sales History', icon: <DollarSign size={14} /> },
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
      {/* Top Nav */}
      <header className="border-b border-gray-800 bg-gray-950 fixed top-0 left-0 right-0 z-50">
        <div className="max-w-screen-xl mx-auto px-4 h-14 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <span className="text-xl font-black tracking-tighter text-white">MARBOYS</span>
            <span className="text-xs text-gray-500 font-medium uppercase tracking-widest hidden sm:block"></span>
          </div>

          {/* Nav Links */}
          <nav className="flex items-center gap-1">
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
                <span className="hidden md:inline">{link.label}</span>
              </NavLink>
            ))}
          </nav>
          

          {/* User Info + Theme Toggle + Logout */}
          <div className="flex items-center gap-4">
             <div className="text-right hidden sm:block">
              <p className="text-xs text-white font-semibold leading-none">{user?.name}</p>
            </div>
            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-full border border-gray-700 flex items-center justify-center transition-all hover:border-gray-500 hover:scale-110"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
            <button
              onClick={() => setShowLogoutModal(true)}
              className="w-8 h-8 rounded-full border border-gray-700 flex items-center justify-center transition-all hover:border-gray-500 hover:scale-110"
              title="Logout"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-xs p-6 text-center">
            <h2 className="text-lg font-bold text-white mb-2">Confirm Logout</h2>
            <p className="text-sm text-gray-400 mb-6">Are you sure you want to logout?</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowLogoutModal(false)}
                className="btn-outline flex-1 py-2"
              >
                Cancel
              </button>
              <button
                onClick={confirmLogout}
                className="btn-primary flex-1 py-2"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className={`flex-1 mx-auto w-full px-4 py-6 pt-20 page-enter ${fullWidth ? '' : 'max-w-screen-xl'}`}>
        {children}
      </main>


    </div>
  );
}
