import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { formatDateTime } from '../he';

interface Mail {
  to: string;
  subject: string;
  text: string;
  at: string;
}

/** Development only: shows e-mails captured by the console mail transport, so magic links can be tried locally. */
export function DevOutboxPage() {
  const mails = useQuery({ queryKey: ['outbox'], queryFn: () => api<Mail[]>('GET', '/api/dev/outbox'), refetchInterval: 5000 });
  return (
    <main className="content">
      <h1>תיבת דואר יוצא (פיתוח)</h1>
      {mails.error && <p className="error">זמין רק בסביבת פיתוח עם MAIL_TRANSPORT=console.</p>}
      {mails.data?.length === 0 && <p className="empty">עוד לא נשלחו מיילים. תהליך הרקע שולח כל 30 שניות.</p>}
      {mails.data?.map((m, i) => (
        <article key={i} className="card">
          <p className="muted small">
            {formatDateTime(m.at)} · אל: <span dir="ltr">{m.to}</span>
          </p>
          <h2>{m.subject}</h2>
          <pre className="mail">
            {m.text.split(/(https?:\/\/\S+)/).map((part, j) =>
              /^https?:\/\//.test(part) ? (
                <a key={j} href={part.replace(/^https?:\/\/[^/]+/, '')} dir="ltr">
                  {part}
                </a>
              ) : (
                part
              ),
            )}
          </pre>
        </article>
      ))}
    </main>
  );
}
