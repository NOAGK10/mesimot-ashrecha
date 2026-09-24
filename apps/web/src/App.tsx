import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
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

export function App() {
  const me = useMe();
  const location = useLocation();

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
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">{me.data.organization.name}</span>
        <nav className="nav">
          <NavLink to="/my">המשימות שלי</NavLink>
          {isManager && <NavLink to="/all">כל המשימות</NavLink>}
          {isManager && <NavLink to="/recurring">משימות חוזרות</NavLink>}
          {isManager && <NavLink to="/documents">מסמכים</NavLink>}
          {isManager && <NavLink to="/people">אנשים</NavLink>}
          {isManager && <NavLink to="/ops">מצב המערכת</NavLink>}
        </nav>
        <UserMenu name={me.data.displayName} />
      </header>
      <main className="content">
        <Routes>
          <Route path="/my" element={<TasksPage scope="mine" />} />
          {isManager && <Route path="/all" element={<TasksPage scope="all" />} />}
          {isManager && <Route path="/tasks/new" element={<NewTaskPage />} />}
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
          {isManager && <Route path="/recurring" element={<RecurrencesPage />} />}
          {isManager && <Route path="/documents" element={<DocumentsPage />} />}
          {isManager && <Route path="/import" element={<ImportPage />} />}
          {isManager && <Route path="/people" element={<PeoplePage />} />}
          {isManager && <Route path="/ops" element={<OpsPage />} />}
          <Route path="*" element={<Navigate to="/my" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function UserMenu({ name }: { name: string }) {
  const qc = useQueryClient();
  const logout = async () => {
    await api('POST', '/api/auth/logout');
    qc.clear();
    window.location.href = '/';
  };
  return (
    <div className="user">
      <span className="small">{name}</span>
      <button className="link" onClick={logout}>
        יציאה
      </button>
    </div>
  );
}

function LinkExpired() {
  return (
    <div className="center card narrow">
      <h1>הקישור אינו בתוקף</h1>
      <p className="muted">ייתכן שפג תוקפו או שהמשימה כבר אינה משויכת אליך. אפשר לפנות למנהל/ת הארגון לקבלת קישור חדש.</p>
    </div>
  );
}
