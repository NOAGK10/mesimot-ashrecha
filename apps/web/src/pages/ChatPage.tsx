import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { ChatChannelDto, TaskDetailDto } from '@org/shared';
import { api, useMe, useTasks } from '../api';
import { ChatPanel } from '../components/ChatPanel';
import { usePeopleMap } from '../components/common';
import { Icon } from '../components/Sidebar';
import { shortTime } from '../he';

const GENERAL = 'general';

/**
 * Chat in two panes: the conversations on the side (the general chat and every task conversation),
 * the open conversation next to it. On a phone only one of the two is shown at a time.
 */
export function ChatPage() {
  const me = useMe();
  const people = usePeopleMap();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState(false);
  const channels = useQuery({
    queryKey: ['chat-channels'],
    queryFn: () => api<ChatChannelDto[]>('GET', '/api/chat/channels'),
    refetchInterval: 15_000,
  });

  const taskParam = params.get('task');
  const explicit = taskParam !== null || params.has(GENERAL);
  const openTaskId = taskParam; // null → the general chat
  const open = (taskId: string | null) => {
    setPicking(false);
    setParams(taskId ? { task: taskId } : { [GENERAL]: '1' });
  };

  const list = (channels.data ?? []).filter((c) => c.title.includes(search.trim()));
  const current = channels.data?.find((c) => c.taskId === openTaskId);
  // A brand-new conversation is not in the list yet; its title comes from the task itself.
  const task = useQuery({
    queryKey: ['task', openTaskId],
    queryFn: () => api<TaskDetailDto>('GET', `/api/tasks/${openTaskId}`),
    enabled: Boolean(openTaskId) && !current,
  });
  const title = openTaskId ? (current?.title ?? task.data?.title ?? 'שיחה על משימה') : "צ'אט כללי";

  const preview = (c: ChatChannelDto) => {
    if (!c.last) return 'עוד אין הודעות';
    if (c.last.deleted) return 'ההודעה נמחקה';
    const who = c.last.authorPersonId === me.data?.personId ? 'אני' : people.name(c.last.authorPersonId);
    return `${who}: ${c.last.body}`;
  };

  return (
    <div className={`chat-app${explicit ? ' has-open' : ''}`}>
      <aside className="chat-side">
        <div className="chat-side-head">
          <h1>צ'אט</h1>
          <button type="button" className="icon-btn" aria-label="שיחה חדשה על משימה" title="שיחה חדשה על משימה" onClick={() => setPicking((p) => !p)}>
            <Icon name="add" />
          </button>
        </div>
        <label className="chat-search">
          <Icon name="search" size={20} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש שיחה" aria-label="חיפוש שיחה" />
        </label>
        {picking && <TaskPicker onPick={open} onClose={() => setPicking(false)} />}
        <ul className="chat-channels">
          {list.map((c) => {
            const selected = c.taskId === openTaskId && (explicit || c.taskId === null);
            return (
              <li key={c.taskId ?? GENERAL}>
                <button type="button" className={`chat-channel${selected ? ' selected' : ''}`} onClick={() => open(c.taskId)}>
                  <ChannelAvatar taskId={c.taskId} />
                  <span className="chat-channel-text">
                    <span className="chat-channel-top">
                      <strong>{c.title}</strong>
                      {c.last && <span className="chat-channel-time">{shortTime(c.last.createdAt)}</span>}
                    </span>
                    <span className="chat-channel-last">{preview(c)}</span>
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
          <ChannelAvatar taskId={openTaskId} />
          <div className="chat-main-title">
            <strong>{title}</strong>
            <span className="muted small">{openTaskId ? 'שיחה על משימה' : 'כל הארגון'}</span>
          </div>
          {openTaskId && (
            <Link to={`/tasks/${openTaskId}`} className="icon-btn" aria-label="פתיחת המשימה" title="פתיחת המשימה">
              <Icon name="open" size={20} />
            </Link>
          )}
        </header>
        <ChatPanel key={openTaskId ?? GENERAL} taskId={openTaskId ?? undefined} fill />
      </section>
    </div>
  );
}

function ChannelAvatar({ taskId }: { taskId: string | null }) {
  return (
    <span className={`chat-channel-avatar${taskId ? ' task' : ''}`} aria-hidden="true">
      <Icon name={taskId ? 'tasks' : 'manage'} size={20} />
    </span>
  );
}

/** Start a conversation about any task the user can see. */
function TaskPicker({ onPick, onClose }: { onPick: (taskId: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const tasks = useTasks({ view: 'all', mine: false, q: q.trim() || undefined });
  return (
    <div className="chat-picker">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="על איזו משימה לדבר?" aria-label="חיפוש משימה" onKeyDown={(e) => e.key === 'Escape' && onClose()} />
      <ul>
        {(tasks.data ?? []).slice(0, 8).map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => onPick(t.id)}>
              {t.title}
            </button>
          </li>
        ))}
        {tasks.isSuccess && tasks.data.length === 0 && <li className="muted small">לא נמצאו משימות</li>}
      </ul>
    </div>
  );
}
