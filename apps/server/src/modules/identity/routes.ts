import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createPersonSchema, devLoginSchema, googleLoginSchema, updatePersonSchema } from '@org/shared';
import type { AppContext } from '../../context';
import { clearSessionCookie, requirePrincipal, SESSION_COOKIE, setSessionCookie } from '../../http';
import { AppError } from '../../lib/errors';
import { parse } from '../../lib/validate';
import {
  describePrincipal,
  issueMagicLinkAsManager,
  loginForDevelopment,
  loginWithGoogle,
  logout,
  redeemMagicLink,
} from './auth-service';
import { createPerson, listPeople, updatePerson } from './people-service';

const idParam = z.object({ id: z.uuid() });

export function identityRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/auth/config', async () => ({
    googleClientId: ctx.config.GOOGLE_CLIENT_ID ?? null,
    devLogin: ctx.config.AUTH_DEV_LOGIN && ctx.config.NODE_ENV !== 'production',
  }));

  app.post('/api/auth/google', async (req, reply) => {
    const { credential } = parse(googleLoginSchema, req.body);
    const session = await loginWithGoogle(ctx, credential);
    setSessionCookie(ctx, reply, session.token, session.expiresAt);
    return { ok: true };
  });

  app.post('/api/auth/dev-login', async (req, reply) => {
    const { email } = parse(devLoginSchema, req.body);
    const session = await loginForDevelopment(ctx, email);
    setSessionCookie(ctx, reply, session.token, session.expiresAt);
    return { ok: true };
  });

  // Opened from e-mail: a plain GET that sets the scoped session and redirects into the app.
  app.get('/api/auth/magic', async (req, reply) => {
    const { token } = parse(z.object({ token: z.string().min(10) }), req.query);
    try {
      const session = await redeemMagicLink(ctx, token);
      setSessionCookie(ctx, reply, session.token, session.expiresAt);
      return reply.redirect(`${ctx.config.APP_URL}/tasks/${session.taskId}`);
    } catch (err) {
      if (err instanceof AppError && err.code === 'link_invalid') return reply.redirect(`${ctx.config.APP_URL}/link-expired`);
      throw err;
    }
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await logout(ctx, token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/api/me', async (req) => describePrincipal(ctx, requirePrincipal(req)));

  app.get('/api/people', async (req) => listPeople(ctx, requirePrincipal(req)));
  app.post('/api/people', async (req, reply) => {
    const person = await createPerson(ctx, requirePrincipal(req), parse(createPersonSchema, req.body));
    return reply.code(201).send(person);
  });
  app.patch('/api/people/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    return updatePerson(ctx, requirePrincipal(req), id, parse(updatePersonSchema, req.body));
  });

  app.post('/api/tasks/:id/links', async (req) => {
    const { id } = parse(idParam, req.params);
    const { personId } = parse(z.object({ personId: z.uuid() }), req.body);
    return { url: await issueMagicLinkAsManager(ctx, requirePrincipal(req), id, personId) };
  });
}
