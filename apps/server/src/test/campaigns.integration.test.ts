import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { campaignItemSchema } from '@org/shared';
import {
  addCampaignItem,
  createCampaign,
  deleteCampaign,
  deleteCampaignItem,
  getCampaign,
  getCampaignFile,
  listCampaigns,
  updateCampaign,
} from '../modules/campaigns/campaign-service';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const song = Buffer.from('ID3 fake mp3 bytes').toString('base64');

describe('campaigns', () => {
  it('a manager opens a campaign; the team adds videos, songs, plans and files', async () => {
    const c = await createCampaign(h.ctx, h.manager, { name: 'קמפיין חנוכה', description: 'גיוס לחלוקת מזון', startDate: '2026-12-01', endDate: '2026-12-20' });
    await addCampaignItem(h.ctx, h.member, c.id, campaignItemSchema.parse({ source: 'link', section: 'video', title: 'הסרטון הראשי', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }));
    await addCampaignItem(h.ctx, h.manager, c.id, campaignItemSchema.parse({ source: 'upload', section: 'song', title: 'שיר הקמפיין', fileName: 'song.mp3', mimeType: 'audio/mpeg', dataBase64: song }));
    await addCampaignItem(h.ctx, h.manager, c.id, campaignItemSchema.parse({ source: 'drive', section: 'video', title: 'סרטון ארוך', driveFileId: 'driveFile0001', fileName: 'long.mp4', mimeType: 'video/mp4', sizeBytes: 50_000_000 }));
    await addCampaignItem(h.ctx, h.member, c.id, campaignItemSchema.parse({ source: 'link', section: 'plan', title: 'תוכנית עבודה', url: 'https://docs.google.com/document/d/abcdefghijk/edit' }));

    const d = await getCampaign(h.ctx, h.member, c.id);
    expect(d.counts).toEqual({ video: 2, song: 1, plan: 1, file: 0 });
    const upload = d.items.find((i) => i.source === 'upload')!;
    expect(upload.url).toBe(`/api/campaign-items/${upload.id}/file`);
    expect(d.items.find((i) => i.source === 'drive')!.url).toBe('https://drive.google.com/file/d/driveFile0001/view');
    const file = await getCampaignFile(h.ctx, h.member, upload.id);
    expect(file.data.toString()).toBe('ID3 fake mp3 bytes');
    expect((await listCampaigns(h.ctx, h.member))[0]!.counts.video).toBe(2);
  });

  it('members remove only what they added; managers remove anything and manage campaigns', async () => {
    const [c] = await listCampaigns(h.ctx, h.manager);
    const d = await getCampaign(h.ctx, h.member, c!.id);
    const managers = d.items.find((i) => i.addedByPersonId === h.manager.personId)!;
    const own = d.items.find((i) => i.addedByPersonId === h.member.personId)!;
    expect([managers.canDelete, own.canDelete]).toEqual([false, true]);
    await expect(deleteCampaignItem(h.ctx, h.member, managers.id)).rejects.toMatchObject({ status: 403 });
    await deleteCampaignItem(h.ctx, h.member, own.id);
    await expect(createCampaign(h.ctx, h.member, { name: 'x', description: '', startDate: null, endDate: null })).rejects.toMatchObject({ status: 403 });
    await expect(updateCampaign(h.ctx, h.manager, c!.id, { name: 'x', description: '', startDate: '2026-12-10', endDate: '2026-12-01' })).rejects.toMatchObject({ status: 400 });
    await expect(listCampaigns(h.ctx, h.guest)).rejects.toMatchObject({ status: 403 });
  });

  it('rejects files that are too large or not links', async () => {
    const [c] = await listCampaigns(h.ctx, h.manager);
    expect(campaignItemSchema.safeParse({ source: 'link', section: 'file', title: 'x', url: 'javascript:alert(1)' }).success).toBe(false);
    const big = Buffer.alloc(3 * 1024 * 1024 + 10).toString('base64');
    expect(campaignItemSchema.safeParse({ source: 'upload', section: 'file', title: 'x', fileName: 'a', mimeType: 'a/b', dataBase64: big }).success).toBe(false);
    await expect(
      addCampaignItem(h.ctx, h.manager, c!.id, { source: 'upload', section: 'file', title: 'x', note: '', fileName: 'a', mimeType: 'a/b', dataBase64: '!!!' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('deleting a campaign deletes its items and stored files', async () => {
    const [c] = await listCampaigns(h.ctx, h.manager);
    const upload = (await getCampaign(h.ctx, h.manager, c!.id)).items.find((i) => i.source === 'upload')!;
    await deleteCampaign(h.ctx, h.manager, c!.id);
    await expect(getCampaignFile(h.ctx, h.manager, upload.id)).rejects.toMatchObject({ status: 404 });
    expect(await listCampaigns(h.ctx, h.manager)).toEqual([]);
  });
});
