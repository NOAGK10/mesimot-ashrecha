import { Link, Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, useMe } from './api';
import { LoginPage } from './pages/LoginPage';
import { TasksPage } from './pages/TasksPage';
import { TaskDetailPage } from './pages/TaskDetailPage';
import { NewTaskPage } from './pages/NewTaskPage';
import { RecurrencesPage } from './pages/RecurrencesPage';
import { PeoplePage } from './pages/PeoplePage';
import { OpsPage } from './pages/OpsPage';
import { DevOutboxPage } from './pages/DevOutboxPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { ImportPage } from './pages/ImportPage';
import { SettingsPage } from './pages/SettingsPage';
import { ChatPage } from './pages/ChatPage';
import { HomePage, useInbox } from './pages/HomePage';
import { Avatar } from './components/Avatar';
import { TaskBoardPage } from './pages/TaskBoardPage';
import { BoardPage } from './pages/BoardPage';
import { ProfilePage } from './pages/ProfilePage';
import { PrivacyPage, TermsPage } from './pages/LegalPages';
import { Icon, Sidebar, pageTitle } from './components/Sidebar';
import { CalendarView } from './components/CalendarView';

export function App() {
  const me = useMe();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuCollapsed, setMenuCollapsed] = useState(false);
  const location = useLocation();
  const orgName = me.data?.organization.name;
  useEffect(() => {
    document.title = orgName ? `${orgName} · משימות` : 'משימות';
  }, [orgName]);

  if (location.pathname === '/link-expired') return <LinkExpired />;
  // Public pages, required by Google to publish the sign-in app.
  if (location.pathname === '/privacy') return <PrivacyPage />;
  if (location.pathname === '/terms') return <TermsPage />;
  if (me.isLoading) return <div className="center muted">טוען…</div>;
  if (me.isError) return <div className="center error">שגיאה בטעינה. נסו לרענן את הדף.</div>;
  if (location.pathname === '/dev/outbox') return <DevOutboxPage />;
  if (!me.data) return <LoginPage />;

  // A magic-link visitor sees exactly one task and nothing else.
  if (me.data.access === 'link') {
    return (
      <div className="shell no-menu">
        <header className="topbar">
          <span className="brand"><span className="brand-icon" aria-hidden="true"><Icon name="tasks" size={18} /></span>{me.data.organization.name}</span>
          <span className="muted small">גישה באמצעות קישור · {me.data.displayName}</span>
        </header>
        <main className="content">
          <Routes>
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
            <Route path="*" element={<Navigate to={`/tasks/${me.data.scopeTaskId}`} replace />} />
          </Routes>
        </main>
      </div>
    );
  }

  const isManager = me.data.access === 'manager';
  // Phones: the menu slides in over the page. Wide screens: the button folds it away.
  const toggleMenu = () => (window.matchMedia('(max-width: 900px)').matches ? setMenuOpen((o) => !o) : setMenuCollapsed((c) => !c));
  const canCreate = isManager || me.data.access === 'member';
  return (
    <div className={`shell${menuOpen ? ' menu-open' : ''}${menuCollapsed ? ' menu-collapsed' : ''}`}>
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="תפריט" aria-expanded={menuOpen} onClick={toggleMenu}>
          <Icon name="menu" />
        </button>
        <Link to="/home" className="brand">
          <span className="brand-icon" aria-hidden="true">
            <Icon name="tasks" size={18} />
          </span>
          {me.data.organization.name}
        </Link>
        <span className="page-title">{pageTitle(location.pathname)}</span>
        <span className="topbar-spacer" />
        <Bell />
        <UserMenu name={me.data.displayName} personId={me.data.personId} isManager={isManager} />
      </header>
      <div className="side-backdrop" onClick={() => setMenuOpen(false)} />
      <Sidebar isManager={isManager} onNavigate={() => setMenuOpen(false)} />
      <main className="content">
        <Routes>
          <Route path="/home" element={<HomePage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/people/:id" element={<ProfilePage />} />
          <Route path="/tasks" element={<TasksHome />} />
          <Route path="/my" element={<Navigate to="/tasks" replace />} />
          <Route path="/all" element={<Navigate to="/tasks?scope=org" replace />} />
          {canCreate && <Route path="/tasks/new" element={<NewTaskPage />} />}
          <Route path="/board" element={<BoardPage />} />
          <Route path="/task-board" element={<TaskBoardPage />} />
          <Route path="/team" element={<Navigate to="/board" replace />} />
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
          {isManager && <Route path="/recurring" element={<RecurrencesPage />} />}
          {isManager && <Route path="/documents" element={<DocumentsPage />} />}
          {isManager && <Route path="/import" element={<ImportPage />} />}
          {isManager && <Route path="/people" element={<PeoplePage />} />}
          {isManager && <Route path="/ops" element={<OpsPage />} />}
          {isManager && <Route path="/settings" element={<SettingsPage />} />}
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </main>
    </div>
  );
}

/** One tasks page with a "mine / organisation" switch instead of two menu items. */
function TasksHome() {
  const [params, setParams] = useSearchParams();
  const scope = params.get('scope') === 'org' ? 'all' : 'mine';
  const calendar = params.get('view') === 'calendar';
  const go = (next: { scope?: 'org'; view?: 'calendar' }) => setParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v)) as Record<string, string>);
  const scopeParam = scope === 'all' ? ('org' as const) : undefined;
  const viewParam = calendar ? ('calendar' as const) : undefined;
  return (
    <>
      <div className="tasks-switches">
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={scope === 'mine'} className={scope === 'mine' ? 'active' : ''} onClick={() => go({ view: viewParam })}>
            המשימות שלי
          </button>
          <button role="tab" aria-selected={scope === 'all'} className={scope === 'all' ? 'active' : ''} onClick={() => go({ scope: 'org', view: viewParam })}>
            משימות הארגון
          </button>
        </div>
        <div className="segmented" role="group" aria-label="תצוגה">
          <button type="button" aria-pressed={!calendar} className={!calendar ? 'active' : ''} onClick={() => go({ scope: scopeParam })}>
            רשימה
          </button>
          <button type="button" aria-pressed={calendar} className={calendar ? 'active' : ''} onClick={() => go({ scope: scopeParam, view: 'calendar' })}>
            לוח שנה
          </button>
        </div>
      </div>
      {calendar ? <CalendarView key={scope} mine={scope === 'mine'} /> : <TasksPage key={scope} scope={scope} />}
    </>
  );
}

/** Unread notifications; opens the home page where they are listed. */
function Bell() {
  const inbox = useInbox();
  const unread = inbox.data?.unread ?? 0;
  return (
    <Link to="/home" className="bell icon-btn" aria-label={unread ? `${unread} התראות חדשות` : 'התראות'} title="התראות">
      <Icon name="bell" />
      {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}

/** Name menu. Managers find the technical status screen here; a red dot appears only when something is wrong. */
function UserMenu({ name, personId, isManager }: { name: string; personId: string; isManager: boolean }) {
  const qc = useQueryClient();
  const ops = useQuery({
    queryKey: ['ops'],
    queryFn: () => api<{ worker: { healthy: boolean }; backlogOlderThan15Min: number; recentFailures: unknown[] }>('GET', '/api/ops/status'),
    enabled: isManager,
    refetchInterval: 60_000,
  });
  const problem = Boolean(ops.data && (!ops.data.worker.healthy || ops.data.backlogOlderThan15Min > 0 || ops.data.recentFailures.length > 0));
  const logout = async () => {
    await api('POST', '/api/auth/logout');
    qc.clear();
    window.location.href = '/';
  };
  return (
    <details className="user-menu">
      <summary>
        <span className="user-name">{name}</span>
        <Avatar personId={personId} name={name} size={32} />
        {problem && <span className="alert-dot" title="יש תקלה במערכת" />} ▾
      </summary>
      <div className="menu">
        <Link to={`/people/${personId}`} onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}>
          הפרופיל שלי
        </Link>
        {isManager && (
          <Link to="/settings" onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}>
            הגדרות
          </Link>
        )}
        {isManager && (
          <Link to="/ops" onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}>
            מצב המערכת{problem && ' ⚠'}
          </Link>
        )}
        <button className="link" onClick={logout}>
          יציאה
        </button>
      </div>
    </details>
  );
}

function LinkExpired() {
  return (
    <div className="center card narrow">
      <h1>הקישור אינו בתוקף</h1>
      <p className="muted">ייתכן שפג תוקפו או שהמשימה כבר אינה משויכת אליך. אפשר לפנות למנהל הארגון לקבלת קישור חדש.</p>
    </div>
  );
}
