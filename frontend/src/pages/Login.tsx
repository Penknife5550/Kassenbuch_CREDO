import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg)',
      }}
    >
      {/* Header bar */}
      <header
        style={{
          background: 'var(--color-primary)',
          height: '56px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 1.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img src="/credo_logo_weiss.svg" alt="CREDO" style={{ height: '28px' }} />
          <span
            style={{
              color: 'var(--color-white)',
              fontFamily: 'var(--font-heading)',
              fontSize: '1.125rem',
              fontWeight: 900,
            }}
          >
            Kassenbuch
          </span>
        </div>
      </header>

      {/* Login Form */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
        }}
      >
        <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
          <h1 style={{ marginBottom: '0.5rem' }}>Anmelden</h1>
          <p className="text-light" style={{ marginBottom: '1.5rem', fontSize: '0.875rem' }}>
            Bitte melden Sie sich mit Ihren Zugangsdaten an.
          </p>

          {error && <div className="alert alert-error" role="alert">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="username">Benutzername</label>
              <input
                id="username"
                type="text"
                className="form-control"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">Passwort</label>
              <input
                id="password"
                type="password"
                className="form-control"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={loading}
            >
              {loading ? 'Anmeldung...' : 'Anmelden'}
            </button>
          </form>
        </div>
      </div>

      {/* CREDO Line */}
      <div style={{ display: 'flex', height: '4px' }} role="presentation">
        <div style={{ flex: '4', background: 'var(--credo-gray)' }} />
        <div style={{ flex: '1', background: 'var(--credo-yellow)' }} />
        <div style={{ flex: '1', background: 'var(--credo-green)' }} />
        <div style={{ flex: '1', background: 'var(--credo-red)' }} />
        <div style={{ flex: '1', background: 'var(--credo-blue)' }} />
      </div>
      <div
        style={{
          background: 'var(--color-secondary)',
          padding: '0.5rem',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: 'var(--color-primary)',
        }}
      >
        CREDO Verwaltung – Kassenbuch
      </div>
    </div>
  );
}
