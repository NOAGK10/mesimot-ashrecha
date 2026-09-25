import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { TaskDto } from '@org/shared';
import { api, useApiMutation, useMe } from '../api';
import { ErrorText, PeopleChecklist, PersonSelect, usePeopleMap } from '../components/common';

export function NewTaskPage() {
  const me = useMe();
  const isManager = me.data?.access === 'manager';
  const people = usePeopleMap();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [owner, setOwner] = useState(me.data?.personId ?? '');
  const [dueDate, setDueDate] = useState('');
  const [participants, setParticipants] = useState<string[]>([]);

  const create = useApiMutation((body: unknown) => api<TaskDto>('POST', '/api/tasks', body));

  return (
    <section className="card">
      <h1>משימה חדשה</h1>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { title, description, ownerPersonId: owner, dueDate: dueDate || null, participantIds: participants.filter((p) => p !== owner) },
            { onSuccess: (t) => navigate(`/tasks/${t.id}`) },
          );
        }}
      >
        <label>
          מה צריך לעשות?
          <input required maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <label>
          פרטים
          <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="row">
          <label>
            אחראי
            {isManager ? (
              <PersonSelect people={people.list} value={owner} onChange={setOwner} required />
            ) : (
              // Permanent members create tasks only for themselves.
              <input value={me.data?.displayName ?? ''} disabled />
            )}
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
