import { useState } from 'react';
import { Link } from 'react-router';
import type { DocumentDto } from '@org/shared';
import { api, useApiMutation, useCategories, useDocuments, useTasks } from '../api';
import { AddDocument, KIND_ICON, KIND_LABEL } from '../components/AddDocument';
import { ErrorText } from '../components/common';
import { GoogleConnect } from '../components/GoogleConnect';
import { formatDateTime } from '../he';

const KEYS = [['documents'], ['categories']];

export function DocumentsPage() {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const docs = useDocuments(includeArchived);
  const categories = useCategories();
  const tasks = useTasks({ view: 'all', mine: false, includeArchived: true });
  const taskTitle = new Map((tasks.data ?? []).map((t) => [t.id, t.title]));

  const update = useApiMutation(({ d, patch }: { d: DocumentDto; patch: Record<string, unknown> }) => api('PATCH', `/api/documents/${d.id}`, patch), KEYS);

  const visible = (docs.data ?? []).filter((d) => filter === 'all' || (filter === 'none' ? !d.categoryId : d.categoryId === filter));
  const groups = [
    ...(categories.data ?? []).map((c) => ({ id: c.id, name: c.name })),
    { id: null as string | null, name: 'ללא קטגוריה' },
  ]
    .map((g) => ({ ...g, docs: visible.filter((d) => d.categoryId === g.id) }))
    .filter((g) => g.docs.length > 0);

  return (
    <section>
      <div className="page-head">
        <h1>מסמכים</h1>
        <Link className="button secondary-link" to="/import">
          ייבוא משימות מגיליון
        </Link>
      </div>
      <p className="muted small">המסמכים עצמם נשארים ב-Google. כאן מסדרים אותם לפי קטגוריות ומקשרים אותם למשימות.</p>
      <GoogleConnect />
      <div className="card">
        <h2>הוספת מסמך</h2>
        <AddDocument />
      </div>

      <div className="filters">
        <label>
          קטגוריה
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">הכל</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="none">ללא קטגוריה</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          כולל ארכיון
        </label>
      </div>

      {docs.data?.length === 0 && <p className="empty">עוד אין מסמכים.</p>}
      {groups.map((g) => (
        <div key={g.id ?? 'none'} className="card">
          <h2>{g.name}</h2>
          <ul className="doc-list">
            {g.docs.map((d) => (
              <li key={d.id} className={d.archivedAt ? 'archived' : ''}>
                <div className="doc-main">
                  <span aria-hidden>{KIND_ICON[d.kind]}</span>
                  <a href={d.url} target="_blank" rel="noreferrer">
                    {d.title}
                  </a>
                  <span className="tag">{KIND_LABEL[d.kind]}</span>
                </div>
                <div className="doc-meta small muted">
                  {d.taskIds.length > 0 ? (
                    <>
                      משימות:{' '}
                      {d.taskIds.slice(0, 3).map((id, i) => (
                        <span key={id}>
                          {i > 0 && ', '}
                          <Link to={`/tasks/${id}`}>{taskTitle.get(id) ?? 'משימה'}</Link>
                        </span>
                      ))}
                      {d.taskIds.length > 3 && ` ועוד ${d.taskIds.length - 3}`}
                    </>
                  ) : (
                    'לא מקושר למשימות'
                  )}{' '}
                  · נוסף {formatDateTime(d.createdAt)}
                </div>
                <div className="doc-actions">
                  <select value={d.categoryId ?? ''} onChange={(e) => update.mutate({ d, patch: { categoryId: e.target.value || null } })} aria-label="קטגוריה">
                    <option value="">ללא קטגוריה</option>
                    {categories.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button className="link" onClick={() => update.mutate({ d, patch: { archived: !d.archivedAt } })}>
                    {d.archivedAt ? 'החזרה' : 'לארכיון'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <ErrorText error={update.error} />
      <Categories />
    </section>
  );
}

function Categories() {
  const categories = useCategories();
  const [name, setName] = useState('');
  const add = useApiMutation(() => api('POST', '/api/document-categories', { name }), KEYS);
  const rename = useApiMutation(({ id, name }: { id: string; name: string }) => api('PATCH', `/api/document-categories/${id}`, { name }), KEYS);
  const remove = useApiMutation((id: string) => api('DELETE', `/api/document-categories/${id}`), [['categories'], ['documents']]);
  return (
    <details className="card">
      <summary>ניהול קטגוריות</summary>
      <ul className="plain">
        {categories.data?.map((c) => (
          <li key={c.id} className="row-inline">
            <span>{c.name}</span>
            <button className="link" onClick={() => { const n = prompt('שם חדש', c.name); if (n?.trim()) rename.mutate({ id: c.id, name: n.trim() }); }}>
              שינוי שם
            </button>
            <button className="link danger-text" onClick={() => confirm(`למחוק את הקטגוריה "${c.name}"? המסמכים יישארו, ללא קטגוריה.`) && remove.mutate(c.id)}>
              מחיקה
            </button>
          </li>
        ))}
      </ul>
      <form className="row wrap" onSubmit={(e) => (e.preventDefault(), add.mutate(undefined, { onSuccess: () => setName('') }))}>
        <label>
          קטגוריה חדשה
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: כספים, חוזים, פרוטוקולים" />
        </label>
        <button type="submit">הוספה</button>
      </form>
      <ErrorText error={add.error ?? rename.error} />
    </details>
  );
}
