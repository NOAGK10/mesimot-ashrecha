import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { TaskDetailDto } from '@org/shared';
import { api, useApiMutation, useMe, useTask } from '../api';
import { ErrorText, PeopleChecklist, PersonSelect, StatusBadge, usePeopleMap } from '../components/common';
import { EVENT_LABEL, STATUS_LABEL, formatDate, formatDateTime, transitionLabel } from '../he';

export function TaskDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const task = useTask(id);
  const people = usePeopleMap(me.data?.access !== 'link');

  if (task.isLoading) return <p className="muted">טוען…</p>;
  if (task.error || !task.data) return <ErrorText error={task.error ?? new Error()} />;
  const t = task.data;
  const name = (pid: string | null) => (pid ? (t.names[pid] ?? people.name(pid)) : 'המערכת');

  return (
    <section className="detail">
      {me.data?.access !== 'link' && (
        <button className="link back" onClick={() => navigate(-1)}>
          → חזרה
        </button>
      )}
      <div className="card">
        <div className="page-head">
          <h1>{t.title}</h1>
          <StatusBadge status={t.status} />
        </div>
        {t.archivedAt && <p className="notice">המשימה בארכיון ואינה ניתנת לעריכה.</p>}
        <dl className="facts">
          <dt>אחראי/ת</dt>
          <dd>{name(t.ownerPersonId)}</dd>
          <dt>מועד יעד</dt>
          <dd className={t.isOverdue ? 'overdue' : ''}>
            {formatDate(t.dueDate)}
            {t.isOverdue && ' · באיחור'}
          </dd>
          <dt>משתתפים</dt>
          <dd>{t.participantIds.length ? t.participantIds.map(name).join(', ') : '—'}</dd>
          {t.recurrenceDefinitionId && (
            <>
              <dt>חזרתיות</dt>
              <dd>מופע של משימה חוזרת ({formatDate(t.occurrenceDate)})</dd>
            </>
          )}
        </dl>
        {t.description && <p className="description">{t.description}</p>}
        <StatusActions task={t} />
      </div>

      {t.canEdit && !t.archivedAt && <EditTask key={t.version} task={t} />}
      {t.canEdit && <ManagerTools task={t} name={name} />}

      <div className="card">
        <h2>היסטוריה</h2>
        <ol className="history">
          {t.events.map((e) => (
            <li key={e.id}>
              <span className="muted small">{formatDateTime(e.createdAt)}</span> · <strong>{name(e.actorPersonId)}</strong> ·{' '}
              {EVENT_LABEL[e.type] ?? e.type}
              <EventDetail type={e.type} data={e.data} name={name} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function EventDetail({ type, data, name }: { type: string; data: Record<string, unknown>; name: (id: string | null) => string }) {
  const d = data as Record<string, string | null | string[]>;
  if (type === 'task.status_changed') return <> ({STATUS_LABEL[d.from as keyof typeof STATUS_LABEL]} ← {STATUS_LABEL[d.to as keyof typeof STATUS_LABEL]})</>;
  if (type === 'task.owner_changed') return <> ({name(d.from as string)} ← {name(d.to as string)})</>;
  if (type === 'task.due_date_changed') return <> ({formatDate(d.from as string | null)} ← {formatDate(d.to as string | null)})</>;
  return null;
}

function StatusActions({ task }: { task: TaskDetailDto }) {
  const change = useApiMutation((status: string) => api('POST', `/api/tasks/${task.id}/status`, { version: task.version, status }));
  if (task.allowedStatuses.length === 0) return null;
  return (
    <div className="actions">
      {task.allowedStatuses.map((s) => (
        <button key={s} className={s === 'completed' ? '' : 'secondary'} disabled={change.isPending} onClick={() => change.mutate(s)}>
          {transitionLabel(task.status, s)}
        </button>
      ))}
      <ErrorText error={change.error} />
    </div>
  );
}

function EditTask({ task }: { task: TaskDetailDto }) {
  const people = usePeopleMap();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [owner, setOwner] = useState(task.ownerPersonId);
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');
  const [participants, setParticipants] = useState(task.participantIds);
  const [open, setOpen] = useState(false);
  useEffect(() => setParticipants(task.participantIds), [task.participantIds]);

  const save = useApiMutation(async () => {
    const updated = await api<{ version: number }>('PATCH', `/api/tasks/${task.id}`, {
      version: task.version,
      title,
      description,
      ownerPersonId: owner,
      dueDate: dueDate || null,
    });
    const next = participants.filter((p) => p !== owner);
    const same = next.length === task.participantIds.length && next.every((p) => task.participantIds.includes(p));
    if (!same) await api('PUT', `/api/tasks/${task.id}/participants`, { version: updated.version, participantIds: next });
  });

  if (!open)
    return (
      <div className="actions">
        <button className="secondary" onClick={() => setOpen(true)}>
          עריכת פרטים
        </button>
      </div>
    );
  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined, { onSuccess: () => setOpen(false) });
      }}
    >
      <h2>עריכה</h2>
      <label>
        כותרת
        <input required value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        פרטים
        <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="row">
        <label>
          אחראי/ת
          <PersonSelect people={people.list} value={owner} onChange={setOwner} required />
        </label>
        <label>
          מועד יעד
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
      </div>
      <fieldset>
        <legend>משתתפים</legend>
        <PeopleChecklist people={people.list} selected={participants} exclude={owner} onChange={setParticipants} />
      </fieldset>
      <ErrorText error={save.error} />
      <div className="actions">
        <button type="submit" disabled={save.isPending}>
          שמירה
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)}>
          ביטול
        </button>
      </div>
    </form>
  );
}

function ManagerTools({ task, name }: { task: TaskDetailDto; name: (id: string) => string }) {
  const archive = useApiMutation(() => api('POST', `/api/tasks/${task.id}/${task.archivedAt ? 'unarchive' : 'archive'}`, { version: task.version }));
  const [link, setLink] = useState<string | null>(null);
  const issue = useApiMutation(async (personId: string) => {
    const r = await api<{ url: string }>('POST', `/api/tasks/${task.id}/links`, { personId });
    setLink(r.url);
  });
  const involved = [task.ownerPersonId, ...task.participantIds];

  return (
    <div className="card">
      <h2>כלי ניהול</h2>
      <div className="actions">
        <button className="secondary" onClick={() => archive.mutate()} disabled={archive.isPending}>
          {task.archivedAt ? 'החזרה מהארכיון' : 'העברה לארכיון'}
        </button>
      </div>
      {!task.archivedAt && (
        <>
          <p className="muted small">קישור גישה למשימה הזו בלבד, לשליחה ידנית (למשל בווטסאפ):</p>
          <div className="actions">
            {involved.map((pid) => (
              <button key={pid} className="secondary" onClick={() => issue.mutate(pid)} disabled={issue.isPending}>
                קישור עבור {name(pid)}
              </button>
            ))}
          </div>
          {link && (
            <p className="linkbox" dir="ltr">
              <input readOnly value={link} onFocus={(e) => e.target.select()} />
            </p>
          )}
        </>
      )}
      <ErrorText error={archive.error ?? issue.error} />
    </div>
  );
}
