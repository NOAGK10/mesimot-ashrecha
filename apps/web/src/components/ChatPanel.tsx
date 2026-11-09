import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MAX_CHAT_FILE_BYTES, type ChatReceiptDto, type MessageDto, type PersonDto } from '@org/shared';
import { api, useMe } from '../api';
import { chatDayLabel, clockTime } from '../he';
import { Avatar } from './Avatar';
import { Icon } from './Sidebar';
import { ErrorText, PersonTag, UserError, usePeopleMap } from './common';

const POLL_MS = 5000;
const PAGE = 50;
const MAX_VOICE_MS = 5 * 60_000;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Attachment = { kind: 'file' | 'voice'; fileName: string; mimeType: string; dataBase64: string; durationMs: number | null };
type SendFn = (body: string, mentionIds: string[], attachment?: Attachment) => Promise<void>;

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',', 2)[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
const formatSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const formatDuration = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * A chat channel: the general chat, one task's conversation (taskId) or a private conversation (withPersonId).
 * New messages and read receipts arrive by polling every few seconds while the page is visible.
 * Typing "@" opens a list of people; tagged people get a notification on their home page.
 */
export function ChatPanel({
  taskId,
  withPersonId,
  privateTo,
  fill = false,
}: {
  taskId?: string;
  withPersonId?: string;
  privateTo?: string[];
  fill?: boolean;
}) {
  const me = useMe();
  const people = usePeopleMap();
  const qc = useQueryClient();
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [receipts, setReceipts] = useState<ChatReceiptDto[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const channelQuery = taskId ? `taskId=${taskId}` : withPersonId ? `withPersonId=${withPersonId}` : '';
  const base = `/api/chat/messages?${channelQuery}`;
  const lastId = messages.at(-1)?.id;

  const merge = useCallback((incoming: MessageDto[]) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.id - b.id);
    });
  }, []);

  // First page.
  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setReceipts([]);
    api<MessageDto[]>('GET', `${base}&limit=${PAGE}`)
      .then((page) => {
        if (cancelled) return;
        setMessages(page);
        setHasOlder(page.length === PAGE);
      })
      .catch(setError);
    return () => {
      cancelled = true;
    };
  }, [base]);

  // Poll for new messages and for how far the others have read, while the tab is visible.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      api<MessageDto[]>('GET', `${base}&after=${lastId ?? 0}`).then(merge, () => undefined);
      api<ChatReceiptDto[]>('GET', `/api/chat/receipts?${channelQuery}`).then(setReceipts, () => undefined);
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [base, channelQuery, lastId, merge]);

  // Reading the conversation marks it as read (for the other side's ✓✓ and for the unread counts).
  useEffect(() => {
    if (!lastId || document.visibilityState !== 'visible') return;
    api('POST', '/api/chat/read', { taskId: taskId ?? null, withPersonId: withPersonId ?? null, lastId })
      .then(() => qc.invalidateQueries({ queryKey: ['chat-channels'] }))
      .catch(() => undefined);
  }, [lastId, taskId, withPersonId, qc]);

  // Keep the view at the bottom when new messages arrive, unless the reader scrolled up.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // Deep link from a notification: #m123 scrolls to and highlights that message.
  useEffect(() => {
    const target = /^#m(\d+)$/.exec(window.location.hash)?.[1];
    if (!target) return;
    const el = document.getElementById(`m${target}`);
    if (el) {
      stickToBottom.current = false;
      el.scrollIntoView({ block: 'center' });
      el.classList.add('flash');
    }
  }, [messages.length]);

  const loadOlder = async () => {
    const first = messages[0];
    if (!first) return;
    const page = await api<MessageDto[]>('GET', `${base}&before=${first.id}&limit=${PAGE}`);
    stickToBottom.current = false;
    merge(page);
    setHasOlder(page.length === PAGE);
  };

  const remove = async (m: MessageDto) => {
    if (!confirm('למחוק את ההודעה?')) return;
    await api('DELETE', `/api/chat/messages/${m.id}`).catch(setError);
    merge([{ ...m, deleted: true, body: '', mentionIds: [], attachment: null, canDelete: false }]);
  };

  const send: SendFn = async (body, mentionIds, attachment) => {
    const m = await api<MessageDto>('POST', '/api/chat/messages', {
      body,
      taskId: taskId ?? null,
      withPersonId: withPersonId ?? null,
      mentionIds,
      attachment: attachment ?? null,
    });
    stickToBottom.current = true;
    merge([m]);
    void qc.invalidateQueries({ queryKey: ['recent-chat'] });
    void qc.invalidateQueries({ queryKey: ['chat-channels'] });
  };

  // Who can be tagged: people who sign in; in a private task only the people on it and managers; nobody in a private conversation.
  const candidates = useMemo(
    () =>
      withPersonId
        ? []
        : people.list.filter(
            (p) => p.active && p.role !== null && p.id !== me.data?.personId && (!privateTo || p.role === 'manager' || privateTo.includes(p.id)),
          ),
    [people.list, me.data?.personId, privateTo, withPersonId],
  );

  /** ✓ sent, ✓✓ (blue) once someone else has read it. */
  const readBy = (m: MessageDto) => receipts.filter((r) => r.lastReadId >= m.id).map((r) => people.name(r.personId));

  return (
    <div className={`chat${fill ? ' chat-fill' : ''}`}>
      <div
        className="chat-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {hasOlder && (
          <button className="link chat-older" onClick={loadOlder}>
            הודעות קודמות
          </button>
        )}
        {messages.length === 0 && (
          <p className="muted small chat-empty">
            {taskId ? 'עוד אין הודעות על המשימה הזו.' : withPersonId ? 'זו שיחה פרטית – רק שניכם רואים אותה.' : 'עוד אין הודעות. אפשר להתחיל!'}
          </p>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const day = new Date(m.createdAt).toDateString();
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== day;
          // Consecutive messages from the same person on the same day share one picture and name.
          const continued = !newDay && prev?.authorPersonId === m.authorPersonId;
          const mine = m.authorPersonId === me.data?.personId;
          const readers = mine && !m.deleted ? readBy(m) : [];
          return (
            <Fragment key={m.id}>
              {newDay && (
                <div className="chat-day">
                  <span>{chatDayLabel(m.createdAt)}</span>
                </div>
              )}
              <div id={`m${m.id}`} className={`chat-row${mine ? ' mine' : ''}${continued ? ' continued' : ''}`}>
                {!mine && (
                  <span className="chat-avatar">{!continued && <Avatar personId={m.authorPersonId} name={people.name(m.authorPersonId)} size={32} />}</span>
                )}
                <div className="chat-bubble">
                  {!mine && !continued && !withPersonId && (
                    <div className="chat-author">
                      {people.name(m.authorPersonId)}
                      {people.jobTitle(m.authorPersonId) && <span className="chat-job"> · {people.jobTitle(m.authorPersonId)}</span>}
                    </div>
                  )}
                  {m.deleted ? (
                    <p className="chat-body muted">ההודעה נמחקה</p>
                  ) : (
                    <>
                      {m.attachment && <AttachmentView a={m.attachment} />}
                      {m.body && <MessageBody body={m.body} mentioned={m.mentionIds.map((id) => people.name(id))} />}
                    </>
                  )}
                  <div className="chat-foot">
                    {m.canDelete && (
                      <button className="link chat-delete" onClick={() => remove(m)} aria-label="מחיקת ההודעה">
                        מחיקה
                      </button>
                    )}
                    <span className="chat-time">{clockTime(m.createdAt)}</span>
                    {mine && !m.deleted && (
                      <span
                        className={`chat-ticks${readers.length ? ' read' : ''}`}
                        title={readers.length ? `נקרא על ידי ${readers.join(', ')}` : 'נשלח'}
                        aria-label={readers.length ? `נקרא על ידי ${readers.join(', ')}` : 'נשלח'}
                      >
                        {readers.length ? '✓✓' : '✓'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
      <Composer candidates={candidates} onSend={send} />
      <ErrorText error={error} />
    </div>
  );
}

/** A picture is shown, a recording gets a player, any other file a download link. */
function AttachmentView({ a }: { a: NonNullable<MessageDto['attachment']> }) {
  const url = `/api/chat/attachments/${a.id}`;
  if (a.kind === 'voice')
    return (
      <div className="chat-voice">
        <audio controls preload="metadata" src={url} />
        {a.durationMs !== null && <span className="chat-time">{formatDuration(a.durationMs)}</span>}
      </div>
    );
  if (/^image\/(png|jpeg|gif|webp)$/.test(a.mimeType))
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="chat-image">
        <img src={url} alt={a.fileName} loading="lazy" />
      </a>
    );
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="chat-file" download={a.mimeType === 'application/pdf' ? undefined : a.fileName}>
      <Icon name="file" size={28} />
      <span>
        <strong>{a.fileName}</strong>
        <span className="chat-time">{formatSize(a.sizeBytes)}</span>
      </span>
    </a>
  );
}

/** Highlights "@Name" for the people actually tagged in the message. */
function MessageBody({ body, mentioned }: { body: string; mentioned: string[] }) {
  const names = mentioned.filter((n) => n && n !== '—').sort((a, b) => b.length - a.length);
  if (names.length === 0) return <p className="chat-body">{body}</p>;
  const alternatives = names.map((n) => `@${escapeRe(n)}`).join('|');
  const splitter = new RegExp(`(${alternatives})`);
  const isMention = new RegExp(`^(${alternatives})$`);
  return (
    <p className="chat-body">
      {body.split(splitter).map((part, i) => (isMention.test(part) ? <mark key={i} className="mention">{part}</mark> : <Fragment key={i}>{part}</Fragment>))}
    </p>
  );
}

function Composer({ candidates, onSend }: { candidates: PersonDto[]; onSend: SendFn }) {
  const [text, setText] = useState('');
  const [tagged, setTagged] = useState<Map<string, string>>(new Map()); // name → id
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [recording, setRecording] = useState<{ startedAt: number; elapsed: number } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorder = useRef<{ rec: MediaRecorder; chunks: Blob[]; cancel: boolean; timer: number } | null>(null);

  const matches = query === null ? [] : candidates.filter((p) => p.displayName.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  const updateQuery = (value: string, caret: number) => {
    const m = /(?:^|\s)@([^\s@]{0,30})$/.exec(value.slice(0, caret));
    setQuery(m ? m[1]! : null);
    setActive(0);
  };

  const pick = (p: PersonDto) => {
    const el = ref.current!;
    const caret = el.selectionStart;
    const before = text.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.displayName} `);
    const next = before + text.slice(caret);
    setText(next);
    setTagged(new Map(tagged).set(p.displayName, p.id));
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  const run = async (fn: () => Promise<void>) => {
    setSending(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setSending(false);
    }
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    // Only tags still present in the text count.
    const mentionIds = [...tagged].filter(([name]) => body.includes(`@${name}`)).map(([, id]) => id);
    await run(async () => {
      await onSend(body, mentionIds);
      setText('');
      setTagged(new Map());
    });
  };

  const sendFile = async (file: File) => {
    if (file.size > MAX_CHAT_FILE_BYTES) {
      setError(new UserError('הקובץ גדול מדי. אפשר לשלוח קבצים עד 3MB.'));
      return;
    }
    const body = text.trim();
    await run(async () => {
      const dataBase64 = await blobToBase64(file);
      await onSend(body, [], { kind: 'file', fileName: file.name, mimeType: file.type || 'application/octet-stream', dataBase64, durationMs: null });
      setText('');
      setTagged(new Map());
    });
  };

  const startRecording = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError(new UserError('הדפדפן הזה לא תומך בהקלטה.'));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(new UserError('אין גישה למיקרופון. צריך לאשר לאתר להשתמש במיקרופון.'));
      return;
    }
    const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32_000 });
    const startedAt = Date.now();
    const state = { rec, chunks: [] as Blob[], cancel: false, timer: 0 };
    rec.ondataavailable = (e) => e.data.size && state.chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      window.clearInterval(state.timer);
      recorder.current = null;
      setRecording(null);
      if (state.cancel) return;
      const mimeType = rec.mimeType || type || 'audio/webm';
      const blob = new Blob(state.chunks, { type: mimeType });
      const ext = mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm';
      void run(async () => {
        const dataBase64 = await blobToBase64(blob);
        await onSend('', [], { kind: 'voice', fileName: `הקלטה.${ext}`, mimeType, dataBase64, durationMs: Date.now() - startedAt });
      });
    };
    state.timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setRecording({ startedAt, elapsed });
      if (elapsed >= MAX_VOICE_MS) rec.stop();
    }, 250);
    recorder.current = state;
    rec.start();
    setRecording({ startedAt, elapsed: 0 });
  };

  const stopRecording = (cancel: boolean) => {
    const r = recorder.current;
    if (!r) return;
    r.cancel = cancel;
    r.rec.stop();
  };

  // Leaving the conversation while recording throws the recording away.
  useEffect(() => () => stopRecording(true), []);

  if (recording)
    return (
      <div className="chat-composer">
        <div className="chat-input recording">
          <button type="button" className="icon-btn" onClick={() => stopRecording(true)} aria-label="ביטול ההקלטה" title="ביטול">
            <Icon name="trash" size={20} />
          </button>
          <span className="rec-dot" aria-hidden="true" />
          <span className="rec-time">{formatDuration(recording.elapsed)}</span>
          <span className="muted small rec-label">מקליט…</span>
          <button type="button" className="chat-send" onClick={() => stopRecording(false)} aria-label="שליחת ההקלטה" title="שליחה">
            <Icon name="send" size={20} />
          </button>
        </div>
      </div>
    );

  return (
    <div className="chat-composer">
      {matches.length > 0 && (
        <ul className="mention-list" role="listbox">
          {matches.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button type="button" className={i === active ? 'active' : ''} onMouseDown={(e) => (e.preventDefault(), pick(p))}>
                <PersonTag avatarFor={p.id} name={p.displayName} jobTitle={p.jobTitle} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="chat-input">
        <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} disabled={sending} aria-label="צירוף קובץ" title="צירוף קובץ (עד 3MB)">
          <Icon name="attach" size={22} />
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void sendFile(f);
          }}
        />
        <textarea
          ref={ref}
          rows={1}
          maxLength={4000}
          value={text}
          placeholder={sending ? 'שולח…' : 'כתבו הודעה…'}
          onChange={(e) => {
            setText(e.target.value);
            updateQuery(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={(e) => {
            if (matches.length > 0) {
              if (e.key === 'ArrowDown') return e.preventDefault(), setActive((active + 1) % matches.length);
              if (e.key === 'ArrowUp') return e.preventDefault(), setActive((active - 1 + matches.length) % matches.length);
              if (e.key === 'Enter' || e.key === 'Tab') return e.preventDefault(), pick(matches[active]!);
              if (e.key === 'Escape') return setQuery(null);
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {text.trim() ? (
          <button type="button" className="chat-send" onClick={submit} disabled={sending} aria-label="שליחה" title="שליחה">
            <Icon name="send" size={20} />
          </button>
        ) : (
          <button type="button" className="chat-send" onClick={startRecording} disabled={sending} aria-label="הקלטת הודעה קולית" title="הקלטת הודעה קולית">
            <Icon name="mic" size={20} />
          </button>
        )}
      </div>
      <p className="chat-hint">Enter לשליחה · Shift+Enter לשורה חדשה{candidates.length ? ' · @ לתיוג' : ''} · 📎 קובץ עד 3MB · 🎤 הודעה קולית</p>
      <ErrorText error={error} />
    </div>
  );
}
