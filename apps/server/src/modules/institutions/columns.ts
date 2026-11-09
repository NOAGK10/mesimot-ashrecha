import type { InstitutionField } from '@org/shared';
import { mapSheetRows, normHeader as norm, type MappedRows } from '../google/sheet-table';

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

export function mapSheet(raw: string[][]): MappedRows<InstitutionField> {
  return mapSheetRows(raw, {
    fieldOf: fieldOfHeader,
    order: ['name', 'city', 'address', 'phone', 'contactName', 'contactPhone', 'contactEmail', 'notes'],
    required: 'name',
  });
}
