import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { TaskDetailDto } from '@org/shared';
import { api, useApiMutation, useDocuments, useMe, useTask } from '../api';
import { AddDocument, KIND_ICON, KIND_LABEL } from '../components/AddDocument';
import { ErrorText, PeopleChecklist, PersonSelect, PersonTag, StatusBadge, usePeopleMap } from '../components/common';
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
  const statusNote = latestStatusNote(t);
  // Personal pages exist for managers and permanent members only.
  const linkPeople = me.data?.access === 'manager' || me.data?.access === 'member';

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
          <dt>אחראי</dt>
          <dd>
            <PersonTag id={linkPeople ? t.ownerPersonId : undefined} name={name(t.ownerPersonId)} jobTitle={t.jobTitles[t.ownerPersonId]} />
          </dd>
          <dt>מועד יעד</dt>
          <dd className={t.isOverdue ? 'overdue' : ''}>
            {formatDate(t.dueDate)}
            {t.isOverdue && ' · באיחור'}
          </dd>
          <dt>משתתפים</dt>
          <dd className="people-list">
            {t.participantIds.length
              ? t.participantIds.map((pid) => <PersonTag key={pid} id={linkPeople ? pid : undefined} name={name(pid)} jobTitle={t.jobTitles[pid]} />)
              : '—'}
          </dd>
          {t.recurrenceDefinitionId && (
            <>
              <dt>חזרתיות</dt>
              <dd>מופע של משימה חוזרת ({formatDate(t.occurrenceDate)})</dd>
            </>
          )}
        </dl>
        {t.description && <p className="description">{t.description}</p>}
        {statusNote && (
          <p className={`status-note status-${t.status}`}>
            <strong>{STATUS_LABEL[t.status]}:</strong> {statusNote.note}
            <span className="muted small"> · {formatDateTime(statusNote.at)}</span>
          </p>
        )}
        <StatusActions task={t} />
      </div>

      <TaskDocuments task={t} />
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
  if (type === 'task.status_changed')
    return (
      <>
        {' '}({STATUS_LABEL[d.from as keyof typeof STATUS_LABEL]} ← {STATUS_LABEL[d.to as keyof typeof STATUS_LABEL]})
        {d.note && <div className="history-note">„{d.note as string}”</div>}
      </>
    );
  if (type === 'task.owner_changed') return <> ({name(d.from as string)} ← {name(d.to as string)})</>;
  if (type === 'task.due_date_changed') return <> ({formatDate(d.from as string | null)} ← {formatDate(d.to as string | null)})</>;
  return null;
}

function TaskDocuments({ task }: { task: TaskDetailDto }) {
  const [adding, setAdding] = useState(false);
  const library = useDocuments(false, task.canEdit && adding);
  const [existing, setExisting] = useState('');
  const detach = useApiMutation((documentId: string) => api('DELETE', `/api/tasks/${task.id}/documents/${documentId}`), [['task'], ['documents']]);
  const attach = useApiMutation((documentId: string) => api('POST', `/api/tasks/${task.id}/documents`, { documentId }), [['task'], ['documents']]);
  if (!task.canEdit && task.documents.length === 0) return null;
  const attachable = (library.data ?? []).filter((d) => !task.documents.some((x) => x.id === d.id));

  return (
    <div className="card">
      <h2>מסמכים</h2>
      {task.documents.length === 0 && <p className="muted small">אין מסמכים מקושרים.</p>}
      <ul className="doc-list">
        {task.documents.map((d) => (
          <li key={d.id}>
            <div className="doc-main">
              <span aria-hidden>{KIND_ICON[d.kind]}</span>
              <a href={d.url} target="_blank" rel="noreferrer">
                {d.title}
              </a>
              <span className="tag">{KIND_LABEL[d.kind]}</span>
            </div>
            {task.canEdit && !task.archivedAt && (
              <button className="link" onClick={() => detach.mutate(d.id)}>
                הסרה מהמשימה
              </button>
            )}
          </li>
        ))}
      </ul>
      {task.canEdit && !task.archivedAt && (
        <>
          {!adding ? (
            <button className="secondary" onClick={() => setAdding(true)}>
              + קישור מסמך
            </button>
          ) : (
            <div className="stack">
              {attachable.length > 0 && (
                <div className="row-inline">
                  <select value={existing} onChange={(e) => setExisting(e.target.value)} aria-label="מסמך קיים">
                    <option value="">מסמך שכבר קיים במערכת…</option>
                    {attachable.map((d) => (
                      <option key={d.id} value={d.id}>
                        {KIND_ICON[d.kind]} {d.title}
                      </option>
                    ))}
                  </select>
                  <button disabled={!existing} onClick={() => attach.mutate(existing, { onSuccess: () => (setExisting(''), setAdding(false)) })}>
                    קישור
                  </button>
                </div>
              )}
              <AddDocument taskId={task.id} onDone={() => setAdding(false)} />
              <button className="link" onClick={() => setAdding(false)}>
                סגירה
              </button>
            </div>
          )}
        </>
      )}
      <ErrorText error={detach.error ?? attach.error} />
    </div>
  );
}

/** Status buttons with an optional note that is saved with the change (e.g. why the task is stuck). */
function StatusActions({ task }: { task: TaskDetailDto }) {
  const [note, setNote] = useState('');
  const change = useApiMutation((status: string) =>
    api('POST', `/api/tasks/${task.id}/status`, { version: task.version, status, ...(note.trim() ? { note: note.trim() } : {}) }),
  );
  if (task.allowedStatuses.length === 0) return null;
  return (
    <div className="status-box">
      <label>
        הערה לעדכון (לא חובה)
        <textarea
          rows={2}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="למשל: למה זה תקוע, על מה מחכים, מה נעשה"
        />
      </label>
      <div className="actions">
        {task.allowedStatuses.map((s) => (
          <button
            key={s}
            className={s === 'completed' ? '' : s === 'blocked' ? 'secondary warn' : 'secondary'}
            disabled={change.isPending}
            onClick={() => change.mutate(s, { onSuccess: () => setNote('') })}
          >
            {transitionLabel(task.status, s)}
          </button>
        ))}
      </div>
      <ErrorText error={change.error} />
    </div>
  );
}

/** The note written with the most recent status change, if the task is still in that status. */
function latestStatusNote(task: TaskDetailDto): { note: string; at: string } | null {
  const last = [...task.events].reverse().find((e) => e.type === 'task.status_changed');
  const note = last?.data.note;
  return last && typeof note === 'string' && last.data.to === task.status ? { note, at: last.createdAt } : null;
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
          אחראי
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
