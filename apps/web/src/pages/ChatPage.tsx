import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ChatChannelDto, TaskDetailDto } from '@org/shared';
import { api, useChatChannels, useMe, useTasks } from '../api';
import { Avatar } from '../components/Avatar';
import { ChatPanel } from '../components/ChatPanel';
import { usePeopleMap } from '../components/common';
import { Icon } from '../components/Sidebar';
import { shortTime } from '../he';

const GENERAL = 'general';

/**
 * Chat in two panes: the conversations on the side (the general chat, task conversations and
 * private conversations), the open conversation next to it. On a phone one pane at a time.
 */
export function ChatPage() {
  const me = useMe();
  const people = usePeopleMap();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState(false);
  const channels = useChatChannels();

  const openTaskId = params.get('task');
  const openPersonId = params.get('with');
  const explicit = openTaskId !== null || openPersonId !== null || params.has(GENERAL);
  const isOpen = (c: ChatChannelDto) => c.taskId === openTaskId && c.withPersonId === openPersonId;
  const open = (c: { taskId?: string | null; withPersonId?: string | null }) => {
    setPicking(false);
    setParams(c.taskId ? { task: c.taskId } : c.withPersonId ? { with: c.withPersonId } : { [GENERAL]: '1' });
  };

  const list = (channels.data ?? []).filter((c) => c.title.includes(search.trim()));
  const current = channels.data?.find(isOpen);
  // A brand-new conversation is not in the list yet; its title comes from the task or the person.
  const task = useQuery({
    queryKey: ['task', openTaskId],
    queryFn: () => api<TaskDetailDto>('GET', `/api/tasks/${openTaskId}`),
    enabled: Boolean(openTaskId) && !current,
  });
  const title = openTaskId
    ? (current?.title ?? task.data?.title ?? 'שיחה על משימה')
    : openPersonId
      ? people.name(openPersonId)
      : "צ'אט כללי";
  const subtitle = openTaskId ? 'שיחה על משימה' : openPersonId ? `${people.jobTitle(openPersonId) || 'שיחה פרטית'} · 🔒 רק שניכם` : 'כל הארגון';

  const preview = (c: ChatChannelDto) => {
    if (!c.last) return 'עוד אין הודעות';
    if (c.last.deleted) return 'ההודעה נמחקה';
    const text = c.last.body || (c.last.attachmentKind === 'voice' ? '🎤 הודעה קולית' : c.last.attachmentKind === 'file' ? '📎 קובץ' : '');
    if (c.withPersonId) return c.last.authorPersonId === me.data?.personId ? `אני: ${text}` : text;
    const who = c.last.authorPersonId === me.data?.personId ? 'אני' : people.name(c.last.authorPersonId);
    return `${who}: ${text}`;
  };

  return (
    <div className={`chat-app${explicit ? ' has-open' : ''}`}>
      <aside className="chat-side">
        <div className="chat-side-head">
          <h1>צ'אט</h1>
          <button type="button" className="icon-btn" aria-label="שיחה חדשה" title="שיחה חדשה" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
            <Icon name="add" />
          </button>
        </div>
        <label className="chat-search">
          <Icon name="search" size={20} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש שיחה" aria-label="חיפוש שיחה" />
        </label>
        {picking && <NewConversation onPick={open} onClose={() => setPicking(false)} />}
        <ul className="chat-channels">
          {list.map((c) => {
            const selected = isOpen(c) && (explicit || (c.taskId === null && c.withPersonId === null));
            return (
              <li key={c.taskId ?? c.withPersonId ?? GENERAL}>
                <button type="button" className={`chat-channel${selected ? ' selected' : ''}`} onClick={() => open(c)}>
                  <ChannelAvatar taskId={c.taskId} personId={c.withPersonId} name={c.title} />
                  <span className="chat-channel-text">
                    <span className="chat-channel-top">
                      <strong>{c.title}</strong>
                      {c.last && <span className={`chat-channel-time${c.unread ? ' unread' : ''}`}>{shortTime(c.last.createdAt)}</span>}
                    </span>
                    <span className="chat-channel-bottom">
                      <span className="chat-channel-last">{preview(c)}</span>
                      {c.unread > 0 && !selected && (
                        <span className="chat-unread" aria-label={`${c.unread} הודעות שלא נקראו`}>
                          {c.unread > 99 ? '99+' : c.unread}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
          {channels.isSuccess && list.length === 0 && <li className="muted small chat-none">לא נמצאו שיחות</li>}
        </ul>
      </aside>

      <section className="chat-main">
        <header className="chat-main-head">
          <button type="button" className="icon-btn chat-back" aria-label="חזרה לרשימת השיחות" onClick={() => setParams({})}>
            <Icon name="back" />
          </button>
          <ChannelAvatar taskId={openTaskId} personId={openPersonId} name={title} />
          <div className="chat-main-title">
            <strong>{title}</strong>
            <span className="muted small">{subtitle}</span>
          </div>
          {openTaskId && (
            <Link to={`/tasks/${openTaskId}`} className="icon-btn" aria-label="פתיחת המשימה" title="פתיחת המשימה">
              <Icon name="open" size={20} />
            </Link>
          )}
          {openPersonId && (
            <Link to={`/people/${openPersonId}`} className="icon-btn" aria-label="הפרופיל" title="הפרופיל">
              <Icon name="people" size={20} />
            </Link>
          )}
        </header>
        <ChatPanel
          key={openTaskId ?? openPersonId ?? GENERAL}
          taskId={openTaskId ?? undefined}
          withPersonId={openPersonId ?? undefined}
          fill
        />
      </section>
    </div>
  );
}

function ChannelAvatar({ taskId, personId, name }: { taskId: string | null; personId: string | null; name: string }) {
  if (personId) return <Avatar personId={personId} name={name} size={40} />;
  return (
    <span className={`chat-channel-avatar${taskId ? ' task' : ''}`} aria-hidden="true">
      <Icon name={taskId ? 'tasks' : 'manage'} size={20} />
    </span>
  );
}

/** Start a private conversation with someone, or a conversation about a task. */
function NewConversation({ onPick, onClose }: { onPick: (c: { taskId?: string; withPersonId?: string }) => void; onClose: () => void }) {
  const me = useMe();
  const people = usePeopleMap();
  const [tab, setTab] = useState<'person' | 'task'>('person');
  const [q, setQ] = useState('');
  const tasks = useTasks({ view: 'all', mine: false, q: q.trim() || undefined });
  const someone = people.list
    .filter((p) => p.active && p.role !== null && p.id !== me.data?.personId && p.displayName.includes(q.trim()))
    .slice(0, 8);
  return (
    <div className="chat-picker">
      <div className="segmented small-seg" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'person'} className={tab === 'person' ? 'active' : ''} onClick={() => setTab('person')}>
          עם אדם
        </button>
        <button type="button" role="tab" aria-selected={tab === 'task'} className={tab === 'task' ? 'active' : ''} onClick={() => setTab('task')}>
          על משימה
        </button>
      </div>
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={tab === 'person' ? 'עם מי לדבר?' : 'על איזו משימה לדבר?'}
        aria-label={tab === 'person' ? 'חיפוש אדם' : 'חיפוש משימה'}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      />
      <ul>
        {tab === 'person'
          ? someone.map((p) => (
              <li key={p.id}>
                <button type="button" className="picker-person" onClick={() => onPick({ withPersonId: p.id })}>
                  <Avatar personId={p.id} name={p.displayName} size={28} />
                  <span>
                    {p.displayName}
                    {p.jobTitle && <span className="muted small"> · {p.jobTitle}</span>}
                  </span>
                </button>
              </li>
            ))
          : (tasks.data ?? []).slice(0, 8).map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => onPick({ taskId: t.id })}>
                  {t.title}
                </button>
              </li>
            ))}
        {tab === 'person' && someone.length === 0 && <li className="muted small">לא נמצאו אנשים</li>}
        {tab === 'task' && tasks.isSuccess && tasks.data.length === 0 && <li className="muted small">לא נמצאו משימות</li>}
      </ul>
    </div>
  );
}
