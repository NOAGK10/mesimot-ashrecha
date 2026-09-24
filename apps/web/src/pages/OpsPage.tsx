import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { formatDateTime } from '../he';

interface OpsStatus {
  worker: { lastBeatAt: string | null; lastBeatAgeSeconds: number | null; healthy: boolean; lastError: string | null; lastErrorAt: string | null };
  notifications: Record<string, number>;
  backlogOlderThan15Min: number;
  recentFailures: Array<{ id: string; taskId: string; kind: string; lastError: string | null; attempts: number }>;
}

const NOTE_LABEL: Record<string, string> = { pending: 'ממתינות', sending: 'בשליחה', sent: 'נשלחו', cancelled: 'בוטלו', failed: 'נכשלו' };

export function OpsPage() {
  const status = useQuery({ queryKey: ['ops'], queryFn: () => api<OpsStatus>('GET', '/api/ops/status'), refetchInterval: 15_000 });
  const s = status.data;
  return (
    <section>
      <h1>מצב המערכת</h1>
      {s && (
        <>
          <div className={`card ${s.worker.healthy ? 'ok' : 'bad'}`}>
            <h2>תהליך הרקע {s.worker.healthy ? '✓ פעיל' : '✗ לא מגיב'}</h2>
            <p className="muted small">
              פעימה אחרונה: {s.worker.lastBeatAt ? formatDateTime(s.worker.lastBeatAt) : 'אף פעם'}
              {s.worker.lastError && ` · שגיאה אחרונה: ${s.worker.lastError}`}
            </p>
          </div>
          <div className="card">
            <h2>התראות</h2>
            <p>
              {Object.entries(s.notifications).map(([k, v]) => (
                <span key={k} className="tag">
                  {NOTE_LABEL[k] ?? k}: {v}
                </span>
              ))}
            </p>
            {s.backlogOlderThan15Min > 0 && <p className="error">{s.backlogOlderThan15Min} התראות מתעכבות מעל 15 דקות.</p>}
            {s.recentFailures.length > 0 && (
              <ul>
                {s.recentFailures.map((f) => (
                  <li key={f.id} className="small">
                    {f.kind} · {f.attempts} ניסיונות · {f.lastError}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
