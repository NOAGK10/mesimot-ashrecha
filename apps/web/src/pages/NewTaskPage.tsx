import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { TaskDto, TaskVisibility } from '@org/shared';
import { api, useApiMutation, useMe } from '../api';
import { CategorySelect } from '../components/Category';
import { ErrorText, PeopleChecklist, PersonSelect, usePeopleMap } from '../components/common';

/** Short form first (what, when, for whom); details and category only when needed. */
export function NewTaskPage() {
  const me = useMe();
  const isManager = me.data?.access === 'manager';
  const people = usePeopleMap();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [visibility, setVisibility] = useState<TaskVisibility>('org');
  const [owner, setOwner] = useState(me.data?.personId ?? '');
  const [participants, setParticipants] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);

  const create = useApiMutation((body: unknown) => api<TaskDto>('POST', '/api/tasks', body));
  const loginPeople = people.list.filter((p) => p.role !== null);

  return (
    <section className="card narrow-form">
      <h1>משימה חדשה</h1>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { title, description, ownerPersonId: owner, dueDate: dueDate || null, participantIds: participants.filter((p) => p !== owner), categoryId, visibility },
            { onSuccess: (t) => navigate(`/tasks/${t.id}`) },
          );
        }}
      >
        <label>
          מה צריך לעשות?
          <input required maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>

        <fieldset className="visibility-choice">
          <legend>מי רואה את המשימה?</legend>
          <label className={`choice${visibility === 'org' ? ' selected' : ''}`}>
            <input type="radio" name="visibility" checked={visibility === 'org'} onChange={() => setVisibility('org')} />
            <span>
              <strong>🏢 משימה לארגון</strong>
              <span className="muted small">כל מי שנכנס לאתר רואה אותה</span>
            </span>
          </label>
          <label className={`choice${visibility === 'private' ? ' selected' : ''}`}>
            <input type="radio" name="visibility" checked={visibility === 'private'} onChange={() => setVisibility('private')} />
            <span>
              <strong>🔒 פרטית</strong>
              <span className="muted small">רק אני ומי שאבחר למטה (ומנהלים)</span>
            </span>
          </label>
        </fieldset>

        <div className="row">
          {isManager ? (
            <label>
              אחראי
              <PersonSelect people={people.list} value={owner} onChange={setOwner} required />
            </label>
          ) : (
            <label>
              אחראי
              <input value={me.data?.displayName ?? ''} disabled />
            </label>
          )}
          <label>
            עד מתי
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </label>
        </div>

        <fieldset>
          <legend>{visibility === 'private' ? 'עם מי? (רק הם יראו)' : 'משתתפים (לא חובה)'}</legend>
          <PeopleChecklist people={visibility === 'private' ? loginPeople : people.list} selected={participants} exclude={owner} onChange={setParticipants} />
        </fieldset>

        <details className="more-fields">
          <summary>עוד פרטים</summary>
          <div className="stack">
            <label>
              פרטים
              <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label>
              קטגוריה
              <CategorySelect value={categoryId} onChange={setCategoryId} />
            </label>
          </div>
        </details>

        <ErrorText error={create.error} />
        <div className="actions">
          <button type="submit" disabled={create.isPending}>
            יצירה
          </button>
          <button type="button" className="secondary" onClick={() => navigate(-1)}>
            ביטול
          </button>
        </div>
      </form>
    </section>
  );
}
