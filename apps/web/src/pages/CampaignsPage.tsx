import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { CampaignDto } from '@org/shared';
import { api, useApiMutation, useMe } from '../api';
import { ErrorText } from '../components/common';
import { Icon } from '../components/Sidebar';
import { formatDate } from '../he';

export const SECTION_LABEL = { video: 'סרטונים', song: 'שירים', plan: 'תכנונים', file: 'קבצים' } as const;
export const SECTION_ICON = { video: '🎬', song: '🎵', plan: '📋', file: '📎' } as const;

export function dateRange(c: { startDate: string | null; endDate: string | null }): string | null {
  if (c.startDate && c.endDate) return `${formatDate(c.startDate)} – ${formatDate(c.endDate)}`;
  if (c.startDate) return `מ־${formatDate(c.startDate)}`;
  if (c.endDate) return `עד ${formatDate(c.endDate)}`;
  return null;
}

/** All campaigns, newest first. Managers open new ones. */
export function CampaignsPage() {
  const me = useMe();
  const isManager = me.data?.access === 'manager';
  const list = useQuery({ queryKey: ['campaigns'], queryFn: () => api<CampaignDto[]>('GET', '/api/campaigns') });
  const [creating, setCreating] = useState(false);

  return (
    <section className="campaigns-page">
      <div className="campaigns-top">
        {isManager && !creating && (
          <button type="button" className="tasks-new" onClick={() => setCreating(true)}>
            <Icon name="add" size={20} /> קמפיין חדש
          </button>
        )}
      </div>
      {creating && <CampaignForm onDone={() => setCreating(false)} />}
      {list.isLoading && <p className="muted">טוען…</p>}
      <ErrorText error={list.error} />
      {list.data?.length === 0 && !creating && (
        <div className="calls-empty">
          <p>עוד אין קמפיינים.</p>
          <p className="muted small">{isManager ? 'לוחצים "קמפיין חדש", ובתוכו מעלים סרטונים, שירים, תכנונים וקבצים.' : 'מנהל יכול לפתוח קמפיין חדש.'}</p>
        </div>
      )}
      <ul className="plain campaigns-grid">
        {list.data?.map((c) => {
          const total = Object.values(c.counts).reduce((a, b) => a + b, 0);
          return (
            <li key={c.id}>
              <Link to={`/campaigns/${c.id}`} className="campaign-card">
                <strong className="campaign-name">{c.name}</strong>
                {dateRange(c) && <span className="muted small">{dateRange(c)}</span>}
                {c.description && <p className="campaign-desc">{c.description}</p>}
                <div className="campaign-counts">
                  {total === 0 ? (
                    <span className="muted small">עוד אין חומרים</span>
                  ) : (
                    (Object.keys(SECTION_LABEL) as (keyof typeof SECTION_LABEL)[])
                      .filter((s) => c.counts[s] > 0)
                      .map((s) => (
                        <span key={s} className="campaign-count">
                          {SECTION_ICON[s]} {c.counts[s]} {SECTION_LABEL[s]}
                        </span>
                      ))
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** New campaign, or editing an existing one. */
export function CampaignForm({ campaign, onDone }: { campaign?: CampaignDto; onDone: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState(campaign?.name ?? '');
  const [description, setDescription] = useState(campaign?.description ?? '');
  const [startDate, setStartDate] = useState(campaign?.startDate ?? '');
  const [endDate, setEndDate] = useState(campaign?.endDate ?? '');
  const body = () => ({ name, description, startDate: startDate || null, endDate: endDate || null });
  const save = useApiMutation(
    () => (campaign ? api('PATCH', `/api/campaigns/${campaign.id}`, body()) : api<CampaignDto>('POST', '/api/campaigns', body())),
    [['campaigns'], ['campaign']],
  );
  return (
    <form
      className="card stack campaign-form"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined, {
          onSuccess: (r) => {
            onDone();
            if (!campaign && r && typeof r === 'object' && 'id' in r) navigate(`/campaigns/${(r as CampaignDto).id}`);
          },
        });
      }}
    >
      <h2>{campaign ? 'עריכת הקמפיין' : 'קמפיין חדש'}</h2>
      <label>
        שם הקמפיין
        <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: קמפיין חנוכה תשפ״ז" autoFocus />
      </label>
      <label>
        תיאור (לא חובה)
        <textarea rows={2} maxLength={5000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="מה המטרה, למי פונים" />
      </label>
      <div className="row">
        <label>
          מתחיל ב־
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label>
          מסתיים ב־
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate || undefined} />
        </label>
      </div>
      <ErrorText error={save.error} />
      <div className="actions">
        <button type="submit" disabled={save.isPending || !name.trim()}>
          {campaign ? 'שמירה' : 'יצירה'}
        </button>
        <button type="button" className="secondary" onClick={onDone}>
          ביטול
        </button>
      </div>
    </form>
  );
}
