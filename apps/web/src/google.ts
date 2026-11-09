import type { GoogleStatusDto } from '@org/shared';
import { api } from './api';

/**
 * Browser side of the Google integration. The browser never holds a refresh token: it only
 * forwards an authorization code to the server and borrows a short-lived token for the Picker.
 */

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const w = window as any;

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(s);
      }),
    );
  }
  return loaded.get(src)!;
}

/** Opens Google's consent popup for Drive access to picked files only, then stores the grant server-side. */
export async function connectGoogle(status: GoogleStatusDto): Promise<void> {
  await loadScript('https://accounts.google.com/gsi/client');
  return new Promise((resolve, reject) => {
    const client = w.google.accounts.oauth2.initCodeClient({
      client_id: status.clientId,
      scope: DRIVE_FILE_SCOPE,
      ux_mode: 'popup',
      callback: (resp: { code?: string; error?: string }) => {
        if (!resp.code) return reject(new Error(resp.error ?? 'cancelled'));
        api('POST', '/api/google/connect', { code: resp.code }).then(() => resolve(), reject);
      },
      error_callback: (err: { type?: string }) => reject(new Error(err.type ?? 'popup_failed')),
    });
    client.requestCode();
  });
}

export type PickKind = 'sheets' | 'docs' | 'sheets_docs' | 'any';

/** Shows the Google Picker. Resolves to the picked file id, or null if the user closed it. */
export async function pickFromDrive(status: GoogleStatusDto, kind: PickKind): Promise<string | null> {
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise<void>((resolve) => w.gapi.load('picker', resolve));
  const { accessToken } = await api<{ accessToken: string }>('GET', '/api/google/picker-token');
  const picker = w.google.picker;
  const view =
    kind === 'sheets'
      ? new picker.DocsView(picker.ViewId.SPREADSHEETS)
      : kind === 'docs'
        ? new picker.DocsView(picker.ViewId.DOCUMENTS)
        : new picker.DocsView(picker.ViewId.DOCS);
  if (kind === 'sheets_docs') view.setMimeTypes('application/vnd.google-apps.spreadsheet,application/vnd.google-apps.document');
  view.setMode(picker.DocsViewMode.LIST);
  return new Promise((resolve) => {
    new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(status.apiKey)
      .setAppId(status.appId)
      .setLocale('iw')
      .setCallback((data: any) => {
        if (data.action === picker.Action.PICKED) resolve(data.docs?.[0]?.id ?? null);
        else if (data.action === picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}

/**
 * Uploads a (large) file straight from the browser into the manager's Google Drive – it never passes
 * through the site's server, so there is no size limit beyond Drive's – and makes it viewable by link,
 * so the team can play it on the site. Uses the same short-lived token as the Picker.
 */
export async function uploadToDrive(file: File, onProgress: (fraction: number) => void): Promise<{ id: string }> {
  const { accessToken } = await api<{ accessToken: string }>('GET', '/api/google/picker-token');
  const type = file.type || 'application/octet-stream';
  const init = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': type },
    body: JSON.stringify({ name: file.name, mimeType: type }),
  });
  const location = init.headers.get('location');
  if (!init.ok || !location) throw new Error('drive_upload_start_failed');

  const id = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', location);
    xhr.setRequestHeader('content-type', type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as { id?: string };
        if (xhr.status >= 200 && xhr.status < 300 && body.id) resolve(body.id);
        else reject(new Error('drive_upload_failed'));
      } catch {
        reject(new Error('drive_upload_failed'));
      }
    };
    xhr.onerror = () => reject(new Error('drive_upload_failed'));
    xhr.send(file);
  });

  const share = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/permissions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
  if (!share.ok) throw new Error('drive_share_failed');
  return { id };
}
