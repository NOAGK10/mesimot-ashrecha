import { and, desc, eq, sql } from 'drizzle-orm';
import type { CampaignDetailDto, CampaignDto, CampaignItemDto, CampaignItemInput, CampaignSection } from '@org/shared';
import { CAMPAIGN_SECTIONS, MAX_CAMPAIGN_FILE_BYTES } from '@org/shared';
import type { AppContext } from '../../context';
import { campaignFiles, campaignItems, campaigns } from '../../db/schema';
import { forbidden, invalid, notFound } from '../../lib/errors';
import { policy } from '../identity/policy';
import type { Principal } from '../identity/principal';

/**
 * Campaigns: a manager opens a campaign; the team (managers and members) sees it and adds its videos,
 * songs, plans and files. Small files are stored on the site; large ones live in Google Drive (uploaded
 * from the browser) or are added as links. Whoever added an item, or a manager, may remove it.
 */

function assertTeam(p: Principal) {
  if (!policy.canCreateTask(p)) throw forbidden();
}

type Row = typeof campaigns.$inferSelect;
const emptyCounts = (): Record<CampaignSection, number> => Object.fromEntries(CAMPAIGN_SECTIONS.map((s) => [s, 0])) as Record<CampaignSection, number>;

function toDto(c: Row, counts = emptyCounts()): CampaignDto {
  return { id: c.id, name: c.name, description: c.description, startDate: c.startDate, endDate: c.endDate, createdAt: c.createdAt.toISOString(), counts };
}

async function load(ctx: AppContext, p: Principal, id: string): Promise<Row> {
  const [c] = await ctx.db.select().from(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.orgId, p.orgId)));
  if (!c) throw notFound('Campaign');
  return c;
}

export async function listCampaigns(ctx: AppContext, p: Principal): Promise<CampaignDto[]> {
  assertTeam(p);
  const rows = await ctx.db.select().from(campaigns).where(eq(campaigns.orgId, p.orgId)).orderBy(desc(campaigns.createdAt));
  const counts = await ctx.db
    .select({ campaignId: campaignItems.campaignId, section: campaignItems.section, n: sql<number>`count(*)::int` })
    .from(campaignItems)
    .innerJoin(campaigns, eq(campaigns.id, campaignItems.campaignId))
    .where(eq(campaigns.orgId, p.orgId))
    .groupBy(campaignItems.campaignId, campaignItems.section);
  return rows.map((c) => {
    const k = emptyCounts();
    for (const r of counts) if (r.campaignId === c.id) k[r.section] = Number(r.n);
    return toDto(c, k);
  });
}

export async function getCampaign(ctx: AppContext, p: Principal, id: string): Promise<CampaignDetailDto> {
  assertTeam(p);
  const c = await load(ctx, p, id);
  const items = await ctx.db.select().from(campaignItems).where(eq(campaignItems.campaignId, id)).orderBy(desc(campaignItems.createdAt));
  const counts = emptyCounts();
  for (const i of items) counts[i.section]++;
  return {
    ...toDto(c, counts),
    canManage: policy.isManager(p),
    items: items.map(
      (i): CampaignItemDto => ({
        id: i.id,
        section: i.section,
        source: i.source,
        title: i.title,
        note: i.note,
        url:
          i.source === 'upload'
            ? `/api/campaign-items/${i.id}/file`
            : i.source === 'drive'
              ? `https://drive.google.com/file/d/${i.driveFileId}/view`
              : i.url!,
        driveFileId: i.driveFileId,
        fileName: i.fileName,
        mimeType: i.mimeType,
        sizeBytes: i.sizeBytes === null ? null : Number(i.sizeBytes),
        addedByPersonId: i.addedByPersonId,
        createdAt: i.createdAt.toISOString(),
        canDelete: policy.isManager(p) || i.addedByPersonId === p.personId,
      }),
    ),
  };
}

export async function createCampaign(ctx: AppContext, p: Principal, input: { name: string; description: string; startDate: string | null; endDate: string | null }): Promise<CampaignDto> {
  if (!policy.isManager(p)) throw forbidden();
  if (input.startDate && input.endDate && input.endDate < input.startDate) throw invalid('The end date is before the start date');
  const [row] = await ctx.db.insert(campaigns).values({ ...input, orgId: p.orgId, createdByPersonId: p.personId, createdAt: ctx.now() }).returning();
  return toDto(row!);
}

export async function updateCampaign(ctx: AppContext, p: Principal, id: string, input: { name: string; description: string; startDate: string | null; endDate: string | null }): Promise<void> {
  if (!policy.isManager(p)) throw forbidden();
  await load(ctx, p, id);
  if (input.startDate && input.endDate && input.endDate < input.startDate) throw invalid('The end date is before the start date');
  await ctx.db.update(campaigns).set(input).where(eq(campaigns.id, id));
}

/** Deletes the campaign and everything stored on the site for it. Files in Google Drive are not touched. */
export async function deleteCampaign(ctx: AppContext, p: Principal, id: string): Promise<void> {
  if (!policy.isManager(p)) throw forbidden();
  await load(ctx, p, id);
  await ctx.db.delete(campaigns).where(eq(campaigns.id, id));
}

export async function addCampaignItem(ctx: AppContext, p: Principal, campaignId: string, input: CampaignItemInput): Promise<void> {
  assertTeam(p);
  await load(ctx, p, campaignId);
  const base = { campaignId, section: input.section, source: input.source, title: input.title, note: input.note, addedByPersonId: p.personId, createdAt: ctx.now() };
  if (input.source === 'link') {
    await ctx.db.insert(campaignItems).values({ ...base, url: input.url });
    return;
  }
  if (input.source === 'drive') {
    await ctx.db.insert(campaignItems).values({ ...base, driveFileId: input.driveFileId, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes });
    return;
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.dataBase64)) throw invalid('The file is damaged');
  const size = Math.floor((input.dataBase64.length * 3) / 4) - (input.dataBase64.endsWith('==') ? 2 : input.dataBase64.endsWith('=') ? 1 : 0);
  if (size === 0) throw invalid('The file is empty');
  if (size > MAX_CAMPAIGN_FILE_BYTES) throw invalid('The file is too large (up to 3 MB on the site; larger files go to Google Drive)');
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(campaignItems)
      .values({ ...base, fileName: input.fileName.split(/[\\/]/).pop()!.slice(0, 200) || 'קובץ', mimeType: input.mimeType, sizeBytes: size })
      .returning({ id: campaignItems.id });
    await tx.insert(campaignFiles).values({ itemId: row!.id, dataBase64: input.dataBase64 });
  });
}

async function loadItem(ctx: AppContext, p: Principal, id: string) {
  const [row] = await ctx.db
    .select({ item: campaignItems, orgId: campaigns.orgId })
    .from(campaignItems)
    .innerJoin(campaigns, eq(campaigns.id, campaignItems.campaignId))
    .where(eq(campaignItems.id, id));
  if (!row || row.orgId !== p.orgId) throw notFound('Item');
  return row.item;
}

export async function deleteCampaignItem(ctx: AppContext, p: Principal, id: string): Promise<void> {
  assertTeam(p);
  const item = await loadItem(ctx, p, id);
  if (!policy.isManager(p) && item.addedByPersonId !== p.personId) throw forbidden();
  await ctx.db.delete(campaignItems).where(eq(campaignItems.id, id));
}

export async function getCampaignFile(ctx: AppContext, p: Principal, id: string): Promise<{ fileName: string; mimeType: string; data: Buffer }> {
  assertTeam(p);
  const item = await loadItem(ctx, p, id);
  const [f] = await ctx.db.select().from(campaignFiles).where(eq(campaignFiles.itemId, id));
  if (!f) throw notFound('File');
  return { fileName: item.fileName ?? 'קובץ', mimeType: item.mimeType ?? 'application/octet-stream', data: Buffer.from(f.dataBase64, 'base64') };
}
