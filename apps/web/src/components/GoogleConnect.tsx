import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, useGoogleStatus } from '../api';
import { connectGoogle } from '../google';

/** Banner that explains and manages the manager's Google Drive connection. */
export function GoogleConnect() {
  const status = useGoogleStatus();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['google-status'] });

  if (!status.data) return null;
  if (!status.data.enabled) {
    return (
      <p className="notice small">
        החיבור ל-Google Drive עוד לא הוגדר בשרת. בינתיים אפשר לייבא קבצי Excel ו-CSV ולהוסיף מסמכים בקישור.
      </p>
    );
  }
  if (status.data.connected) {
    return (
      <p className="muted small">
        ✓ מחובר ל-Google Drive. המערכת רואה רק קבצים שבוחרים בה.{' '}
        <button className="link" onClick={() => api('DELETE', '/api/google/connection').then(refresh)}>
          ניתוק
        </button>
      </p>
    );
  }
  return (
    <div className="notice">
      <p className="small">
        כדי לבחור קבצים מ-Drive ולהעלות קבצים ל-Drive צריך לחבר את חשבון Google. המערכת תקבל גישה רק לקבצים שתבחרו בה.
      </p>
      <button
        onClick={() => {
          setError(null);
          connectGoogle(status.data!).then(refresh, () => setError('החיבור לא הושלם. נסו שוב.'));
        }}
      >
        חיבור ל-Google Drive
      </button>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
