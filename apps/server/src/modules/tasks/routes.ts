import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  changeStatusSchema,
  createTaskSchema,
  listTasksQuerySchema,
  setParticipantsSchema,
  updateTaskSchema,
  versionOnlySchema,
} from '@org/shared';
import type { AppContext } from '../../context';
import { requirePrincipal } from '../../http';
import { parse } from '../../lib/validate';
import { changeStatus, createTask, getTaskDetail, listTasks, setArchived, setParticipants, updateTask } from './task-service';

const idParam = z.object({ id: z.uuid() });

export function taskRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/tasks', async (req) => listTasks(ctx, requirePrincipal(req), parse(listTasksQuerySchema, req.query)));

  app.post('/api/tasks', async (req, reply) => {
    const task = await createTask(ctx, requirePrincipal(req), parse(createTaskSchema, req.body));
    return reply.code(201).send(task);
  });

  app.get('/api/tasks/:id', async (req) => getTaskDetail(ctx, requirePrincipal(req), parse(idParam, req.params).id));

  app.patch('/api/tasks/:id', async (req) =>
    updateTask(ctx, requirePrincipal(req), parse(idParam, req.params).id, parse(updateTaskSchema, req.body)),
  );

  app.post('/api/tasks/:id/status', async (req) =>
    changeStatus(ctx, requirePrincipal(req), parse(idParam, req.params).id, parse(changeStatusSchema, req.body)),
  );

  app.put('/api/tasks/:id/participants', async (req) =>
    setParticipants(ctx, requirePrincipal(req), parse(idParam, req.params).id, parse(setParticipantsSchema, req.body)),
  );

  app.post('/api/tasks/:id/archive', async (req) =>
    setArchived(ctx, requirePrincipal(req), parse(idParam, req.params).id, parse(versionOnlySchema, req.body).version, true),
  );
  app.post('/api/tasks/:id/unarchive', async (req) =>
    setArchived(ctx, requirePrincipal(req), parse(idParam, req.params).id, parse(versionOnlySchema, req.body).version, false),
  );
}
