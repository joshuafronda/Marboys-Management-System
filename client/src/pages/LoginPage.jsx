import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import axios from 'axios';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await axios.post('/api/auth/login', { username, password });
      login(res.data.token, res.data.user);

      if (res.data.user.role === 'owner') {
        navigate('/owner/dashboard');
      } else {
        navigate('/admin/dashboard');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-4 relative">
      {/* Theme Toggle */}
      <button
        onClick={toggleTheme}
        className="btn-outline text-xs px-3 py-1.5 absolute top-4 right-4"
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? '☀ Light' : '● Dark'}
      </button>

      {/* Logo */}
      <div className="text-center mb-10">
        <h1 className="text-4xl font-black tracking-tighter text-white">MARBOYS</h1>
        <p className="text-gray-500 text-sm mt-1 uppercase tracking-widest font-medium">Billiard POS System</p>
      </div>

      {/* Card */}
      <div className="card w-full max-w-sm p-8">
        <h2 className="text-lg font-bold text-white mb-1">Sign In</h2>
        <p className="text-sm text-gray-500 mb-6">Enter your credentials to continue</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              Username
            </label>
            <input
              id="username"
              type="text"
              className="input"
              placeholder="e.g. owner or admin"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="input"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-300">
              ⚠ {error}
            </div>
          )}

          <button
            id="login-btn"
            type="submit"
            className="btn-primary w-full py-3 text-base mt-2"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>

      <p className="text-gray-700 text-xs mt-8">Local system — no internet required</p>
    </div>
  );
}
