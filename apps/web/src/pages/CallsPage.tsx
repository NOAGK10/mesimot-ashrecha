import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CallDirection, CallDto, CallStatus } from '@org/shared';
import { CALL_STATUSES } from '@org/shared';
import { api, useApiMutation } from '../api';
import { ErrorText } from '../components/common';
import { Icon } from '../components/Sidebar';
import { chatDayLabel, clockTime } from '../he';

export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  answered: 'נענתה',
  missed: 'לא נענתה',
  approved: 'אושר',
  disconnected: 'נותקה',
  callback: 'צריך לחזור',
  done: 'טופל',
};

const KEYS = [['calls']];

/** "now" (or an ISO time) as the value of a datetime-local input, in local time. */
function localInput(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The manager's private call log: who called, what happened and what was said. */
export function CallsPage() {
  const list = useQuery({ queryKey: ['calls'], queryFn: () => api<CallDto[]>('GET', '/api/calls') });
  const [editing, setEditing] = useState<CallDto | 'new' | null>(null);
  const [filter, setFilter] = useState<CallStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const remove = useApiMutation((id: string) => api('DELETE', `/api/calls/${id}`), KEYS);

  const all = list.data ?? [];
  const shown = useMemo(() => {
    const term = q.trim();
    const digits = term.replace(/\D/g, '');
    const matches = (c: CallDto) =>
      !term || c.callerName.includes(term) || c.summary.includes(term) || (digits !== '' && c.phone.replace(/\D/g, '').includes(digits));
    return all.filter((c) => (filter === 'all' || c.status === filter) && matches(c));
  }, [all, filter, q]);
  const count = (s: CallStatus) => all.filter((c) => c.status === s).length;

  // Group by day, like the chat.
  const days: { label: string; items: CallDto[] }[] = [];
  for (const c of shown) {
    const label = chatDayLabel(c.occurredAt);
    if (days.at(-1)?.label !== label) days.push({ label, items: [] });
    days.at(-1)!.items.push(c);
  }

  return (
    <section className="calls-page">
      <div className="calls-top">
        <p className="muted small">🔒 רק את/ה רואה את השיחות כאן.</p>
        {editing === null && (
          <button type="button" className="calls-new" onClick={() => setEditing('new')}>
            <Icon name="add" size={20} /> שיחה חדשה
          </button>
        )}
      </div>

      {editing === 'new' && <CallForm onDone={() => setEditing(null)} />}

      {all.length > 0 && (
        <div className="calls-filters">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי שם, טלפון או תוכן" aria-label="חיפוש" />
          <div className="call-chips">
            <button type="button" className={`call-chip${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>
              הכול <span>{all.length}</span>
            </button>
            {CALL_STATUSES.filter((s) => count(s) > 0).map((s) => (
              <button key={s} type="button" className={`call-chip s-${s}${filter === s ? ' active' : ''}`} onClick={() => setFilter(s)}>
                {CALL_STATUS_LABELS[s]} <span>{count(s)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {list.isLoading && <p className="muted">טוען…</p>}
      {list.data && all.length === 0 && editing === null && (
        <div className="calls-empty">
          <p>עוד אין שיחות.</p>
          <p className="muted small">אחרי כל שיחה לוחצים "שיחה חדשה", בוחרים מה קרה וכותבים מה היה בה.</p>
        </div>
      )}
      {all.length > 0 && shown.length === 0 && <p className="muted">אין שיחות שמתאימות לחיפוש.</p>}

      {days.map((d) => (
        <div key={d.label}>
          <div className="calls-day">{d.label}</div>
          <ul className="plain calls-list">
            {d.items.map((c) =>
              editing !== null && editing !== 'new' && editing.id === c.id ? (
                <li key={c.id}>
                  <CallForm call={c} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li key={c.id} className="call-card">
                  <div className="call-head">
                    <span className={`call-status s-${c.status}`}>{CALL_STATUS_LABELS[c.status]}</span>
                    <strong className="call-name">{c.callerName || c.phone}</strong>
                    {c.callerName && c.phone && (
                      <a className="call-phone" href={`tel:${c.phone.replace(/[^\d+*#]/g, '')}`} dir="ltr">
                        {c.phone}
                      </a>
                    )}
                    <span className="call-meta muted small">
                      {c.direction === 'in' ? '↙ נכנסת' : '↗ יוצאת'} · {clockTime(c.occurredAt)}
                    </span>
                  </div>
                  {c.summary && <p className="call-summary">{c.summary}</p>}
                  <div className="call-actions">
                    <button type="button" className="link" onClick={() => setEditing(c)}>
                      עריכה
                    </button>
                    <button type="button" className="link danger-text" onClick={() => confirm('למחוק את השיחה?') && remove.mutate(c.id)}>
                      מחיקה
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        </div>
      ))}
      <ErrorText error={remove.error} />
    </section>
  );
}

/** Adding or editing one call. */
function CallForm({ call, onDone }: { call?: CallDto; onDone: () => void }) {
  const [callerName, setCallerName] = useState(call?.callerName ?? '');
  const [phone, setPhone] = useState(call?.phone ?? '');
  const [direction, setDirection] = useState<CallDirection>(call?.direction ?? 'in');
  const [status, setStatus] = useState<CallStatus | null>(call?.status ?? null);
  const [summary, setSummary] = useState(call?.summary ?? '');
  const [when, setWhen] = useState(localInput(call?.occurredAt));
  const save = useApiMutation(
    () => {
      const body = { callerName, phone, personId: call?.personId ?? null, direction, status, summary, occurredAt: new Date(when).toISOString() };
      return call ? api('PUT', `/api/calls/${call.id}`, body) : api('POST', '/api/calls', body);
    },
    KEYS,
  );
  const missing = !callerName.trim() && !phone.trim();

  return (
    <form
      className="card stack call-form"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined, { onSuccess: onDone });
      }}
    >
      <h2>{call ? 'עריכת שיחה' : 'שיחה חדשה'}</h2>
      <div className="row wrap">
        <label>
          מי
          <input value={callerName} onChange={(e) => setCallerName(e.target.value)} maxLength={120} placeholder="שם" autoFocus={!call} />
        </label>
        <label>
          טלפון
          <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} inputMode="tel" dir="ltr" placeholder="050-0000000" />
        </label>
      </div>
      <div className="segmented" role="group" aria-label="כיוון השיחה">
        <button type="button" aria-pressed={direction === 'in'} className={direction === 'in' ? 'active' : ''} onClick={() => setDirection('in')}>
          ↙ נכנסת
        </button>
        <button type="button" aria-pressed={direction === 'out'} className={direction === 'out' ? 'active' : ''} onClick={() => setDirection('out')}>
          ↗ יוצאת
        </button>
      </div>
      <fieldset className="call-status-pick">
        <legend>מה קרה</legend>
        {CALL_STATUSES.map((s) => (
          <button key={s} type="button" aria-pressed={status === s} className={`call-chip s-${s}${status === s ? ' active' : ''}`} onClick={() => setStatus(s)}>
            {CALL_STATUS_LABELS[s]}
          </button>
        ))}
      </fieldset>
      <label>
        מה היה בשיחה
        <textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={5000} placeholder="על מה דיברנו, מה סוכם, מה צריך לעשות" />
      </label>
      <label className="call-when">
        מתי
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
      </label>
      <ErrorText error={save.error} />
      <div className="actions">
        <button type="submit" disabled={save.isPending || !status || missing}>
          {save.isPending ? 'שומר…' : 'שמירה'}
        </button>
        <button type="button" className="secondary" onClick={onDone}>
          ביטול
        </button>
        {(missing || !status) && <span className="muted small">{missing ? 'צריך שם או טלפון' : 'בחרו מה קרה בשיחה'}</span>}
      </div>
    </form>
  );
}
