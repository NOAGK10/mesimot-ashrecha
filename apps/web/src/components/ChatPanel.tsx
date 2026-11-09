import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MessageDto, PersonDto } from '@org/shared';
import { api, useMe } from '../api';
import { chatDayLabel, clockTime } from '../he';
import { Avatar } from './Avatar';
import { Icon } from './Sidebar';
import { ErrorText, PersonTag, usePeopleMap } from './common';

const POLL_MS = 5000;
const PAGE = 50;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A chat channel: the general chat (no taskId) or one task's conversation.
 * New messages arrive by polling every few seconds while the page is visible.
 * Typing "@" opens a list of people; tagged people get a notification on their home page.
 */
export function ChatPanel({ taskId, privateTo, fill = false }: { taskId?: string; privateTo?: string[]; fill?: boolean }) {
  const me = useMe();
  const people = usePeopleMap();
  const qc = useQueryClient();
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const base = taskId ? `/api/chat/messages?taskId=${taskId}` : '/api/chat/messages?';
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

  // Poll for new messages while the tab is visible.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      api<MessageDto[]>('GET', `${base}&after=${lastId ?? 0}`).then(merge, () => undefined);
    };
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [base, lastId, merge]);

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
    merge([{ ...m, deleted: true, body: '', mentionIds: [], canDelete: false }]);
  };

  const send = async (body: string, mentionIds: string[]) => {
    const m = await api<MessageDto>('POST', '/api/chat/messages', { body, taskId: taskId ?? null, mentionIds });
    stickToBottom.current = true;
    merge([m]);
    void qc.invalidateQueries({ queryKey: ['recent-chat'] });
    void qc.invalidateQueries({ queryKey: ['chat-channels'] });
  };

  // Who can be tagged: people who sign in; in a private task only the people on it and managers.
  const candidates = useMemo(
    () =>
      people.list.filter(
        (p) => p.active && p.role !== null && p.id !== me.data?.personId && (!privateTo || p.role === 'manager' || privateTo.includes(p.id)),
      ),
    [people.list, me.data?.personId, privateTo],
  );

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
        {messages.length === 0 && <p className="muted small chat-empty">{taskId ? 'עוד אין הודעות על המשימה הזו.' : 'עוד אין הודעות. אפשר להתחיל!'}</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const day = new Date(m.createdAt).toDateString();
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== day;
          // Consecutive messages from the same person on the same day share one picture and name.
          const continued = !newDay && prev?.authorPersonId === m.authorPersonId;
          const mine = m.authorPersonId === me.data?.personId;
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
                  {!mine && !continued && (
                    <div className="chat-author">
                      {people.name(m.authorPersonId)}
                      {people.jobTitle(m.authorPersonId) && <span className="chat-job"> · {people.jobTitle(m.authorPersonId)}</span>}
                    </div>
                  )}
                  {m.deleted ? <p className="chat-body muted">ההודעה נמחקה</p> : <MessageBody body={m.body} mentioned={m.mentionIds.map((id) => people.name(id))} />}
                  <div className="chat-foot">
                    {m.canDelete && (
                      <button className="link chat-delete" onClick={() => remove(m)} aria-label="מחיקת ההודעה">
                        מחיקה
                      </button>
                    )}
                    <span className="chat-time">{clockTime(m.createdAt)}</span>
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

function Composer({ candidates, onSend }: { candidates: PersonDto[]; onSend: (body: string, mentionIds: string[]) => Promise<void> }) {
  const [text, setText] = useState('');
  const [tagged, setTagged] = useState<Map<string, string>>(new Map()); // name → id
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

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

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    // Only tags still present in the text count.
    const mentionIds = [...tagged].filter(([name]) => body.includes(`@${name}`)).map(([, id]) => id);
    setSending(true);
    setError(null);
    try {
      await onSend(body, mentionIds);
      setText('');
      setTagged(new Map());
    } catch (e) {
      setError(e);
    } finally {
      setSending(false);
    }
  };

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
        <textarea
          ref={ref}
          rows={1}
          maxLength={4000}
          value={text}
          placeholder="כתבו הודעה…"
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
        <button type="button" className="chat-send" onClick={submit} disabled={sending || !text.trim()} aria-label="שליחה" title="שליחה">
          <Icon name="send" size={20} />
        </button>
      </div>
      <p className="chat-hint">Enter לשליחה · Shift+Enter לשורה חדשה · @ לתיוג</p>
      <ErrorText error={error} />
    </div>
  );
}
