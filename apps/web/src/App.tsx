import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { useEffect } from 'react';
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
import { TeamPage } from './pages/TeamPage';
import { ProfilePage } from './pages/ProfilePage';
import { PrivacyPage, TermsPage } from './pages/LegalPages';

export function App() {
  const me = useMe();
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
      <div className="shell">
        <header className="topbar">
          <span className="brand">{me.data.organization.name}</span>
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
  // Managers and permanent members see the whole organisation; guests see only their own tasks.
  const seesAll = isManager || me.data.access === 'member';
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">{me.data.organization.name}</span>
        <nav className="nav">
          <NavLink to="/home">בית</NavLink>
          <NavLink to="/my">המשימות שלי</NavLink>
          {seesAll && <NavLink to="/all">כל המשימות</NavLink>}
          {seesAll && <NavLink to="/team">צוות</NavLink>}
          {isManager && <NavLink to="/recurring">משימות חוזרות</NavLink>}
          {isManager && <NavLink to="/documents">מסמכים</NavLink>}
          <NavLink to="/chat">צ'אט</NavLink>
        </nav>
        <Bell />
        <UserMenu name={me.data.displayName} personId={me.data.personId} isManager={isManager} />
      </header>
      <main className="content">
        <Routes>
          <Route path="/home" element={<HomePage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/people/:id" element={<ProfilePage />} />
          <Route path="/my" element={<TasksPage scope="mine" />} />
          {seesAll && <Route path="/all" element={<TasksPage scope="all" />} />}
          {seesAll && <Route path="/tasks/new" element={<NewTaskPage />} />}
          {seesAll && <Route path="/team" element={<TeamPage />} />}
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

/** Unread notifications; opens the home page where they are listed. */
function Bell() {
  const inbox = useInbox();
  const unread = inbox.data?.unread ?? 0;
  return (
    <Link to="/home" className="bell" aria-label={unread ? `${unread} התראות חדשות` : 'התראות'} title="התראות">
      🔔{unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
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
        <Avatar personId={personId} name={name} size={26} />
        {name}
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
