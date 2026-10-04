import { useState } from 'react';
import { Link } from 'react-router';
import type { TaskDto } from '@org/shared';
import { AVATAR_COLORS } from '@org/shared';
import { api, useApiMutation, useMe, useTaskCategories, useTasks } from '../api';
import { ErrorText, PersonTag, StatusBadge, usePeopleMap } from '../components/common';

const CLOSED = new Set(['completed', 'cancelled']);
const NONE = 'none';

/**
 * "לוח משימות": first write everything down quickly (title only), then sort each
 * task into a category column – by dragging it, or with the small list on the card.
 */
export function TaskBoardPage() {
  const me = useMe();
  const isManager = me.data?.access === 'manager';
  const canCreate = isManager || me.data?.access === 'member';
  const people = usePeopleMap();
  const categories = useTaskCategories();
  const tasks = useTasks({ view: 'all', mine: false });
  const [title, setTitle] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);

  const add = useApiMutation((t: string) =>
    api('POST', '/api/tasks', { title: t, description: '', ownerPersonId: me.data!.personId, dueDate: null, participantIds: [], categoryId: null, visibility: 'org' }),
  );
  const move = useApiMutation(({ t, categoryId }: { t: TaskDto; categoryId: string | null }) =>
    api('PATCH', `/api/tasks/${t.id}`, { version: t.version, categoryId }),
  );
  const addCategory = useApiMutation(
    (name: string) => api('POST', '/api/task-categories', { name, color: AVATAR_COLORS[(categories.data?.length ?? 0) % AVATAR_COLORS.length] }),
    [['task-categories']],
  );

  const canMove = (t: TaskDto) => isManager || t.createdByPersonId === me.data?.personId;
  const open = (tasks.data ?? []).filter((t) => !CLOSED.has(t.status));
  const columns = [
    { id: NONE, name: 'לא מסודרות', color: 'var(--muted)' },
    ...(categories.data ?? []).map((c) => ({ id: c.id, name: c.name, color: c.color })),
  ];
  const inColumn = (col: string) => open.filter((t) => (t.categoryId ?? NONE) === col);
  const drop = (col: string, id: string) => {
    const t = open.find((x) => x.id === id);
    const categoryId = col === NONE ? null : col;
    if (t && t.categoryId !== categoryId && canMove(t)) move.mutate({ t, categoryId });
  };

  return (
    <section>
      <div className="page-head">
        <h1>לוח משימות</h1>
      </div>
      <p className="muted">כותבים כאן את כל המשימות בקצרה, ואחר כך גוררים כל אחת לקטגוריה שלה.</p>

      {canCreate && (
        <form
          className="quick-add"
          onSubmit={(e) => {
            e.preventDefault();
            const t = title.trim();
            if (t) add.mutate(t, { onSuccess: () => setTitle('') });
          }}
        >
          <input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} placeholder="משימה חדשה… (Enter להוספה)" aria-label="משימה חדשה" />
          <button type="submit" disabled={add.isPending || !title.trim()}>
            הוספה
          </button>
        </form>
      )}
      <ErrorText error={add.error ?? move.error ?? addCategory.error} />

      {tasks.isLoading && <p className="muted">טוען…</p>}
      <div className="kanban">
        {columns.map((col) => (
          <div
            key={col.id}
            className={`kanban-col${dragOver === col.id ? ' drag-over' : ''}`}
            onDragOver={(e) => (e.preventDefault(), setDragOver(col.id))}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              drop(col.id, e.dataTransfer.getData('text/plain'));
            }}
          >
            <h2 style={{ borderColor: col.color }}>
              {col.name} <span className="muted small">({inColumn(col.id).length})</span>
            </h2>
            {inColumn(col.id).map((t) => (
              <div key={t.id} className="kanban-card" draggable={canMove(t)} onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}>
                <Link to={`/tasks/${t.id}`} className="task-card-title">
                  {t.visibility === 'private' && <span className="lock">🔒</span>}
                  {t.title}
                </Link>
                <div className="task-card-meta">
                  <StatusBadge status={t.status} />
                  <PersonTag avatarFor={t.ownerPersonId} name={people.name(t.ownerPersonId)} />
                </div>
                {canMove(t) && (
                  <select
                    className="kanban-move"
                    aria-label="העברה לקטגוריה"
                    value={t.categoryId ?? NONE}
                    onChange={(e) => drop(e.target.value, t.id)}
                  >
                    {columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.id === NONE ? 'בלי קטגוריה' : c.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
            {inColumn(col.id).length === 0 && <p className="muted small">{col.id === NONE ? 'הכול מסודר 🎉' : 'גוררים לכאן משימות'}</p>}
          </div>
        ))}
        {isManager && (
          <form
            className="kanban-col kanban-new"
            onSubmit={(e) => {
              e.preventDefault();
              const n = newCategory.trim();
              if (n) addCategory.mutate(n, { onSuccess: () => setNewCategory('') });
            }}
          >
            <h2>+ קטגוריה חדשה</h2>
            <input value={newCategory} maxLength={60} onChange={(e) => setNewCategory(e.target.value)} placeholder="שם הקטגוריה" aria-label="שם קטגוריה חדשה" />
            <button type="submit" className="secondary" disabled={addCategory.isPending || !newCategory.trim()}>
              יצירה
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
