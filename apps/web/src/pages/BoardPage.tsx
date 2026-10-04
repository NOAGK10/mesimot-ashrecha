import { Link } from 'react-router';
import { OPEN_STATUSES } from '@org/shared';
import { useMe, usePeople, useTasks } from '../api';
import { Avatar } from '../components/Avatar';
import { formatDate } from '../he';

/**
 * Responsibility board: one card per person with what they are responsible for and their open tasks.
 * Only tasks the viewer may see are listed (private tasks of others stay hidden, except for managers).
 */
export function BoardPage() {
  const me = useMe();
  const people = usePeople();
  const tasks = useTasks({ view: 'all', mine: false });
  const open = (tasks.data ?? []).filter((t) => OPEN_STATUSES.includes(t.status));
  const active = (people.data ?? []).filter((p) => p.active && p.role !== null);

  return (
    <section>
      <div className="page-head">
        <h1>לוח אחראים</h1>
        {me.data?.access === 'manager' && (
          <Link className="button secondary-link" to="/people">
            ניהול אנשים
          </Link>
        )}
      </div>
      <p className="muted small">מי אחראי על מה. לחיצה על שם פותחת את הפרופיל.</p>
      <div className="board">
        {active.map((p) => {
          const theirs = open
            .filter((t) => t.ownerPersonId === p.id)
            .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
          return (
            <article key={p.id} className="card board-card">
              <Link to={`/people/${p.id}`} className="board-person">
                <Avatar personId={p.id} name={p.displayName} size={44} />
                <span>
                  <strong>{p.displayName}</strong>
                  {p.jobTitle && <span className="job-tag">{p.jobTitle}</span>}
                </span>
              </Link>
              <div className="board-resp">
                <span className="muted small">אחראי על</span>
                <p className="pre">{p.responsibilities || <span className="muted">עוד לא נכתב</span>}</p>
              </div>
              <div>
                <span className="muted small">משימות פתוחות ({theirs.length})</span>
                {theirs.length === 0 ? (
                  <p className="muted small">אין משימות פתוחות</p>
                ) : (
                  <ul className="board-tasks">
                    {theirs.slice(0, 6).map((t) => (
                      <li key={t.id}>
                        <Link to={`/tasks/${t.id}`}>{t.title}</Link>
                        {t.dueDate && <span className={t.isOverdue ? 'overdue small' : 'muted small'}> · {formatDate(t.dueDate)}</span>}
                      </li>
                    ))}
                    {theirs.length > 6 && (
                      <li>
                        <Link to={`/people/${p.id}`} className="small">
                          ועוד {theirs.length - 6}…
                        </Link>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
