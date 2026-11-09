import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FinanceEntryDto, FinanceKind, FinanceSummaryDto } from '@org/shared';
import { api, useApiMutation, useMe } from '../api';
import { ErrorText, PersonSelect, usePeopleMap } from '../components/common';
import { Icon } from '../components/Sidebar';
import { formatDate, hebrewDay, hebrewMonthYear } from '../he';

const ils = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 });
export const money = (agorot: number) => ils.format(agorot / 100);

const KIND = {
  income: { tab: 'הכנסות', report: 'דיווח הכנסה', who: 'מי הכניס', sign: '+', empty: 'עוד אין הכנסות.' },
  expense: { tab: 'הוצאות', report: 'דיווח הוצאה', who: 'מי הוציא', sign: '−', empty: 'עוד אין הוצאות.' },
} as const;

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type Tab = 'stats' | FinanceKind;

/** Finance: the organisation's money (statistics), and income and expense reports that update it. */
export function FinancePage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'income' ? 'income' : params.get('tab') === 'expense' ? 'expense' : 'stats';
  const data = useQuery({ queryKey: ['finance'], queryFn: () => api<FinanceSummaryDto>('GET', '/api/finance') });

  return (
    <section className="finance-page">
      <div className="segmented" role="tablist" aria-label="כספים">
        {(
          [
            ['stats', 'סטטיסטיקה'],
            ['income', 'הכנסות'],
            ['expense', 'הוצאות'],
          ] as const
        ).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setParams(t === 'stats' ? {} : { tab: t })}>
            {label}
          </button>
        ))}
      </div>
      {data.isLoading && <p className="muted">טוען…</p>}
      <ErrorText error={data.error} />
      {data.data && (tab === 'stats' ? <Stats f={data.data} /> : <EntriesTab kind={tab} f={data.data} />)}
    </section>
  );
}

function Stats({ f }: { f: FinanceSummaryDto }) {
  const [editOpening, setEditOpening] = useState(false);
  const now = new Date();
  const monthKey = (iso: string) => iso.slice(0, 7);
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const sum = (kind: FinanceKind, month?: string) =>
    f.entries.filter((e) => e.kind === kind && (!month || monthKey(e.occurredOn) === month)).reduce((s, e) => s + e.amountAgorot, 0);

  return (
    <div className="finance-stats">
      <div className={`finance-hero${f.balanceAgorot < 0 ? ' negative' : ''}`}>
        <span className="finance-hero-label">כסף בקופה</span>
        <strong className="finance-hero-value" dir="ltr">
          {money(f.balanceAgorot)}
        </strong>
        <span className="muted small">
          יתרת פתיחה {money(f.openingAgorot)} · ועוד הכנסות {money(f.incomeAgorot)} · פחות הוצאות {money(f.expenseAgorot)}
        </span>
        {f.canSetOpening && !editOpening && (
          <button type="button" className="link small" onClick={() => setEditOpening(true)}>
            עדכון יתרת הפתיחה
          </button>
        )}
        {editOpening && <OpeningForm current={f.openingAgorot} onDone={() => setEditOpening(false)} />}
      </div>

      <div className="finance-tiles">
        <Tile label="סה״כ הכנסות" value={f.incomeAgorot} kind="income" />
        <Tile label="סה״כ הוצאות" value={f.expenseAgorot} kind="expense" />
        <Tile label="הכנסות החודש" value={sum('income', thisMonth)} kind="income" />
        <Tile label="הוצאות החודש" value={sum('expense', thisMonth)} kind="expense" />
      </div>

      <MonthlyChart entries={f.entries} />
    </div>
  );
}

function Tile({ label, value, kind }: { label: string; value: number; kind: FinanceKind }) {
  return (
    <div className={`finance-tile k-${kind}`}>
      <span className="finance-tile-label">
        <span className="finance-swatch" aria-hidden="true" />
        {label}
      </span>
      <strong dir="ltr">{money(value)}</strong>
    </div>
  );
}

function OpeningForm({ current, onDone }: { current: number; onDone: () => void }) {
  const [value, setValue] = useState(String(current / 100));
  const save = useApiMutation(() => api('PUT', '/api/finance/opening', { amountAgorot: Math.round(Number(value) * 100) }), [['finance']]);
  return (
    <form
      className="row wrap finance-opening"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined, { onSuccess: onDone });
      }}
    >
      <label>
        כמה כסף היה בקופה לפני הדיווח הראשון (₪)
        <input type="number" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} required autoFocus dir="ltr" />
      </label>
      <button type="submit" disabled={save.isPending || value === '' || Number.isNaN(Number(value))}>
        שמירה
      </button>
      <button type="button" className="secondary" onClick={onDone}>
        ביטול
      </button>
      <ErrorText error={save.error} />
    </form>
  );
}

/** Income and expenses per month, last 6 months: grouped bars, legend, hover tooltip and a table view. */
function MonthlyChart({ entries }: { entries: FinanceEntryDto[] }) {
  const [hover, setHover] = useState<{ i: number; kind: FinanceKind } | null>(null);
  const [asTable, setAsTable] = useState(false);
  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, k) => {
      const d = new Date(now.getFullYear(), now.getMonth() - 5 + k, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const of = (kind: FinanceKind) => entries.filter((e) => e.kind === kind && e.occurredOn.startsWith(key)).reduce((s, e) => s + e.amountAgorot, 0);
      return { key, label: new Intl.DateTimeFormat('he', { month: 'short' }).format(d), income: of('income'), expense: of('expense') };
    });
  }, [entries]);
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
  const empty = months.every((m) => !m.income && !m.expense);

  return (
    <div className="card finance-chart">
      <div className="finance-chart-head">
        <h2>הכנסות והוצאות לפי חודש</h2>
        <div className="finance-legend">
          <span className="k-income">
            <span className="finance-swatch" aria-hidden="true" /> הכנסות
          </span>
          <span className="k-expense">
            <span className="finance-swatch" aria-hidden="true" /> הוצאות
          </span>
          <button type="button" className="link small" onClick={() => setAsTable((t) => !t)}>
            {asTable ? 'תצוגת גרף' : 'תצוגת טבלה'}
          </button>
        </div>
      </div>
      {empty && !asTable ? (
        <p className="muted small">כשיהיו דיווחים, יופיע כאן גרף של ששת החודשים האחרונים.</p>
      ) : asTable ? (
        <table className="finance-table">
          <thead>
            <tr>
              <th>חודש</th>
              <th>הכנסות</th>
              <th>הוצאות</th>
              <th>הפרש</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.key}>
                <td>{m.label}</td>
                <td dir="ltr">{money(m.income)}</td>
                <td dir="ltr">{money(m.expense)}</td>
                <td dir="ltr">{money(m.income - m.expense)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="finance-bars" role="img" aria-label="גרף הכנסות והוצאות בששת החודשים האחרונים">
          {months.map((m, i) => (
            <div key={m.key} className="finance-month">
              <div className="finance-pair">
                {(['income', 'expense'] as const).map((kind) => (
                  <div
                    key={kind}
                    className={`finance-bar k-${kind}`}
                    style={{ height: `${(m[kind] / max) * 100}%` }}
                    onMouseEnter={() => setHover({ i, kind })}
                    onMouseLeave={() => setHover(null)}
                  >
                    {hover?.i === i && hover.kind === kind && (
                      <span className="finance-tip" role="tooltip">
                        {kind === 'income' ? 'הכנסות' : 'הוצאות'} · {m.label}
                        <strong dir="ltr">{money(m[kind])}</strong>
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <span className="finance-month-label">{m.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EntriesTab({ kind, f }: { kind: FinanceKind; f: FinanceSummaryDto }) {
  const k = KIND[kind];
  const [reporting, setReporting] = useState(false);
  const people = usePeopleMap();
  const list = f.entries.filter((e) => e.kind === kind);
  const total = list.reduce((s, e) => s + e.amountAgorot, 0);
  const remove = useApiMutation((id: string) => api('POST', `/api/finance/entries/${id}/delete`), [['finance']]);

  return (
    <div className={`finance-entries k-${kind}`}>
      <div className="finance-entries-top">
        <button type="button" className="finance-report" onClick={() => setReporting(true)}>
          <Icon name="add" size={20} /> {k.report}
        </button>
        <span className="finance-total">
          סה״כ {k.tab}: <strong dir="ltr">{money(total)}</strong>
        </span>
      </div>
      {list.length === 0 ? (
        <div className="calls-empty">
          <p>{k.empty}</p>
          <p className="muted small">כל דיווח מתעדכן מיד בסכום שבקופה.</p>
        </div>
      ) : (
        <ul className="plain finance-list">
          {list.map((e) => (
            <li key={e.id} className="finance-item">
              <strong className="finance-amount" dir="ltr">
                {k.sign}
                {money(e.amountAgorot)}
              </strong>
              <div className="finance-item-main">
                <span className="finance-desc">{e.description}</span>
                <span className="muted small">
                  {k.who}: {e.personName} · {formatDate(e.occurredOn)}
                  {e.reportedByPersonId !== e.personId && <> · דיווח: {people.name(e.reportedByPersonId)}</>}
                </span>
              </div>
              {e.canDelete && (
                <button
                  type="button"
                  className="icon-btn finance-del"
                  aria-label="מחיקת הדיווח"
                  title="מחיקה"
                  onClick={() => confirm(`למחוק את הדיווח "${e.description}" (${money(e.amountAgorot)})? הסכום בקופה יתעדכן.`) && remove.mutate(e.id)}
                >
                  <Icon name="trash" size={18} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorText error={remove.error} />
      {reporting && <ReportDialog kind={kind} onClose={() => setReporting(false)} />}
    </div>
  );
}

function ReportDialog({ kind, onClose }: { kind: FinanceKind; onClose: () => void }) {
  const k = KIND[kind];
  const ref = useRef<HTMLDialogElement>(null);
  const me = useMe();
  const people = usePeopleMap();
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [personId, setPersonId] = useState(me.data?.personId ?? '');
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const agorot = Math.round(Number(amount) * 100);
  const valid = amount !== '' && Number.isFinite(agorot) && agorot > 0 && description.trim() && personId;
  const day = new Date(`${occurredOn}T12:00:00`);

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await api('POST', '/api/finance/entries', { kind, amountAgorot: agorot, description, personId, occurredOn });
      await qc.invalidateQueries({ queryKey: ['finance'] });
      (ref.current?.close(), onClose());
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };

  return (
    <dialog ref={ref} className="task-dialog" onClose={onClose} onClick={(e) => e.target === ref.current && (ref.current?.close(), onClose())} aria-labelledby="finance-report-title">
      <form
        className="task-dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id="finance-report-title">{k.report}</h2>
        <label className="float-field has-value finance-amount-field">
          <input type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus dir="ltr" placeholder="0" />
          <span>סכום (₪)</span>
        </label>
        <label className="float-field">
          <textarea rows={3} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder=" " required />
          <span>פרטים</span>
        </label>
        <div className="task-dialog-row finance-row">
          <label className="float-field has-value">
            <PersonSelect people={people.list} value={personId} onChange={setPersonId} required />
            <span>{k.who}</span>
          </label>
          <label className="float-field has-value">
            <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} required />
            <span>תאריך</span>
            {occurredOn && <small className="hebrew-date">{`${hebrewDay(day)} ${hebrewMonthYear(day)}`}</small>}
          </label>
        </div>
        <ErrorText error={error} />
        <div className="task-dialog-actions">
          <button type="submit" disabled={!valid || pending}>
            {pending ? 'שומר…' : 'דיווח'}
          </button>
          <button type="button" className="link" onClick={() => (ref.current?.close(), onClose())}>
            ביטול
          </button>
          {valid && (
            <span className="muted small">
              הקופה {kind === 'income' ? 'תגדל' : 'תקטן'} ב־<span dir="ltr">{money(agorot)}</span>
            </span>
          )}
        </div>
      </form>
    </dialog>
  );
}
