import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DocumentDto } from '@org/shared';
import { api, upload, useCategories, useGoogleStatus } from '../api';
import { pickFromDrive } from '../google';
import { ErrorText } from './common';

const KEYS = [['documents'], ['task'], ['tasks']];

/** Three ways to add a document: pick from Drive, paste a link, upload a file (stored in Drive). */
export function AddDocument({ taskId, onDone }: { taskId?: string; onDone?: () => void }) {
  const google = useGoogleStatus();
  const categories = useCategories();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'none' | 'link'>('none');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const connected = google.data?.enabled && google.data.connected;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await Promise.all(KEYS.map((queryKey) => qc.invalidateQueries({ queryKey })));
      setMode('none');
      setUrl('');
      setTitle('');
      onDone?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const base = { categoryId: categoryId || null, ...(taskId ? { taskId } : {}) };

  return (
    <div className="stack">
      <div className="actions">
        {connected && (
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const id = await pickFromDrive(google.data!, 'any');
                if (id) await api<DocumentDto>('POST', '/api/documents', { ...base, googleFileId: id });
              })
            }
          >
            בחירה מ-Google Drive
          </button>
        )}
        <button className="secondary" disabled={busy} onClick={() => setMode(mode === 'link' ? 'none' : 'link')}>
          הוספת קישור
        </button>
        {connected && (
          <>
            <button className="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
              העלאת קובץ ל-Drive
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".docx,.doc,.xlsx,.xls,.csv,.pdf,.txt"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) run(() => upload('/api/documents/upload', file, { categoryId, ...(taskId ? { taskId } : {}) }));
              }}
            />
          </>
        )}
        {!taskId && categories.data && categories.data.length > 0 && (
          <label className="inline">
            קטגוריה
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">ללא</option>
              {categories.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {busy && <p className="muted small">רגע…</p>}
      {mode === 'link' && (
        <form
          className="row wrap"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api('POST', '/api/documents', { ...base, url, ...(title ? { title } : {}) }));
          }}
        >
          <label>
            קישור
            <input type="url" dir="ltr" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/…" />
          </label>
          <label>
            שם (לא חובה)
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <button type="submit" disabled={busy}>
            הוספה
          </button>
        </form>
      )}
      <ErrorText error={error} />
    </div>
  );
}

export const KIND_ICON: Record<DocumentDto['kind'], string> = { google_doc: '📄', google_sheet: '📊', link: '🔗' };
export const KIND_LABEL: Record<DocumentDto['kind'], string> = { google_doc: 'מסמך', google_sheet: 'גיליון', link: 'קישור' };
