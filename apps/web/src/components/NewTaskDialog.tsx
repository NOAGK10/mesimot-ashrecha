import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RECURRENCE_FREQS, TaskDto } from '@org/shared';
import { api, useMe } from '../api';
import { ErrorText, PersonSelect, usePeopleMap } from './common';
import { hebrewDay, hebrewMonthYear } from '../he';
import { MentionTextarea, useTagging } from './MentionTextarea';

type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];
const FREQ_LABEL: Record<RecurrenceFreq, string> = { daily: 'כל יום', weekly: 'כל שבוע', monthly: 'כל חודש' };

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const parseIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};

/**
 * Quick "new task" window, opened from the calendar (with the clicked day) or from the "משימה חדשה" button.
 * Title, details, date, optional time, owner, "already done" and – for managers – "repeats".
 */
export function NewTaskDialog({ date, onClose }: { date: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const me = useMe();
  const isManager = me.data?.access === 'manager';
  const people = usePeopleMap();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(date ?? '');
  const [dueTime, setDueTime] = useState('');
  const [owner, setOwner] = useState(me.data?.personId ?? '');
  const [done, setDone] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [freq, setFreq] = useState<RecurrenceFreq>('weekly');
  const tagging = useTagging();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      if (repeat) {
        const start = dueDate || todayIso();
        const day = parseIso(start);
        await api('POST', '/api/recurrences', {
          title,
          description,
          ownerPersonId: owner,
          mode: 'schedule',
          startDate: start,
          freq,
          interval: 1,
          byWeekday: freq === 'weekly' ? [day.getDay()] : [],
          byMonthDay: freq === 'monthly' ? day.getDate() : null,
        });
      } else {
        await api<TaskDto>('POST', '/api/tasks', {
          title,
          description,
          ownerPersonId: owner,
          dueDate: dueDate || null,
          dueTime: dueDate && dueTime ? dueTime : null,
          done,
          participantIds: [],
          mentionIds: tagging.idsIn(description),
        });
      }
      await Promise.all([qc.invalidateQueries({ queryKey: ['tasks'] }), qc.invalidateQueries({ queryKey: ['recurrences'] })]);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };

  return (
    <dialog
      ref={ref}
      className="task-dialog"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && (ref.current?.close(), onClose())}
      aria-labelledby="new-task-title"
    >
      <form
        method="dialog"
        className="task-dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id="new-task-title">משימה חדשה</h2>

        <label className="float-field">
          <input required maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder=" " autoFocus />
          <span>כותרת</span>
        </label>
        <MentionTextarea value={description} onChange={setDescription} onTag={tagging.onTag} floatLabel="פירוט" />

        <div className="task-dialog-row">
          <label className="float-field has-value">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            <span>{repeat ? 'מתחילה ב־' : 'תאריך יעד'}</span>
            {dueDate && <small className="hebrew-date">{`${hebrewDay(parseIso(dueDate))} ${hebrewMonthYear(parseIso(dueDate))}`}</small>}
          </label>
          {!repeat && (
            <label className="float-field has-value">
              <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} disabled={!dueDate} />
              <span>שעה (רשות)</span>
            </label>
          )}
          <label className="float-field has-value">
            {isManager ? (
              <PersonSelect people={people.list.filter((p) => p.role !== null)} value={owner} onChange={setOwner} required />
            ) : (
              <input value={me.data?.displayName ?? ''} disabled />
            )}
            <span>אחראי</span>
          </label>
        </div>

        {!repeat && (
          <label className="check-line">
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
            בוצעה
          </label>
        )}

        {isManager && (
          <div className="repeat-line">
            <label className="switch">
              <input type="checkbox" role="switch" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
              <span className="switch-track" aria-hidden="true" />
              משימה מחזורית
            </label>
            {repeat && (
              <select value={freq} onChange={(e) => setFreq(e.target.value as RecurrenceFreq)} aria-label="כל כמה זמן">
                {(Object.keys(FREQ_LABEL) as RecurrenceFreq[]).map((f) => (
                  <option key={f} value={f}>
                    {FREQ_LABEL[f]}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <ErrorText error={error} />
        <div className="task-dialog-actions">
          <button type="submit" disabled={!title.trim() || !owner || pending}>
            {pending ? 'שומר…' : 'שמירה'}
          </button>
          <button type="button" className="link" onClick={() => (ref.current?.close(), onClose())}>
            ביטול
          </button>
        </div>
      </form>
    </dialog>
  );
}
