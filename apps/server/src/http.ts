import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from './context';
import { unauthenticated } from './lib/errors';
import { resolvePrincipal } from './modules/identity/auth-service';
import type { Principal } from './modules/identity/principal';

export const SESSION_COOKIE = 'om_session';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

/** Resolves the caller from the session cookie; attached to every request as a preHandler. */
export async function attachPrincipal(ctx: AppContext, req: FastifyRequest): Promise<void> {
  req.principal = await resolvePrincipal(ctx, req.cookies[SESSION_COOKIE]);
}

export function requirePrincipal(req: FastifyRequest): Principal {
  if (!req.principal) throw unauthenticated();
  return req.principal;
}

export function setSessionCookie(ctx: AppContext, reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.NODE_ENV === 'production',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
