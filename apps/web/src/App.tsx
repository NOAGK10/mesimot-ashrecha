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
import { PersonPage, TeamPage } from './pages/TeamPage';

export function App() {
  const me = useMe();
  const location = useLocation();
  const orgName = me.data?.organization.name;
  useEffect(() => {
    document.title = orgName ? `${orgName} · משימות` : 'משימות';
  }, [orgName]);

  if (location.pathname === '/link-expired') return <LinkExpired />;
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
          <NavLink to="/my">המשימות שלי</NavLink>
          {seesAll && <NavLink to="/all">כל המשימות</NavLink>}
          {seesAll && <NavLink to="/team">צוות</NavLink>}
          {isManager && <NavLink to="/recurring">משימות חוזרות</NavLink>}
          {isManager && <NavLink to="/documents">מסמכים</NavLink>}
        </nav>
        <UserMenu name={me.data.displayName} isManager={isManager} />
      </header>
      <main className="content">
        <Routes>
          <Route path="/my" element={<TasksPage scope="mine" />} />
          {seesAll && <Route path="/all" element={<TasksPage scope="all" />} />}
          {seesAll && <Route path="/tasks/new" element={<NewTaskPage />} />}
          {seesAll && <Route path="/team" element={<TeamPage />} />}
          {seesAll && <Route path="/people/:id" element={<PersonPage />} />}
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
          {isManager && <Route path="/recurring" element={<RecurrencesPage />} />}
          {isManager && <Route path="/documents" element={<DocumentsPage />} />}
          {isManager && <Route path="/import" element={<ImportPage />} />}
          {isManager && <Route path="/people" element={<PeoplePage />} />}
          {isManager && <Route path="/ops" element={<OpsPage />} />}
          {isManager && <Route path="/settings" element={<SettingsPage />} />}
          <Route path="*" element={<Navigate to="/my" replace />} />
        </Routes>
      </main>
    </div>
  );
}

/** Name menu. Managers find the technical status screen here; a red dot appears only when something is wrong. */
function UserMenu({ name, isManager }: { name: string; isManager: boolean }) {
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
        {name}
        {problem && <span className="alert-dot" title="יש תקלה במערכת" />} ▾
      </summary>
      <div className="menu">
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
