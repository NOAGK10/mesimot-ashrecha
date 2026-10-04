import { Link } from 'react-router';
import { useMe, usePeople } from '../api';
import { Avatar } from '../components/Avatar';

/** Responsibility board: one small card per person – picture, name and tag. Clicking opens the profile. */
export function BoardPage() {
  const me = useMe();
  const people = usePeople();
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
      <p className="muted small">לחיצה על אדם פותחת את הפרופיל שלו.</p>
      <div className="board">
        {active.map((p) => (
          <Link key={p.id} to={`/people/${p.id}`} className="card board-card board-person">
            <Avatar personId={p.id} name={p.displayName} size={44} />
            <span>
              <strong>{p.displayName}</strong>
              {p.jobTitle && <span className="job-tag">{p.jobTitle}</span>}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
