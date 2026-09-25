import { useState } from 'react';
import type { RecurrenceDto } from '@org/shared';
import { api, useApiMutation, useMe, useRecurrences } from '../api';
import { ErrorText, PeopleChecklist, PersonSelect, usePeopleMap } from '../components/common';
import { WEEKDAYS, formatDate } from '../he';

const KEYS = [['recurrences'], ['tasks']];
const STATE_LABEL = { active: 'פעילה', paused: 'מושהית', ended: 'הופסקה' } as const;
const FREQ_UNIT = { daily: 'ימים', weekly: 'שבועות', monthly: 'חודשים' } as const;
const ONE_UNIT = { daily: 'יום', weekly: 'שבוע', monthly: 'חודש' } as const;

function describe(r: RecurrenceDto): string {
  const every = r.interval === 1 ? { daily: 'כל יום', weekly: 'כל שבוע', monthly: 'כל חודש' }[r.freq] : `כל ${r.interval} ${FREQ_UNIT[r.freq]}`;
  if (r.mode === 'after_completion') {
    const gap = r.interval === 1 ? ONE_UNIT[r.freq] : `${r.interval} ${FREQ_UNIT[r.freq]}`;
    return `${gap} אחרי שהפעם הקודמת הושלמה`;
  }
  if (r.freq === 'weekly' && r.byWeekday.length) {
    const days = r.byWeekday.map((d) => WEEKDAYS[d]);
    return `${every} ${days.length === 1 ? 'ביום' : 'בימים'} ${days.join(', ')}`;
  }
  if (r.freq === 'monthly') return `${every}, ב-${r.byMonthDay ?? Number(r.startDate.slice(8))} לחודש`;
  return every;
}

export function RecurrencesPage() {
  const list = useRecurrences();
  const people = usePeopleMap();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const act = useApiMutation(({ r, action }: { r: RecurrenceDto; action: 'pause' | 'resume' | 'end' }) =>
    api('POST', `/api/recurrences/${r.id}/${action}`, { version: r.version }), KEYS);

  return (
    <section>
      <div className="page-head">
        <h1>משימות חוזרות</h1>
        {!creating && <button onClick={() => setCreating(true)}>+ משימה חוזרת חדשה</button>}
      </div>
      <p className="muted small">
        משימה חוזרת יוצרת לבד משימה חדשה כל פעם (למשל כל יום ראשון), והיא מופיעה ברשימות כמו כל משימה. שינוי כאן משפיע רק על הפעמים הבאות.
      </p>
      {creating && <CreateRecurrence onDone={() => setCreating(false)} />}
      {list.data?.length === 0 && <p className="empty">אין משימות חוזרות.</p>}
      <div className="cards">
        {list.data?.map((r) => (
          <div key={r.id} className={`card recurrence state-${r.state}`}>
            <div className="page-head">
              <h2>{r.title}</h2>
              <span className="badge">{STATE_LABEL[r.state]}</span>
            </div>
            <p>{describe(r)}</p>
            <p className="muted small">
              אחראי: {people.name(r.ownerPersonId)} · החל מ-{formatDate(r.startDate)}
              {r.endDate && ` · עד ${formatDate(r.endDate)}`}
              {r.nextOccurrenceDate && ` · הפעם הבאה: ${formatDate(r.nextOccurrenceDate)}`}
            </p>
            {editing === r.id && <EditRecurrence r={r} onDone={() => setEditing(null)} />}
            <div className="actions">
              {r.state !== 'ended' && editing !== r.id && (
                <button className="secondary" onClick={() => setEditing(r.id)}>
                  עריכה
                </button>
              )}
              {r.state === 'active' && <button className="secondary" onClick={() => act.mutate({ r, action: 'pause' })}>השהיה</button>}
              {r.state === 'paused' && <button className="secondary" onClick={() => act.mutate({ r, action: 'resume' })}>חידוש</button>}
              {r.state !== 'ended' && (
                <button className="secondary danger" onClick={() => confirm('להפסיק את המשימה החוזרת? משימות שכבר נוצרו יישארו.') && act.mutate({ r, action: 'end' })}>
                  הפסקה
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <ErrorText error={act.error} />
    </section>
  );
}

function CreateRecurrence({ onDone }: { onDone: () => void }) {
  const me = useMe();
  const people = usePeopleMap();
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState(me.data?.personId ?? '');
  const [participants, setParticipants] = useState<string[]>([]);
  const [mode, setMode] = useState<'schedule' | 'after_completion'>('schedule');
  const [freq, setFreq] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [interval, setInterval] = useState(1);
  const [weekdays, setWeekdays] = useState<number[]>([0]);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');

  const create = useApiMutation(
    () =>
      api('POST', '/api/recurrences', {
        title,
        ownerPersonId: owner,
        participantIds: participants,
        mode,
        freq,
        interval,
        byWeekday: mode === 'schedule' && freq === 'weekly' ? weekdays : [],
        startDate,
        endDate: endDate || null,
      }),
    KEYS,
  );

  return (
    <form className="card stack" onSubmit={(e) => (e.preventDefault(), create.mutate(undefined, { onSuccess: onDone }))}>
      <h2>משימה חוזרת חדשה</h2>
      <label>
        כותרת
        <input required value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <fieldset>
        <legend>סוג החזרתיות</legend>
        <label className="check">
          <input type="radio" checked={mode === 'schedule'} onChange={() => setMode('schedule')} />
          לפי לוח זמנים קבוע (למשל כל יום ראשון): המשימה נוצרת בזמנה, גם אם הקודמת עוד לא הושלמה
        </label>
        <label className="check">
          <input type="radio" checked={mode === 'after_completion'} onChange={() => setMode('after_completion')} />
          אחרי השלמה: הפעם הבאה נקבעת לפי היום שבו הקודמת הושלמה
        </label>
      </fieldset>
      <div className="row">
        <label>
          כל
          <input type="number" min={1} max={365} value={interval} onChange={(e) => setInterval(Number(e.target.value))} />
        </label>
        <label>
          יחידה
          <select value={freq} onChange={(e) => setFreq(e.target.value as typeof freq)}>
            <option value="daily">ימים</option>
            <option value="weekly">שבועות</option>
            <option value="monthly">חודשים</option>
          </select>
        </label>
      </div>
      {mode === 'schedule' && freq === 'weekly' && (
        <fieldset>
          <legend>בימים</legend>
          <div className="checklist">
            {WEEKDAYS.map((d, i) => (
              <label key={i} className="check">
                <input
                  type="checkbox"
                  checked={weekdays.includes(i)}
                  onChange={(e) => setWeekdays(e.target.checked ? [...weekdays, i].sort() : weekdays.filter((x) => x !== i))}
                />
                {d}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="row">
        <label>
          {mode === 'schedule' ? 'תאריך התחלה' : 'יעד לפעם הראשונה'}
          <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label>
          תאריך סיום (לא חובה)
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>
      <label>
        אחראי
        <PersonSelect people={people.list} value={owner} onChange={setOwner} required />
      </label>
      <fieldset>
        <legend>משתתפים</legend>
        <PeopleChecklist people={people.list} selected={participants} exclude={owner} onChange={setParticipants} />
      </fieldset>
      <ErrorText error={create.error} />
      <div className="actions">
        <button type="submit" disabled={create.isPending}>יצירה</button>
        <button type="button" className="secondary" onClick={onDone}>ביטול</button>
      </div>
    </form>
  );
}

/** Edits what does not change the schedule itself; changes apply to the next times only. */
function EditRecurrence({ r, onDone }: { r: RecurrenceDto; onDone: () => void }) {
  const people = usePeopleMap();
  const [title, setTitle] = useState(r.title);
  const [description, setDescription] = useState(r.description);
  const [owner, setOwner] = useState(r.ownerPersonId);
  const [participants, setParticipants] = useState(r.participantIds);
  const [endDate, setEndDate] = useState(r.endDate ?? '');
  const save = useApiMutation(async () => {
    await api('PATCH', `/api/recurrences/${r.id}`, {
      version: r.version,
      title,
      description,
      ownerPersonId: owner,
      participantIds: participants.filter((p) => p !== owner),
      endDate: endDate || null,
    });
    onDone();
  }, KEYS);

  return (
    <form className="stack edit-inline" onSubmit={(e) => (e.preventDefault(), save.mutate(undefined))}>
      <label>
        שם
        <input required value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        פרטים
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="row">
        <label>
          אחראי
          <PersonSelect people={people.list} value={owner} onChange={setOwner} required />
        </label>
        <label>
          עד תאריך (לא חובה)
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>
      <fieldset>
        <legend>משתתפים</legend>
        <PeopleChecklist people={people.list} selected={participants} exclude={owner} onChange={setParticipants} />
      </fieldset>
      <p className="muted small">השינוי יחול על הפעמים הבאות. משימות שכבר נוצרו לא ישתנו.</p>
      <ErrorText error={save.error} />
      <div className="actions">
        <button type="submit" disabled={save.isPending}>
          שמירה
        </button>
        <button type="button" className="secondary" onClick={onDone}>
          ביטול
        </button>
      </div>
    </form>
  );
}
