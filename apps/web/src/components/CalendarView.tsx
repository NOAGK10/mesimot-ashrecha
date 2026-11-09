import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { TaskDto } from '@org/shared';
import { useTasks } from '../api';
import { STATUS_LABEL, WEEKDAYS, gregorianMonthYear, hebrewDay, hebrewMonthYear } from '../he';

type Mode = 'hebrew' | 'gregorian';
const MAX_IN_CELL = 3;

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** First day of the month containing `d`, in the chosen calendar. */
function monthStart(d: Date, mode: Mode): Date {
  if (mode === 'gregorian') return new Date(d.getFullYear(), d.getMonth(), 1);
  let x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  while (hebrewDay(x) !== 'א׳') x = addDays(x, -1);
  return x;
}

/** Tasks by due date on a month grid, in the Hebrew or the Gregorian calendar. */
export function CalendarView({ mine }: { mine: boolean }) {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return localStorage.getItem('calendar-mode') === 'gregorian' ? 'gregorian' : 'hebrew';
    } catch {
      return 'hebrew';
    }
  });
  const today = new Date();
  const [anchor, setAnchor] = useState(() => monthStart(today, mode));
  const tasks = useTasks({ view: 'all', mine });

  const switchMode = (m: Mode) => {
    setMode(m);
    setAnchor(monthStart(addDays(anchor, 14), m)); // the middle of the month on screen
    try {
      localStorage.setItem('calendar-mode', m);
    } catch {
      /* not saved – fine */
    }
  };

  const start = anchor;
  const next = monthStart(addDays(start, 32), mode);
  const end = addDays(next, -1);
  const gridStart = addDays(start, -start.getDay());
  const gridEnd = addDays(end, 6 - end.getDay());
  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);

  const byDay = useMemo(() => {
    const m = new Map<string, TaskDto[]>();
    for (const t of tasks.data ?? []) {
      if (!t.dueDate) continue;
      m.set(t.dueDate, [...(m.get(t.dueDate) ?? []), t]);
    }
    return m;
  }, [tasks.data]);
  const undated = (tasks.data ?? []).filter((t) => !t.dueDate && t.status !== 'completed' && t.status !== 'cancelled').length;

  return (
    <div className="calendar">
      <div className="calendar-bar">
        <div className="calendar-nav">
          <button type="button" className="icon-btn" aria-label="החודש הקודם" onClick={() => setAnchor(monthStart(addDays(start, -1), mode))}>
            ›
          </button>
          <h2>{mode === 'hebrew' ? hebrewMonthYear(addDays(start, 14)) : gregorianMonthYear(start)}</h2>
          <button type="button" className="icon-btn" aria-label="החודש הבא" onClick={() => setAnchor(next)}>
            ‹
          </button>
          <button type="button" className="link" onClick={() => setAnchor(monthStart(today, mode))}>
            היום
          </button>
        </div>
        <div className="calendar-tools">
          {undated > 0 && (
            <Link to="/tasks?scope=org" className="muted small">
              {undated} בלי תאריך
            </Link>
          )}
          <div className="segmented small-seg" role="group" aria-label="סוג לוח שנה">
            <button type="button" className={mode === 'hebrew' ? 'active' : ''} aria-pressed={mode === 'hebrew'} onClick={() => switchMode('hebrew')}>
              עברי
            </button>
            <button type="button" className={mode === 'gregorian' ? 'active' : ''} aria-pressed={mode === 'gregorian'} onClick={() => switchMode('gregorian')}>
              לועזי
            </button>
          </div>
        </div>
      </div>

      <div className="calendar-grid" role="grid">
        {WEEKDAYS.map((w) => (
          <div key={w} className="calendar-head" role="columnheader">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const list = byDay.get(keyOf(d)) ?? [];
          const outside = d < start || d > end;
          const main = mode === 'hebrew' ? hebrewDay(d) : String(d.getDate());
          const other = mode === 'hebrew' ? String(d.getDate()) : hebrewDay(d);
          return (
            <div key={keyOf(d)} role="gridcell" className={`calendar-cell${outside ? ' outside' : ''}${sameDay(d, today) ? ' today' : ''}`}>
              <div className="calendar-date">
                <strong>{main}</strong>
                <span>{other}</span>
              </div>
              {list.slice(0, MAX_IN_CELL).map((t) => (
                <Link
                  key={t.id}
                  to={`/tasks/${t.id}`}
                  className={`calendar-task status-${t.status}${t.isOverdue ? ' overdue' : ''}`}
                  title={`${t.title} · ${STATUS_LABEL[t.status]}`}
                >
                  {t.title}
                </Link>
              ))}
              {list.length > MAX_IN_CELL && <span className="calendar-more">+{list.length - MAX_IN_CELL} נוספות</span>}
            </div>
          );
        })}
      </div>
      {tasks.isLoading && <p className="muted small">טוען…</p>}
    </div>
  );
}
