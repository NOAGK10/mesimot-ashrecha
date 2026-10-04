import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { MessageDto, PersonDto } from '@org/shared';
import { api, useMe } from '../api';
import { formatDateTime } from '../he';
import { ErrorText, PersonTag, usePeopleMap } from './common';

const POLL_MS = 5000;
const PAGE = 50;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A chat channel: the general chat (no taskId) or one task's conversation.
 * New messages arrive by polling every few seconds while the page is visible.
 * Typing "@" opens a list of people; tagged people get a notification on their home page.
 */
export function ChatPanel({ taskId, involvedIds }: { taskId?: string; involvedIds?: string[] }) {
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
  };

  // Who can be tagged: people who sign in; in a task chat, guests only if they are on the task.
  const candidates = useMemo(
    () =>
      people.list.filter(
        (p) => p.active && p.role !== null && p.id !== me.data?.personId && (!taskId || p.role !== 'guest' || involvedIds?.includes(p.id)),
      ),
    [people.list, me.data?.personId, taskId, involvedIds],
  );

  return (
    <div className="chat">
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
        {messages.map((m) => (
          <div key={m.id} id={`m${m.id}`} className={`chat-msg${m.authorPersonId === me.data?.personId ? ' mine' : ''}`}>
            <div className="chat-meta">
              <PersonTag id={m.authorPersonId} avatarFor={m.authorPersonId} name={people.name(m.authorPersonId)} jobTitle={people.jobTitle(m.authorPersonId)} />
              <span className="muted small">{formatDateTime(m.createdAt)}</span>
              {m.canDelete && (
                <button className="link small danger-text" onClick={() => remove(m)} aria-label="מחיקת ההודעה">
                  מחיקה
                </button>
              )}
            </div>
            {m.deleted ? <p className="muted small">ההודעה נמחקה</p> : <MessageBody body={m.body} mentioned={m.mentionIds.map((id) => people.name(id))} />}
          </div>
        ))}
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
      <textarea
        ref={ref}
        rows={2}
        maxLength={4000}
        value={text}
        placeholder="כתיבת הודעה… (@ כדי לתייג, Enter לשליחה, Shift+Enter לשורה חדשה)"
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
      <button onClick={submit} disabled={sending || !text.trim()}>
        שליחה
      </button>
      <ErrorText error={error} />
    </div>
  );
}
