import { useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PerformanceScoreDto, ProfileDto } from '@org/shared';
import { AVATAR_COLORS } from '@org/shared';
import { api, useMe } from '../api';
import { Avatar } from '../components/Avatar';
import { ErrorText, PersonTag, usePeopleMap } from '../components/common';
import { formatDateTime, roleLabel } from '../he';
import { TasksPage } from './TasksPage';

const useProfile = (id: string) => useQuery({ queryKey: ['profile', id], queryFn: () => api<ProfileDto>('GET', `/api/people/${id}/profile`) });

/** A person's profile: who they are, what they are responsible for, how they are doing, feedback, and their tasks. */
export function ProfilePage() {
  const { id = '' } = useParams();
  const me = useMe();
  const profile = useProfile(id);
  const [editing, setEditing] = useState(false);

  if (profile.isLoading) return <p className="muted">טוען…</p>;
  if (!profile.data) return <ErrorText error={profile.error ?? new Error()} />;
  const { person, score, feedback, canEditProfile, canGiveFeedback } = profile.data;
  const isMe = me.data?.personId === id;

  return (
    <section className="profile" key={id}>
      <div className="card profile-head">
        <Avatar personId={person.id} name={person.displayName} size={88} />
        <div className="profile-main">
          <h1>{person.displayName}</h1>
          <div className="row-inline">
            {person.jobTitle && <span className="job-tag large">{person.jobTitle}</span>}
            <span className="muted small">{roleLabel(person.role)}</span>
            {!person.active && <span className="tag">לא פעיל</span>}
          </div>
          <div className="responsibilities">
            <strong>אחראי על:</strong>{' '}
            {person.responsibilities ? <span className="pre">{person.responsibilities}</span> : <span className="muted">לא נכתב עדיין</span>}
          </div>
        </div>
        {canEditProfile && !editing && (
          <button className="secondary small-btn" onClick={() => setEditing(true)}>
            {isMe ? 'עריכת הפרופיל שלי' : 'עריכת פרופיל'}
          </button>
        )}
      </div>

      {editing && <EditProfile profile={profile.data} onDone={() => setEditing(false)} />}

      <div className="profile-grid">
        <ScoreCard score={score} />
        <div className="card">
          <h2 id="feedback">פידבקים {feedback.length > 0 && <span className="muted small">({feedback.length})</span>}</h2>
          {canGiveFeedback && <FeedbackComposer personId={id} name={person.displayName} />}
          {feedback.length === 0 && <p className="muted small">עוד אין פידבקים.</p>}
          <FeedbackList personId={id} items={feedback} />
        </div>
      </div>

      <div className="profile-tasks">
        <TasksPage key={id} scope="person" personId={id} />
      </div>
    </section>
  );
}

function ScoreCard({ score }: { score: PerformanceScoreDto }) {
  const tone = score.value === null ? '' : score.value >= 80 ? 'good' : score.value >= 50 ? 'mid' : 'low';
  return (
    <div className="card">
      <h2>ציון ביצוע</h2>
      <div className={`score ${tone}`}>{score.value === null ? '—' : `${score.value}%`}</div>
      <p className="small">
        {score.value === null
          ? `אין עדיין מספיק נתונים. הציון מופיע אחרי ${score.minSample} משימות עם תאריך יעד.`
          : 'משימות שהושלמו עד תאריך היעד, מתוך כל המשימות עם תאריך יעד.'}
      </p>
      <ul className="score-breakdown small">
        <li>✓ הושלמו בזמן: {score.completedOnTime}</li>
        <li>⏱ הושלמו באיחור: {score.completedLate}</li>
        <li>⚠ פתוחות שעבר התאריך שלהן: {score.openOverdue}</li>
        {score.completedWithoutDueDate > 0 && <li className="muted">הושלמו בלי תאריך יעד (לא נספרות): {score.completedWithoutDueDate}</li>}
      </ul>
      <p className="muted small">מחושב אוטומטית ממשימות שהאדם אחראי עליהן, ב-{score.windowDays} הימים האחרונים.</p>
    </div>
  );
}

function FeedbackComposer({ personId, name }: { personId: string; name: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <form
      className="stack feedback-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api('POST', `/api/people/${personId}/feedback`, { body });
          setBody('');
          await qc.invalidateQueries({ queryKey: ['profile', personId] });
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <textarea
        rows={2}
        required
        maxLength={2000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={`פידבק ל${name}… (יופיע עם השם שלך)`}
      />
      <div className="actions tight">
        <button type="submit" disabled={busy || !body.trim()}>
          שליחת פידבק
        </button>
      </div>
      <ErrorText error={error} />
    </form>
  );
}

function FeedbackList({ personId, items }: { personId: string; items: ProfileDto['feedback'] }) {
  const qc = useQueryClient();
  const people = usePeopleMap();
  const remove = async (id: number) => {
    if (!confirm('למחוק את הפידבק?')) return;
    await api('DELETE', `/api/feedback/${id}`);
    await qc.invalidateQueries({ queryKey: ['profile', personId] });
  };
  return (
    <ul className="feedback-list">
      {items.map((f) => (
        <li key={f.id}>
          <div className="chat-meta">
            <PersonTag id={f.authorPersonId} avatarFor={f.authorPersonId} name={people.name(f.authorPersonId)} jobTitle={people.jobTitle(f.authorPersonId)} />
            <span className="muted small">{formatDateTime(f.createdAt)}</span>
            {f.canDelete && (
              <button className="link small danger-text" onClick={() => remove(f.id)}>
                מחיקה
              </button>
            )}
          </div>
          <p className="chat-body">{f.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** Resizes the chosen picture to a 256×256 JPEG in the browser before uploading. */
async function toAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const side = Math.min(bitmap.width, bitmap.height);
  canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function EditProfile({ profile, onDone }: { profile: ProfileDto; onDone: () => void }) {
  const qc = useQueryClient();
  const { person } = profile;
  const [color, setColor] = useState(person.avatarColor);
  const [responsibilities, setResponsibilities] = useState(person.responsibilities ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['profile', person.id] }), qc.invalidateQueries({ queryKey: ['people'] })]);
  const run = async (fn: () => Promise<unknown>, close = false) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      if (close) onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api('PATCH', `/api/people/${person.id}/profile`, { avatarColor: color, responsibilities: responsibilities.trim() || null }), true);
      }}
    >
      <h2>עריכת פרופיל</h2>
      <fieldset>
        <legend>תמונה</legend>
        <div className="row-inline">
          <Avatar personId={person.id} name={person.displayName} size={56} />
          <button type="button" className="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {person.avatarVersion ? 'החלפת תמונה' : 'העלאת תמונה'}
          </button>
          {person.avatarVersion && (
            <button type="button" className="link danger-text" disabled={busy} onClick={() => run(() => api('DELETE', `/api/people/${person.id}/avatar`))}>
              הסרת התמונה
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void run(async () => api('PUT', `/api/people/${person.id}/avatar`, { dataUrl: await toAvatarDataUrl(file) }));
            }}
          />
        </div>
      </fieldset>
      <fieldset>
        <legend>צבע (כשאין תמונה)</legend>
        <div className="color-row">
          {AVATAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch${c.toLowerCase() === color.toLowerCase() ? ' selected' : ''}`}
              style={{ background: c }}
              aria-label={`צבע ${c}`}
              onClick={() => setColor(c)}
            />
          ))}
          <label className="inline small">
            אחר
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
        </div>
      </fieldset>
      <label>
        על מה אני אחראי
        <textarea
          rows={3}
          maxLength={2000}
          value={responsibilities}
          onChange={(e) => setResponsibilities(e.target.value)}
          placeholder="למשל: רכש וספקים, הצעות מחיר, תיאום עם האולם"
        />
      </label>
      <ErrorText error={error} />
      <div className="actions">
        <button type="submit" disabled={busy}>
          שמירה
        </button>
        <button type="button" className="secondary" onClick={onDone}>
          סגירה
        </button>
      </div>
    </form>
  );
}
