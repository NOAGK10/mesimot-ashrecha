import { OAuth2Client } from 'google-auth-library';
import type { SourceTable } from '@org/shared';

/**
 * Integration boundary to Google (architecture §16). The domain never talks to Google APIs directly;
 * it goes through these interfaces, which tests replace with fakes.
 *
 * Scope is `drive.file`: the app can only see files the user picked or the app itself created.
 * It is a non-sensitive scope, so it works for consumer Gmail accounts without Google verification.
 */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface GoogleFileMeta {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
}

export interface GoogleWorkspace {
  /** Exchanges a GIS authorization code (popup flow) for a refresh token. */
  exchangeCode(code: string): Promise<{ refreshToken: string; scope: string }>;
  /** Short-lived access token, handed to the browser only for the Google Picker. */
  accessToken(refreshToken: string): Promise<string>;
  getFile(refreshToken: string, fileId: string): Promise<GoogleFileMeta | null>;
  readSpreadsheet(refreshToken: string, fileId: string): Promise<SourceTable[] | null>;
  /** Uploads a file into the user's Drive, converting Office files to Google Docs/Sheets. */
  upload(refreshToken: string, file: { name: string; mimeType: string; data: Buffer }): Promise<GoogleFileMeta>;
  revoke(refreshToken: string): Promise<void>;
}

/** Reads a Google Sheet that is shared "anyone with the link", without any authorization. */
export interface PublicSheets {
  fetchCsv(fileId: string): Promise<string | null>;
}

const CONVERT: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'application/vnd.google-apps.document',
  'application/msword': 'application/vnd.google-apps.document',
  'text/plain': 'application/vnd.google-apps.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'application/vnd.google-apps.spreadsheet',
  'application/vnd.ms-excel': 'application/vnd.google-apps.spreadsheet',
  'text/csv': 'application/vnd.google-apps.spreadsheet',
};

export function googleWorkspace(clientId: string, clientSecret: string): GoogleWorkspace {
  const clientFor = (refreshToken: string) => {
    const c = new OAuth2Client({ clientId, clientSecret, redirectUri: 'postmessage' });
    c.setCredentials({ refresh_token: refreshToken });
    return c;
  };
  const notFound = (err: unknown) => {
    const status = (err as { response?: { status?: number } }).response?.status;
    return status === 404 || status === 403;
  };
  const FILE_FIELDS = 'id,name,mimeType,webViewLink';

  return {
    async exchangeCode(code) {
      const c = new OAuth2Client({ clientId, clientSecret, redirectUri: 'postmessage' });
      const { tokens } = await c.getToken(code);
      if (!tokens.refresh_token) throw new Error('Google did not return a refresh token');
      return { refreshToken: tokens.refresh_token, scope: tokens.scope ?? DRIVE_FILE_SCOPE };
    },

    async accessToken(refreshToken) {
      const { token } = await clientFor(refreshToken).getAccessToken();
      if (!token) throw new Error('No access token');
      return token;
    },

    async getFile(refreshToken, fileId) {
      try {
        const res = await clientFor(refreshToken).request<GoogleFileMeta>({
          url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
          params: { fields: FILE_FIELDS, supportsAllDrives: true },
        });
        return res.data;
      } catch (err) {
        if (notFound(err)) return null;
        throw err;
      }
    },

    async readSpreadsheet(refreshToken, fileId) {
      const c = clientFor(refreshToken);
      const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(fileId)}`;
      try {
        const meta = await c.request<{ sheets: Array<{ properties: { title: string } }> }>({
          url: base,
          params: { fields: 'sheets.properties.title' },
        });
        const titles = meta.data.sheets.map((s) => s.properties.title);
        if (titles.length === 0) return [];
        const values = await c.request<{ valueRanges: Array<{ values?: string[][] }> }>({
          url: `${base}/values:batchGet`,
          params: { ranges: titles.map((t) => `'${t.replace(/'/g, "''")}'`), valueRenderOption: 'FORMATTED_VALUE' },
          paramsSerializer: (p: Record<string, unknown>) =>
            Object.entries(p)
              .flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `${k}=${encodeURIComponent(String(x))}`))
              .join('&'),
        });
        return titles.map((name, i) => ({ name, rows: values.data.valueRanges[i]?.values ?? [] }));
      } catch (err) {
        if (notFound(err)) return null;
        throw err;
      }
    },

    async upload(refreshToken, file) {
      const boundary = `b${Date.now().toString(36)}`;
      const metadata = { name: file.name.replace(/\.[^.]+$/, ''), mimeType: CONVERT[file.mimeType] ?? file.mimeType };
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
        Buffer.from(`--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`),
        file.data,
        Buffer.from(`\r\n--${boundary}--`),
      ]);
      const res = await clientFor(refreshToken).request<GoogleFileMeta>({
        url: 'https://www.googleapis.com/upload/drive/v3/files',
        method: 'POST',
        params: { uploadType: 'multipart', fields: FILE_FIELDS },
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
      return res.data;
    },

    async revoke(refreshToken) {
      await new OAuth2Client({ clientId, clientSecret }).revokeToken(refreshToken).catch(() => undefined);
    },
  };
}

/** Only ever fetches docs.google.com URLs built from a validated file id, never user-supplied URLs. */
export const publicSheets: PublicSheets = {
  async fetchCsv(fileId) {
    if (!/^[\w-]{10,200}$/.test(fileId)) return null;
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv`, { redirect: 'follow' });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('text/csv')) return null;
    return res.text();
  },
};

/** Extracts the file id and kind from a Google Docs/Sheets/Drive URL. */
export function parseGoogleUrl(url: string): { fileId: string; kind: 'google_doc' | 'google_sheet' | 'link' } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/.test(u.hostname)) return null;
  const m = /\/d\/([\w-]{10,200})/.exec(u.pathname) ?? (u.searchParams.get('id') ? [null, u.searchParams.get('id')] : null);
  const fileId = m?.[1];
  if (!fileId || !/^[\w-]{10,200}$/.test(fileId)) return null;
  const kind = u.pathname.startsWith('/document/') ? 'google_doc' : u.pathname.startsWith('/spreadsheets/') ? 'google_sheet' : 'link';
  return { fileId, kind };
}

export function kindFromMime(mimeType: string): 'google_doc' | 'google_sheet' | 'link' {
  if (mimeType === 'application/vnd.google-apps.document') return 'google_doc';
  if (mimeType === 'application/vnd.google-apps.spreadsheet') return 'google_sheet';
  return 'link';
}
