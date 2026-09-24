import { eq } from 'drizzle-orm';
import type { GoogleStatusDto } from '@org/shared';
import type { AppContext } from '../../context';
import { googleConnections } from '../../db/schema';
import { AppError, forbidden } from '../../lib/errors';
import { policy } from '../identity/policy';
import type { Principal } from '../identity/principal';
import { DRIVE_FILE_SCOPE, type GoogleWorkspace } from './gateway';

/** Each manager connects their own Google account; the app acts on Drive only on their behalf. */

export function requireWorkspace(ctx: AppContext) {
  if (!ctx.googleWorkspace) throw new AppError(400, 'google_disabled', 'Google Drive integration is not configured');
  return ctx.googleWorkspace;
}

export async function googleStatus(ctx: AppContext, p: Principal): Promise<GoogleStatusDto> {
  const [conn] = await ctx.db.select({ personId: googleConnections.personId }).from(googleConnections).where(eq(googleConnections.personId, p.personId));
  const enabled = ctx.googleWorkspace !== null;
  return {
    enabled,
    connected: Boolean(conn),
    clientId: enabled ? (ctx.config.GOOGLE_CLIENT_ID ?? null) : null,
    apiKey: enabled ? (ctx.config.GOOGLE_API_KEY ?? null) : null,
    appId: enabled ? (ctx.config.GOOGLE_APP_ID ?? null) : null,
  };
}

export async function connectGoogle(ctx: AppContext, p: Principal, code: string): Promise<void> {
  if (!policy.isManager(p)) throw forbidden();
  const { api, secrets } = requireWorkspace(ctx);
  const { refreshToken, scope } = await api.exchangeCode(code);
  if (!scope.split(' ').includes(DRIVE_FILE_SCOPE)) throw new AppError(400, 'google_scope', 'Drive access was not granted');
  const row = { personId: p.personId, refreshTokenEnc: secrets.seal(refreshToken), scope, connectedAt: ctx.now() };
  await ctx.db.insert(googleConnections).values(row).onConflictDoUpdate({ target: googleConnections.personId, set: row });
}

export async function disconnectGoogle(ctx: AppContext, p: Principal): Promise<void> {
  const [conn] = await ctx.db.delete(googleConnections).where(eq(googleConnections.personId, p.personId)).returning();
  if (conn && ctx.googleWorkspace) await ctx.googleWorkspace.api.revoke(ctx.googleWorkspace.secrets.open(conn.refreshTokenEnc));
}

/** Resolves the caller's Drive credentials, or throws a clear "connect Google first" error. */
export async function driveFor(ctx: AppContext, p: Principal): Promise<{ api: GoogleWorkspace; refreshToken: string }> {
  const { api, secrets } = requireWorkspace(ctx);
  const [conn] = await ctx.db.select().from(googleConnections).where(eq(googleConnections.personId, p.personId));
  if (!conn) throw new AppError(400, 'google_not_connected', 'Connect your Google account first');
  return { api, refreshToken: secrets.open(conn.refreshTokenEnc) };
}

export async function driveIfConnected(ctx: AppContext, p: Principal) {
  if (!ctx.googleWorkspace) return null;
  const [conn] = await ctx.db.select({ id: googleConnections.personId }).from(googleConnections).where(eq(googleConnections.personId, p.personId));
  return conn ? driveFor(ctx, p) : null;
}

export async function pickerToken(ctx: AppContext, p: Principal): Promise<string> {
  if (!policy.isManager(p)) throw forbidden();
  const { api, refreshToken } = await driveFor(ctx, p);
  return api.accessToken(refreshToken);
}
