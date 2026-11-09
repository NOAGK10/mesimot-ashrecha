import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateProfileSchema } from '@org/shared';
import { listPeople } from '../modules/identity/people-service';
import { getProfile, updateProfile } from '../modules/profiles/profile-service';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe('contacts', () => {
  it('people add their own phone number, and everyone signed in sees it', async () => {
    await updateProfile(h.ctx, h.member, h.member.personId, { phone: '050-1234567' });
    for (const who of [h.manager, h.member, h.guest]) {
      const member = (await listPeople(h.ctx, who)).find((p) => p.id === h.member.personId)!;
      expect(member.phone).toBe('050-1234567');
    }
    expect((await getProfile(h.ctx, h.guest, h.member.personId)).person.phone).toBe('050-1234567');
  });

  it("only managers see other people's e-mail addresses; everyone sees their own", async () => {
    const email = (who: typeof h.manager, of: string) => listPeople(h.ctx, who).then((l) => l.find((p) => p.id === of)!.email);
    expect(await email(h.manager, h.member.personId)).toBe('member@example.org');
    expect(await email(h.member, h.guest.personId)).toBe('');
    expect(await email(h.guest, h.member.personId)).toBe('');
    expect(await email(h.member, h.member.personId)).toBe('member@example.org');
    expect((await getProfile(h.ctx, h.member, h.guest.personId)).person.email).toBe('');
  });

  it("nobody edits someone else's phone except a manager", async () => {
    await expect(updateProfile(h.ctx, h.guest, h.member.personId, { phone: '1' })).rejects.toMatchObject({ status: 403 });
    await updateProfile(h.ctx, h.manager, h.member.personId, { phone: null });
    expect((await getProfile(h.ctx, h.member, h.member.personId)).person.phone).toBeNull();
    expect(updateProfileSchema.safeParse({ phone: 'abc' }).success).toBe(false);
  });
});
