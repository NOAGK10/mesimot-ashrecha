import { useState } from 'react';
import { NavLink } from 'react-router';
import { useChatChannels } from '../api';

/** Material-style filled icons (24×24). */
const ICONS = {
  menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
  home: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  tasks: 'M22 7h-9v2h9V7zm0 8h-9v2h9v-2zM5.54 11 2 7.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41L5.54 11zm0 8L2 15.46l1.41-1.41 2.12 2.12 4.24-4.24 1.41 1.41L5.54 19z',
  board: 'M4 4h4.5v16H4zM9.75 4h4.5v11h-4.5zM15.5 4H20v7h-4.5z',
  people: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
  chat: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z',
  manage:
    'M16.5 12c1.38 0 2.49-1.12 2.49-2.5S17.88 7 16.5 7 14 8.12 14 9.5s1.12 2.5 2.5 2.5zM9 11c1.66 0 2.99-1.34 2.99-3S10.66 5 9 5 6 6.34 6 8s1.34 3 3 3zm7.5 3c-1.83 0-5.5.92-5.5 2.75V19h11v-2.25c0-1.83-3.67-2.75-5.5-2.75zM9 13c-2.33 0-7 1.17-7 3.5V19h7v-2.25c0-.85.33-2.34 2.37-3.47C10.5 13.1 9.66 13 9 13z',
  recurring:
    'M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8c-.45-.83-.7-1.79-.7-2.8 0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.79.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z',
  documents: 'M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z',
  import: 'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
  admin: 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z',
  bell: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  send: 'M2.01 21 23 12 2.01 3 2 10l15 2-15 2z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  back: 'M4 11h12.17l-5.59-5.59L12 4l8 8-8 8-1.41-1.41L16.17 13H4z',
  open: 'M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
  file: 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  attach:
    'M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z',
  mic: 'M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z',
  trash: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  chevron: 'M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z',
} as const;

export function Icon({ name, size = 24 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

type Item = { to: string; label: string; icon: keyof typeof ICONS; end?: boolean };

const MAIN: Item[] = [
  { to: '/home', label: 'בית', icon: 'home' },
  { to: '/tasks', label: 'משימות', icon: 'tasks' },
  { to: '/task-board', label: 'לוח משימות', icon: 'board' },
  { to: '/board', label: 'לוח אחראים', icon: 'people' },
  { to: '/chat', label: "צ'אט", icon: 'chat' },
];
const ADMIN: Item[] = [
  { to: '/people', label: 'ניהול אנשים', icon: 'manage', end: true },
  { to: '/recurring', label: 'משימות חוזרות', icon: 'recurring' },
  { to: '/documents', label: 'מסמכים', icon: 'documents' },
  { to: '/import', label: 'ייבוא', icon: 'import' },
];

/** Every page's title, shown next to the organisation name in the header. */
export function pageTitle(pathname: string): string {
  if (pathname.startsWith('/tasks/new')) return 'משימה חדשה';
  if (pathname.startsWith('/tasks/')) return 'משימה';
  if (pathname.startsWith('/people/')) return 'פרופיל';
  const all = [...MAIN, ...ADMIN, { to: '/settings', label: 'הגדרות' }, { to: '/ops', label: 'מצב המערכת' }];
  return all.find((i) => pathname === i.to || pathname.startsWith(`${i.to}/`))?.label ?? '';
}

/** Side menu on the right: everyday pages on top, managers' pages in a collapsible "ניהול" group. */
export function Sidebar({ isManager, onNavigate }: { isManager: boolean; onNavigate: () => void }) {
  const [adminOpen, setAdminOpen] = useState(true);
  const channels = useChatChannels();
  const unreadChat = (channels.data ?? []).reduce((n, c) => n + c.unread, 0);
  const link = (i: Item) => (
    <NavLink key={i.to} to={i.to} end={i.end} className="side-link" onClick={onNavigate}>
      <Icon name={i.icon} />
      <span>{i.label}</span>
      {i.to === '/chat' && unreadChat > 0 && (
        <span className="side-badge" aria-label={`${unreadChat} הודעות שלא נקראו`}>
          {unreadChat > 99 ? '99+' : unreadChat}
        </span>
      )}
    </NavLink>
  );
  return (
    <nav className="sidebar" aria-label="תפריט ראשי">
      {MAIN.map(link)}
      {isManager && (
        <div className="side-group">
          <button type="button" className="side-group-head" aria-expanded={adminOpen} onClick={() => setAdminOpen((o) => !o)}>
            <Icon name="admin" />
            <span>ניהול</span>
            <span className={`side-chevron${adminOpen ? '' : ' closed'}`}>
              <Icon name="chevron" size={20} />
            </span>
          </button>
          {adminOpen && ADMIN.map(link)}
        </div>
      )}
    </nav>
  );
}
