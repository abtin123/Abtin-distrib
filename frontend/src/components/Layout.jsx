import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import Icon from './Icon.jsx';
import { ROLES } from '../data/roles.js';
import { authApi } from '../api/auth.js';
import { platformApi } from '../api/platform.js';
import { useTheme } from '../theme.jsx';

export function Sidebar({ role, collapsed, onToggle, mobileOpen, onClose }) {
  const r = ROLES[role];
  const [company, setCompany] = useState(null);
  useEffect(() => { platformApi.company().then(setCompany).catch(() => {}); }, []);
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'open' : ''}`}>
      <div className="sidebar-brand">
        <div className="brand-logo">A</div>
        <div className="brand-meta">
          <div className="brand-name">{company?.name || 'شرکت پخش'}</div>
          <div className="brand-sub">مدیریت هوشمند پخش و توزیع</div>
        </div>
      </div>
      <nav className="side-nav">
        {r.nav.map((item, i) =>
          item.section ? (
            <div key={i} className="nav-section-title">{item.section}</div>
          ) : (
            <NavLink
              key={item.to}
              to={`/app/${role}${item.to}`}
              onClick={onClose}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon"><Icon name={item.icon} size={19} /></span>
              <span className="nav-label">{item.label}</span>
            </NavLink>
          )
        )}
      </nav>
      <div style={{ padding: 14, borderTop: '1px solid var(--border-soft)' }}>
        <div className="muted" style={{ textAlign: 'center' }}>نسخه ۱.۰.۰ · سیستم پخش</div>
      </div>
    </aside>
  );
}

export function Topbar({ role, onToggle, onMobile }) {
  const r = ROLES[role];
  const nav = useNavigate();
  const { theme, toggleTheme } = useTheme();
  // اگر نشست واقعی (JWT) وجود دارد، نام و نقش از API نشان داده می‌شود
  const session = authApi.getSession();
  const displayName = session?.user?.full_name || r.name;
  const displayRole = session?.user?.role?.label || r.label;
  const toggleMenu = () => {
    if (window.matchMedia('(max-width: 900px)').matches) onMobile();
    else onToggle();
  };
  const logout = async () => {
    try {
      if (session?.tokens?.refresh) await authApi.logout(session.tokens.refresh, session.tokens.access);
    } catch { /* نادیده گرفته می‌شود */ }
    authApi.clearSession();
    nav('/');
  };
  return (
    <header className="topbar">
      <button className="topbar-toggle" aria-label="باز و بسته کردن منو" onClick={toggleMenu}><Icon name="menu" size={19} /></button>
      <div className="search-box">
        <Icon name="search" size={17} />
        <input placeholder="جستجو در فاکتورها، مشتریان، کالاها، کاربران…" />
      </div>
      <div className="topbar-right">
        <button className="icon-btn" title={theme === 'dark' ? 'پوسته روشن' : 'پوسته تیره'} onClick={toggleTheme}>
          {theme === 'dark' ? (
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          ) : (
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>
          )}
        </button>
        <button className="icon-btn" title="اعلان‌ها" onClick={() => nav(`/app/${role}/notifications`)}>
          <Icon name="bell" size={19} /><i className="dot" />
        </button>
        <div className="user-chip" title="خروج از حساب" onClick={logout}>
          <div>
            <div className="u-name">{displayName}</div>
            <div className="u-role">{displayRole}{session ? ' · آنلاین' : ' · پیش‌نمایش'}</div>
          </div>
          <div className="avatar">{displayName[0]}</div>
        </div>
      </div>
    </header>
  );
}

export function AppShell({ role, children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const r = ROLES[role];
  return (
    <div className="app-shell">
      <Sidebar role={role} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className={`main-col ${collapsed ? 'collapsed' : ''}`}>
        <Topbar role={role} onToggle={() => setCollapsed(!collapsed)} onMobile={() => setMobileOpen(!mobileOpen)} />
        <main className="page-wrap">{children}</main>
      </div>
      {r.mobile && (
        <div className="mobile-bar">
          <div className="mobile-bar-inner">
            {r.nav.slice(0, 5).map((n) => (
              <NavLink key={n.to} to={`/app/${role}${n.to}`} className={({ isActive }) => `mb-item ${isActive ? 'active' : ''}`}>
                <Icon name={n.icon} size={20} />
                {n.label}
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
