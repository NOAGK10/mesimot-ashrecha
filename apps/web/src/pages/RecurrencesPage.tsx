import { useState } from 'react';
import type { RecurrenceDto } from '@org/shared';
import { api, useApiMutation, useMe, useRecurrences } from '../api';
import { ErrorText, PeopleChecklist, PersonSelect, usePeopleMap } from '../components/common';
import { WEEKDAYS, formatDate } from '../he';

const KEYS = [['recurrences'], ['tasks']];
const STATE_LABEL = { active: 'פעילה', paused: 'מושהית', ended: 'הסתיימה' } as const;
const FREQ_UNIT = { daily: 'ימים', weekly: 'שבועות', monthly: 'חודשים' } as const;

function describe(r: RecurrenceDto): string {
  const every = r.interval === 1 ? { daily: 'כל יום', weekly: 'כל שבוע', monthly: 'כל חודש' }[r.freq] : `כל ${r.interval} ${FREQ_UNIT[r.freq]}`;
  if (r.mode === 'after_completion') return `${every} מרגע ההשלמה`;
  if (r.freq === 'weekly' && r.byWeekday.length) return `${every}, בימים ${r.byWeekday.map((d) => WEEKDAYS[d]).join(' ')}`;
  if (r.freq === 'monthly') return `${every}, ב-${r.byMonthDay ?? Number(r.startDate.slice(8))} לחודש`;
  return every;
}

export function RecurrencesPage() {
  const list = useRecurrences();
  const people = usePeopleMap();
  const [creating, setCreating] = useState(false);
  const act = useApiMutation(({ r, action }: { r: RecurrenceDto; action: 'pause' | 'resume' | 'end' }) =>
    api('POST', `/api/recurrences/${r.id}/${action}`, { version: r.version }), KEYS);

  return (
    <section>
      <div className="page-head">
        <h1>משימות חוזרות</h1>
        {!creating && <button onClick={() => setCreating(true)}>+ הגדרה חדשה</button>}
      </div>
      <p className="muted small">
        הגדרה חוזרת אינה משימה. היא יוצרת מופעים, וכל מופע הוא משימה רגילה ברשימות. שינוי בהגדרה חל רק על מופעים עתידיים.
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
              {r.nextOccurrenceDate && ` · המופע הבא: ${formatDate(r.nextOccurrenceDate)}`}
            </p>
            <div className="actions">
              {r.state === 'active' && <button className="secondary" onClick={() => act.mutate({ r, action: 'pause' })}>השהיה</button>}
              {r.state === 'paused' && <button className="secondary" onClick={() => act.mutate({ r, action: 'resume' })}>חידוש</button>}
              {r.state !== 'ended' && (
                <button className="secondary danger" onClick={() => confirm('לסיים את הסדרה? מופעים קיימים יישארו.') && act.mutate({ r, action: 'end' })}>
                  סיום
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
      <h2>הגדרה חוזרת חדשה</h2>
      <label>
        כותרת
        <input required value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <fieldset>
        <legend>סוג החזרתיות</legend>
        <label className="check">
          <input type="radio" checked={mode === 'schedule'} onChange={() => setMode('schedule')} />
          לוח זמנים קבוע (למשל כל יום ראשון): מופע נוצר בזמנו גם אם הקודם לא הושלם
        </label>
        <label className="check">
          <input type="radio" checked={mode === 'after_completion'} onChange={() => setMode('after_completion')} />
          לפי השלמה: המופע הבא נקבע מיום השלמת הקודם
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
          {mode === 'schedule' ? 'תאריך התחלה' : 'יעד המופע הראשון'}
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
