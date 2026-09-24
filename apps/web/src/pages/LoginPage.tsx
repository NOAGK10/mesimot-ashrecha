import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, useAuthConfig } from '../api';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(opts: { client_id: string; callback: (r: { credential: string }) => void }): void;
          renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
        };
      };
    };
  }
}

export function LoginPage() {
  const config = useAuthConfig();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const buttonRef = useRef<HTMLDivElement>(null);

  const done = () => qc.invalidateQueries({ queryKey: ['me'] });
  const fail = (e: unknown) =>
    setError(e instanceof ApiError && e.status === 403 ? 'לחשבון הזה אין גישה לארגון. פנו למנהל.' : 'ההתחברות נכשלה.');

  const clientId = config.data?.googleClientId;
  useEffect(() => {
    if (!clientId) return;
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      window.google?.accounts.id.initialize({
        client_id: clientId,
        callback: (r) => api('POST', '/api/auth/google', { credential: r.credential }).then(done, fail),
      });
      if (buttonRef.current) window.google?.accounts.id.renderButton(buttonRef.current, { theme: 'outline', size: 'large', locale: 'he' });
    };
    document.head.appendChild(script);
    return () => script.remove();
  }, [clientId]);

  return (
    <div className="center card narrow">
      <h1>ניהול משימות הארגון</h1>
      <p className="muted">מה צריך לעשות · מי אחראי · עד מתי · מה הסטטוס</p>
      {clientId && <div ref={buttonRef} className="google-btn" />}
      {config.data && !clientId && !config.data.devLogin && <p className="error">ההתחברות עדיין לא הוגדרה (GOOGLE_CLIENT_ID).</p>}
      {config.data?.devLogin && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            api('POST', '/api/auth/dev-login', { email }).then(done, fail);
          }}
        >
          <label>
            כניסת פיתוח (ללא Google)
            <input type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.org" />
          </label>
          <button type="submit">כניסה</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
