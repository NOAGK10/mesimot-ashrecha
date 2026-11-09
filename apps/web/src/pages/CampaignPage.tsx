import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CampaignDetailDto, CampaignItemDto, CampaignSection } from '@org/shared';
import { MAX_CAMPAIGN_FILE_BYTES } from '@org/shared';
import { api, useGoogleStatus } from '../api';
import { ErrorText, UserError, usePeopleMap } from '../components/common';
import { Icon } from '../components/Sidebar';
import { connectGoogle, uploadToDrive } from '../google';
import { formatDate } from '../he';
import { CampaignForm, SECTION_ICON, SECTION_LABEL, dateRange } from './CampaignsPage';

const SECTIONS = Object.keys(SECTION_LABEL) as CampaignSection[];
const SINGULAR: Record<CampaignSection, string> = { video: 'סרטון', song: 'שיר', plan: 'תכנון', file: 'קובץ' };

/** YouTube id from the usual link shapes (watch, youtu.be, shorts, embed). */
function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null;
    if (u.searchParams.get('v')) return u.searchParams.get('v');
    const m = /^\/(shorts|embed|live)\/([\w-]{6,})/.exec(u.pathname);
    return m?.[2] ?? null;
  } catch {
    return null;
  }
}
/** Google Drive file id from a link (to play it in Drive's player). */
function driveId(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)drive\.google\.com$/.test(u.hostname)) return null;
    return /\/file\/d\/([\w-]{10,})/.exec(u.pathname)?.[1] ?? u.searchParams.get('id');
  } catch {
    return null;
  }
}

function embedOf(i: CampaignItemDto): string | null {
  if (i.source === 'drive') return `https://drive.google.com/file/d/${i.driveFileId}/preview`;
  if (i.source !== 'link') return null;
  const yt = youtubeId(i.url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(yt)}`;
  const d = driveId(i.url);
  return d ? `https://drive.google.com/file/d/${encodeURIComponent(d)}/preview` : null;
}

const sizeText = (n: number | null) => (n === null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);

/** One campaign: its videos, songs, plans and files. */
export function CampaignPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const section = (SECTIONS as string[]).includes(params.get('s') ?? '') ? (params.get('s') as CampaignSection) : null;
  const data = useQuery({ queryKey: ['campaign', id], queryFn: () => api<CampaignDetailDto>('GET', `/api/campaigns/${id}`) });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (data.isLoading) return <p className="muted">טוען…</p>;
  if (!data.data) return <ErrorText error={data.error} />;
  const c = data.data;
  const items = section ? c.items.filter((i) => i.section === section) : c.items;
  const total = c.items.length;

  const remove = async (i: CampaignItemDto) => {
    if (!confirm(`למחוק את "${i.title}"?${i.source === 'drive' ? ' הקובץ עצמו יישאר בגוגל דרייב.' : ''}`)) return;
    setError(null);
    try {
      await api('POST', `/api/campaign-items/${i.id}/delete`);
      await qc.invalidateQueries({ queryKey: ['campaign', id] });
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
    } catch (e) {
      setError(e);
    }
  };

  return (
    <section className="campaign-page">
      <Link to="/campaigns" className="back-link small">
        → כל הקמפיינים
      </Link>
      {editing ? (
        <CampaignForm campaign={c} onDone={() => setEditing(false)} />
      ) : (
        <div className="campaign-head">
          <div>
            <h1>{c.name}</h1>
            {dateRange(c) && <span className="muted small">{dateRange(c)}</span>}
            {c.description && <p className="campaign-desc">{c.description}</p>}
          </div>
          {c.canManage && (
            <div className="cc-actions">
              <button type="button" className="link" onClick={() => setEditing(true)}>
                עריכה
              </button>
              <button
                type="button"
                className="link danger-text"
                onClick={async () => {
                  if (!confirm(`למחוק את הקמפיין "${c.name}" וכל מה שבו? קבצים שנמצאים בגוגל דרייב יישארו שם.`)) return;
                  try {
                    await api('POST', `/api/campaigns/${c.id}/delete`);
                    await qc.invalidateQueries({ queryKey: ['campaigns'] });
                    navigate('/campaigns');
                  } catch (e) {
                    setError(e);
                  }
                }}
              >
                מחיקת הקמפיין
              </button>
            </div>
          )}
        </div>
      )}

      <div className="campaign-toolbar">
        <div className="cc-chips" role="tablist" aria-label="סוג">
          <button type="button" role="tab" aria-selected={!section} className={`cc-chip${!section ? ' active' : ''}`} onClick={() => setParams({})}>
            הכול <span>{total}</span>
          </button>
          {SECTIONS.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={section === s} className={`cc-chip${section === s ? ' active' : ''}`} onClick={() => setParams({ s })}>
              {SECTION_ICON[s]} {SECTION_LABEL[s]} <span>{c.counts[s]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="tasks-new" onClick={() => setAdding(true)}>
          <Icon name="add" size={20} /> הוספת {section ? SINGULAR[section] : 'חומר'}
        </button>
      </div>
      <ErrorText error={error} />

      {items.length === 0 && (
        <div className="calls-empty">
          <p>{section ? `אין עדיין ${SECTION_LABEL[section]} בקמפיין.` : 'הקמפיין עוד ריק.'}</p>
          <p className="muted small">מעלים קובץ מהמחשב או מהטלפון, או מדביקים קישור (יוטיוב, גוגל דרייב ועוד).</p>
        </div>
      )}

      {(section ? [section] : SECTIONS).map((s) => {
        const list = items.filter((i) => i.section === s);
        if (!list.length) return null;
        return (
          <div key={s} className="campaign-section">
            {!section && (
              <h2 className="campaign-section-title">
                {SECTION_ICON[s]} {SECTION_LABEL[s]}
              </h2>
            )}
            <ul className={`plain campaign-items s-${s}`}>
              {list.map((i) => (
                <ItemCard key={i.id} item={i} onDelete={() => remove(i)} />
              ))}
            </ul>
          </div>
        );
      })}

      {adding && <AddItemDialog campaignId={c.id} defaultSection={section ?? 'file'} onClose={() => setAdding(false)} />}
    </section>
  );
}

function ItemCard({ item: i, onDelete }: { item: CampaignItemDto; onDelete: () => void }) {
  const people = usePeopleMap();
  const embed = embedOf(i);
  const isUpload = i.source === 'upload';
  const mime = i.mimeType ?? '';
  const media =
    embed && (i.section === 'video' || i.section === 'song' || i.source === 'drive') ? (
      <div className={`campaign-embed${i.section === 'song' && i.source === 'drive' ? ' audio' : ''}`}>
        <iframe src={embed} title={i.title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen loading="lazy" />
      </div>
    ) : isUpload && mime.startsWith('video/') ? (
      <video className="campaign-video" src={i.url} controls preload="metadata" />
    ) : isUpload && mime.startsWith('audio/') ? (
      <audio className="campaign-audio" src={i.url} controls preload="metadata" />
    ) : isUpload && /^image\/(png|jpeg|gif|webp)$/.test(mime) ? (
      <a href={i.url} target="_blank" rel="noreferrer">
        <img className="campaign-image" src={i.url} alt={i.title} loading="lazy" />
      </a>
    ) : null;

  return (
    <li className={`campaign-item${media ? ' has-media' : ''}`}>
      {media}
      <div className="campaign-item-row">
        {!media && <span className="campaign-item-icon">{SECTION_ICON[i.section]}</span>}
        <div className="campaign-item-main">
          <strong>{i.title}</strong>
          {i.note && <span className="campaign-note">{i.note}</span>}
          <span className="muted small">
            {people.name(i.addedByPersonId)} · {formatDate(i.createdAt.slice(0, 10))}
            {i.fileName && i.source !== 'link' && <> · {i.fileName}</>}
            {i.sizeBytes ? <> · {sizeText(i.sizeBytes)}</> : null}
          </span>
        </div>
        <div className="campaign-item-actions">
          <a href={i.url} target="_blank" rel="noreferrer" className="link small">
            {isUpload ? 'הורדה' : 'פתיחה'}
          </a>
          {i.canDelete && (
            <button type="button" className="icon-btn finance-del" aria-label="מחיקה" title="מחיקה" onClick={onDelete}>
              <Icon name="trash" size={18} />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

const toBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

const guessSection = (f: File): CampaignSection | null =>
  f.type.startsWith('video/') ? 'video' : f.type.startsWith('audio/') ? 'song' : null;

function AddItemDialog({ campaignId, defaultSection, onClose }: { campaignId: string; defaultSection: CampaignSection; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const google = useGoogleStatus();
  const [section, setSection] = useState<CampaignSection>(defaultSection);
  const [mode, setMode] = useState<'file' | 'link'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  const big = !!file && file.size > MAX_CAMPAIGN_FILE_BYTES;
  const driveReady = !!google.data?.enabled && !!google.data.connected;
  const canConnect = !!google.data?.enabled && !google.data.connected;
  const blocked = mode === 'file' && big && !driveReady;

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const base = { section, title: title.trim(), note };
      if (mode === 'link') {
        await api('POST', `/api/campaigns/${campaignId}/items`, { ...base, source: 'link', url: url.trim() });
      } else if (!file) {
        throw new UserError('בחרו קובץ.');
      } else if (!big) {
        await api('POST', `/api/campaigns/${campaignId}/items`, { ...base, source: 'upload', fileName: file.name, mimeType: file.type || 'application/octet-stream', dataBase64: await toBase64(file) });
      } else {
        setProgress(0);
        const { id } = await uploadToDrive(file, setProgress).catch(() => {
          throw new UserError('ההעלאה לגוגל דרייב נכשלה. בדקו את החיבור לאינטרנט ונסו שוב.');
        });
        await api('POST', `/api/campaigns/${campaignId}/items`, {
          ...base,
          source: 'drive',
          driveFileId: id,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        });
      }
      await qc.invalidateQueries({ queryKey: ['campaign', campaignId] });
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      (ref.current?.close(), onClose());
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
      setProgress(null);
    }
  };

  return (
    <dialog ref={ref} className="task-dialog" onClose={onClose} onClick={(e) => e.target === ref.current && !pending && (ref.current?.close(), onClose())} aria-labelledby="add-item-title">
      <form
        className="task-dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id="add-item-title">הוספה לקמפיין</h2>
        <div className="cc-chips" role="radiogroup" aria-label="סוג">
          {SECTIONS.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={section === s} className={`cc-chip${section === s ? ' active' : ''}`} onClick={() => setSection(s)}>
              {SECTION_ICON[s]} {SINGULAR[s]}
            </button>
          ))}
        </div>
        <div className="segmented" role="tablist" aria-label="מאיפה">
          <button type="button" role="tab" aria-selected={mode === 'file'} className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>
            העלאת קובץ
          </button>
          <button type="button" role="tab" aria-selected={mode === 'link'} className={mode === 'link' ? 'active' : ''} onClick={() => setMode('link')}>
            קישור
          </button>
        </div>

        {mode === 'file' ? (
          <div className="stack">
            <label className="file-pick">
              <input
                type="file"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''));
                  const g = f && guessSection(f);
                  if (g) setSection(g);
                }}
              />
            </label>
            {file && (
              <span className="muted small">
                {file.name} · {sizeText(file.size)}
                {big && driveReady && ' · קובץ גדול: יעלה לגוגל דרייב שלך, ויהיה זמין לצפייה לכל מי שיש לו קישור'}
              </span>
            )}
            {blocked && (
              <div className="campaign-big">
                <p className="small">
                  הקובץ גדול מ־3MB. קבצים גדולים עולים לגוגל דרייב{canConnect ? ', וצריך לחבר אותו פעם אחת.' : '. אפשר גם להעלות אותו ליוטיוב או לגוגל דרייב ולהוסיף כאן קישור.'}
                </p>
                {canConnect && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={async () => {
                      try {
                        await connectGoogle(google.data!);
                        await qc.invalidateQueries({ queryKey: ['google-status'] });
                      } catch (e) {
                        setError(e instanceof Error && e.message === 'cancelled' ? null : e);
                      }
                    }}
                  >
                    חיבור גוגל דרייב
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <label className="float-field">
            <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder=" " dir="ltr" />
            <span>קישור (יוטיוב, גוגל דרייב או כל כתובת)</span>
          </label>
        )}

        <label className="float-field">
          <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} placeholder=" " />
          <span>כותרת</span>
        </label>
        <label className="float-field">
          <textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder=" " />
          <span>הערה (לא חובה)</span>
        </label>

        {progress !== null && (
          <div className="upload-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
            <span>מעלה לגוגל דרייב… {Math.round(progress * 100)}%</span>
          </div>
        )}
        <ErrorText error={error} />
        <div className="task-dialog-actions">
          <button type="submit" disabled={pending || blocked || !title.trim() || (mode === 'file' ? !file : !url.trim())}>
            {pending ? 'מעלה…' : 'הוספה'}
          </button>
          <button type="button" className="link" disabled={pending} onClick={() => (ref.current?.close(), onClose())}>
            ביטול
          </button>
        </div>
      </form>
    </dialog>
  );
}
