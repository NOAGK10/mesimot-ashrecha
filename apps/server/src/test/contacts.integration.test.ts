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

describe('adding someone who was removed', () => {
  it('brings them back with the new details instead of "e-mail already exists"', async () => {
    const { createPerson, deletePerson, listPeople } = await import('../modules/identity/people-service');
    const added = await createPerson(h.ctx, h.manager, { displayName: 'יעל', email: 'yael@example.org', role: 'member', jobTitle: null });
    await deletePerson(h.ctx, h.manager, added.id);
    expect((await listPeople(h.ctx, h.manager)).some((p) => p.id === added.id)).toBe(false);

    const back = await createPerson(h.ctx, h.manager, { displayName: 'יעל כהן', email: 'Yael@Example.org', role: 'guest', jobTitle: 'רכזת' });
    expect(back).toMatchObject({ id: added.id, displayName: 'יעל כהן', role: 'guest', jobTitle: 'רכזת', active: true });
    expect((await listPeople(h.ctx, h.manager)).filter((p) => p.email === 'yael@example.org')).toHaveLength(1);
    // Someone still in the organisation: still an error.
    await expect(createPerson(h.ctx, h.manager, { displayName: 'x', email: 'yael@example.org', role: null, jobTitle: null })).rejects.toMatchObject({ status: 409 });
  });
});
