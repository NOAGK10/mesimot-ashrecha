import { Link, useParams } from 'react-router';
import { OPEN_STATUSES } from '@org/shared';
import { useMe, usePeople, useTasks } from '../api';
import { TasksPage } from './TasksPage';

/** Everyone in the organisation with their tag and workload; each card opens the person's page. */
export function TeamPage() {
  const me = useMe();
  const people = usePeople();
  const tasks = useTasks({ view: 'all', mine: false });
  const open = (tasks.data ?? []).filter((t) => OPEN_STATUSES.includes(t.status));
  const count = (id: string) => {
    const mine = open.filter((t) => t.ownerPersonId === id || t.participantIds.includes(id));
    return { open: mine.length, overdue: mine.filter((t) => t.isOverdue).length };
  };
  const active = (people.data ?? []).filter((p) => p.active);

  return (
    <section>
      <div className="page-head">
        <h1>צוות</h1>
        {me.data?.access === 'manager' && (
          <Link className="button secondary-link" to="/people">
            ניהול אנשים ותגיות
          </Link>
        )}
      </div>
      <div className="team-grid">
        {active.map((p) => {
          const c = count(p.id);
          return (
            <Link key={p.id} to={`/people/${p.id}`} className="card team-card">
              <strong>{p.displayName}</strong>
              {p.jobTitle ? <span className="job-tag">{p.jobTitle}</span> : <span className="muted small">בלי תגית</span>}
              <span className="small muted">
                {c.open === 0 ? 'אין משימות פתוחות' : c.open === 1 ? 'משימה פתוחה אחת' : `${c.open} משימות פתוחות`}
                {c.overdue > 0 && <span className="overdue"> · {c.overdue} באיחור</span>}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function PersonPage() {
  const { id = '' } = useParams();
  return <TasksPage key={id} scope="person" personId={id} />;
}
