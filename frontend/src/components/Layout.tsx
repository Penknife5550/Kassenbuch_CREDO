import { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <a href="#main-content" className="sr-only" style={{ position: 'absolute', left: '-9999px' }}>
        Zum Inhalt springen
      </a>
      {/* Header */}
      <header
        style={{
          background: 'var(--color-primary)',
          color: 'var(--color-white)',
          padding: '0 1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '56px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
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
          </Link>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.8125rem' }}>
            {user?.displayName}
            {user?.school && (
              <span style={{ opacity: 0.7 }}> | {user.school.name}</span>
            )}
          </span>
          <button className="btn btn-sm btn-outline" style={{ color: 'white', borderColor: 'rgba(255,255,255,0.4)' }} onClick={handleLogout}>
            Abmelden
          </button>
        </div>
      </header>

      {/* Navigation */}
      <nav
        style={{
          background: 'var(--color-white)',
          borderBottom: '1px solid var(--color-border)',
          padding: '0 1.5rem',
          display: 'flex',
          gap: '0',
          flexShrink: 0,
        }}
      >
        <NavLink to="/" active={location.pathname === '/'}>Kassenbuch</NavLink>
        <NavLink to="/tagesabschluss" active={isActive('/tagesabschluss')}>Tagesabschluss</NavLink>
        {user?.role === 'ADMIN' && (
          <>
            <NavLink to="/admin/kassenstatus" active={isActive('/admin/kassenstatus')}>Kassenstatus</NavLink>
            <NavLink to="/admin/schulen" active={isActive('/admin/schulen')}>Schulen</NavLink>
            <NavLink to="/admin/benutzer" active={isActive('/admin/benutzer')}>Benutzer</NavLink>
            <NavLink to="/admin/konten" active={isActive('/admin/konten')}>Konten</NavLink>
            <NavLink to="/admin/kostenstellen" active={isActive('/admin/kostenstellen')}>Kostenstellen</NavLink>
            <NavLink to="/admin/datev" active={isActive('/admin/datev')}>DATEV Export</NavLink>
          </>
        )}
      </nav>

      {/* Content */}
      <main id="main-content" style={{ flex: 1, padding: '1.5rem', maxWidth: '1280px', width: '100%', margin: '0 auto' }}>
        {children}
      </main>

      {/* CREDO Line */}
      <footer style={{ flexShrink: 0 }}>
        <div
          style={{ display: 'flex', height: '4px' }}
          role="presentation"
        >
          <div style={{ flex: '4', background: 'var(--credo-gray)' }} />
          <div style={{ flex: '1', background: 'var(--credo-yellow)' }} />
          <div style={{ flex: '1', background: 'var(--credo-green)' }} />
          <div style={{ flex: '1', background: 'var(--credo-red)' }} />
          <div style={{ flex: '1', background: 'var(--credo-blue)' }} />
        </div>
        <div
          style={{
            background: 'var(--color-secondary)',
            padding: '0.5rem 1.5rem',
            textAlign: 'center',
            fontSize: '0.75rem',
            color: 'var(--color-primary)',
          }}
        >
          CREDO Verwaltung – Kassenbuch
        </div>
      </footer>
    </div>
  );
}

function NavLink({ to, active, children }: { to: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      to={to}
      style={{
        padding: '0.75rem 1rem',
        fontSize: '0.8125rem',
        fontWeight: active ? 700 : 500,
        color: active ? 'var(--color-primary)' : 'var(--color-text-light)',
        borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
        transition: 'color 0.2s, border-color 0.2s',
      }}
    >
      {children}
    </Link>
  );
}
