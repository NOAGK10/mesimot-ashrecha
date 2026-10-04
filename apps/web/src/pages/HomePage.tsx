import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InboxItemDto, MessageDto } from '@org/shared';
import { api, useMe, useTasks } from '../api';
import { PersonTag, StatusBadge, usePeopleMap } from '../components/common';
import { formatDate, formatDateTime } from '../he';

/** Each person's home page: what needs their attention now. */
export function HomePage() {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const people = usePeopleMap();
  const inbox = useInbox();
  const overdue = useTasks({ view: 'overdue', mine: true });
  const today = useTasks({ view: 'today', mine: true });
  const recentChat = useQuery({
    queryKey: ['recent-chat'],
    queryFn: () => api<MessageDto[]>('GET', '/api/chat/messages?limit=5'),
    refetchInterval: 30_000,
  });

  const items = inbox.data?.items ?? [];
  const mentions = items.filter((i) => i.kind === 'mention' || i.kind === 'feedback').slice(0, 15);
  const assigned = items.filter((i) => i.kind === 'task_assigned').slice(0, 10);
  const actor = (id: string | null) => (id ? people.name(id) : 'המערכת');

  const open = async (i: InboxItemDto) => {
    if (!i.read) {
      await api('POST', '/api/inbox/read', { ids: [i.id] });
      void qc.invalidateQueries({ queryKey: ['inbox'] });
    }
    if (i.kind === 'feedback') navigate(`/people/${me.data?.personId}#feedback`);
    else if (i.kind === 'mention') navigate(i.taskId ? `/tasks/${i.taskId}#m${i.messageId}` : `/chat#m${i.messageId}`);
    else navigate(`/tasks/${i.taskId}`);
  };
  const readAll = async () => {
    await api('POST', '/api/inbox/read', { all: true });
    void qc.invalidateQueries({ queryKey: ['inbox'] });
  };

  const urgent = [...(overdue.data ?? []), ...(today.data ?? [])];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'בוקר טוב' : hour < 17 ? 'צהריים טובים' : 'ערב טוב';

  return (
    <section className="home">
      <div className="page-head">
        <h1>
          {greeting}, {me.data?.displayName}
        </h1>
        {(inbox.data?.unread ?? 0) > 0 && (
          <button className="secondary small-btn" onClick={readAll}>
            סימון הכל כנקרא
          </button>
        )}
      </div>

      <div className="home-grid">
        <div className="card">
          <h2>תיוגים ופידבקים {countBadge(mentions)}</h2>
          {mentions.length === 0 && <p className="muted small">אין עדיין תיוגים או פידבקים.</p>}
          <ul className="inbox-list">
            {mentions.map((i) => (
              <li key={i.id} className={i.read ? 'read' : 'unread'}>
                <button className="inbox-item" onClick={() => open(i)}>
                  <span>
                    <strong>{actor(i.actorPersonId)}</strong>{' '}
                    {i.kind === 'feedback' ? 'כתב לך פידבק' : <>תייג אותך {i.taskTitle ? <>במשימה „{i.taskTitle}”</> : 'בצ\'אט הכללי'}</>}
                  </span>
                  {i.excerpt && <span className="inbox-excerpt">{i.excerpt}</span>}
                  <span className="muted small">{formatDateTime(i.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h2>
            דורש טיפול היום <span className="muted small">({urgent.length})</span>
          </h2>
          {urgent.length === 0 && <p className="muted small">אין משימות באיחור או להיום. 🎉</p>}
          <ul className="inbox-list">
            {urgent.map((t) => (
              <li key={t.id}>
                <Link to={`/tasks/${t.id}`} className="inbox-item">
                  <span>
                    <strong>{t.title}</strong>
                  </span>
                  <span className="small">
                    <StatusBadge status={t.status} />{' '}
                    <span className={t.isOverdue ? 'overdue' : 'muted'}>{t.isOverdue ? `באיחור · ${formatDate(t.dueDate)}` : 'להיום'}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/my" className="small">
            לכל המשימות שלי ←
          </Link>
        </div>

        <div className="card">
          <h2>שובצו אליך {countBadge(assigned)}</h2>
          {assigned.length === 0 && <p className="muted small">אין שיבוצים חדשים.</p>}
          <ul className="inbox-list">
            {assigned.map((i) => (
              <li key={i.id} className={i.read ? 'read' : 'unread'}>
                <button className="inbox-item" onClick={() => open(i)}>
                  <span>
                    <strong>{i.taskTitle ?? 'משימה'}</strong>
                    {i.taskDueDate && <span className="muted small"> · יעד {formatDate(i.taskDueDate)}</span>}
                  </span>
                  <span className="muted small">
                    {actor(i.actorPersonId)} · {formatDateTime(i.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h2>בצ'אט</h2>
          {recentChat.data?.length === 0 && <p className="muted small">עוד אין הודעות.</p>}
          <ul className="inbox-list">
            {recentChat.data
              ?.filter((m) => !m.deleted)
              .reverse()
              .map((m) => (
                <li key={m.id}>
                  <Link to={`/chat#m${m.id}`} className="inbox-item">
                    <PersonTag avatarFor={m.authorPersonId} name={people.name(m.authorPersonId)} jobTitle={people.jobTitle(m.authorPersonId)} />
                    <span className="inbox-excerpt">{m.body.length > 120 ? `${m.body.slice(0, 120)}…` : m.body}</span>
                  </Link>
                </li>
              ))}
          </ul>
          <Link to="/chat" className="small">
            לצ'אט ←
          </Link>
        </div>
      </div>
    </section>
  );
}

function countBadge(items: InboxItemDto[]) {
  const unread = items.filter((i) => !i.read).length;
  return unread > 0 ? <span className="count-badge">{unread} חדשים</span> : null;
}

export const useInbox = () =>
  useQuery({
    queryKey: ['inbox'],
    queryFn: () => api<{ unread: number; items: InboxItemDto[] }>('GET', '/api/inbox'),
    refetchInterval: 30_000,
  });
