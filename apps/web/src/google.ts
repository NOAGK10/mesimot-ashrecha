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

export type PickKind = 'sheets' | 'docs' | 'any';

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
