import type { InstitutionField } from '@org/shared';

const norm = (s: string) => s.toLowerCase().replace(/["'״׳`.,:;()\-_/\\|]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Which field a header names. Contact columns are checked first ("טלפון איש קשר" is not the main phone). */
export function fieldOfHeader(header: string): InstitutionField | null {
  const h = norm(header);
  if (!h) return null;
  const contact = /איש קשר|אשת קשר|אחראי|רכז|contact/.test(h);
  const isPhone = /טלפון|טל |^טל$|נייד|פלאפון|סלולרי|phone|mobile/.test(h);
  const isEmail = /מייל|דוא ל|דואל|אימייל|email|e mail|mail/.test(h);
  if (isEmail) return 'contactEmail';
  if (contact && isPhone) return 'contactPhone';
  if (contact) return 'contactName';
  if (isPhone) return 'phone';
  if (/הערות|הערה|notes?|comments?/.test(h)) return 'notes';
  if (/כתובת|רחוב|address/.test(h)) return 'address';
  if (/^עיר|עיר$|יישוב|ישוב|city|town/.test(h)) return 'city';
  if (/ישיבה|כולל|מוסד|שם|name|institution/.test(h)) return 'name';
  return null;
}

/** The order the user listed the columns in, used when the sheet has no recognisable header row. */
const DEFAULT_ORDER: InstitutionField[] = ['name', 'city', 'address', 'phone', 'contactName', 'contactPhone', 'contactEmail', 'notes'];

export interface MappedSheet {
  rows: Record<InstitutionField, string>[];
  unmatched: string[];
}

/** Finds the header row (within the first rows), maps columns to fields and returns the data rows. */
export function mapSheet(raw: string[][]): MappedSheet {
  let headerAt = -1;
  let columns: (InstitutionField | null)[] = [];
  // The header row is the one (among the first rows) that names the most columns, including the
  // institution's name; a title line such as "רשימת מוסדות" above it names fewer.
  let best = 0;
  for (let i = 0; i < Math.min(raw.length, 6); i++) {
    const fields = raw[i]!.map(fieldOfHeader);
    const known = fields.filter(Boolean).length;
    const filled = raw[i]!.filter((c) => c.trim()).length;
    if (fields.includes('name') && (known >= 2 || known === filled) && known > best) {
      best = known;
      headerAt = i;
      columns = fields;
    }
  }
  const used = new Set<InstitutionField>();
  if (headerAt >= 0) {
    // One column per field: the first one wins.
    columns = columns.map((f) => (f && !used.has(f) ? (used.add(f), f) : null));
  } else {
    columns = DEFAULT_ORDER;
  }
  const unmatched = headerAt >= 0 ? raw[headerAt]!.filter((h, i) => h.trim() && !columns[i]) : [];
  const rows = raw
    .slice(headerAt + 1)
    .map((r) => {
      const row = { name: '', city: '', address: '', phone: '', contactName: '', contactPhone: '', contactEmail: '', notes: '' } as Record<InstitutionField, string>;
      columns.forEach((f, i) => {
        if (f) row[f] = (r[i] ?? '').trim().slice(0, 2000);
      });
      return row;
    })
    .filter((r) => r.name);
  return { rows, unmatched };
}
