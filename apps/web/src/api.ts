import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MeDto,
  PersonDto,
  RecurrenceDto,
  TaskDetailDto,
  TaskDto,
  TaskStatus,
  TaskView,
} from '@org/shared';

/** Thin HTTP client. All authorization happens on the server; the UI only reflects what it is told. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'x-requested-with': 'fetch', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? res.statusText);
  }
  return data as T;
}

export const useMe = () =>
  useQuery<MeDto | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<MeDto>('GET', '/api/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });

export const useAuthConfig = () =>
  useQuery({ queryKey: ['auth-config'], queryFn: () => api<{ googleClientId: string | null; devLogin: boolean }>('GET', '/api/auth/config') });

export const usePeople = (enabled = true) =>
  useQuery({ queryKey: ['people'], queryFn: () => api<PersonDto[]>('GET', '/api/people'), enabled, staleTime: 60_000 });

export interface TaskFilters {
  view: TaskView;
  mine: boolean;
  ownerPersonId?: string;
  status?: TaskStatus;
  includeArchived?: boolean;
}

export const useTasks = (f: TaskFilters) =>
  useQuery({
    queryKey: ['tasks', f],
    queryFn: () => {
      const q = new URLSearchParams({ view: f.view });
      if (f.mine) q.set('mine', 'true');
      if (f.ownerPersonId) q.set('ownerPersonId', f.ownerPersonId);
      if (f.status) q.set('status', f.status);
      if (f.includeArchived) q.set('includeArchived', 'true');
      return api<TaskDto[]>('GET', `/api/tasks?${q}`);
    },
  });

export const useTask = (id: string) =>
  useQuery({ queryKey: ['task', id], queryFn: () => api<TaskDetailDto>('GET', `/api/tasks/${id}`) });

export const useRecurrences = () =>
  useQuery({ queryKey: ['recurrences'], queryFn: () => api<RecurrenceDto[]>('GET', '/api/recurrences') });

/** Mutation that refreshes task-related queries afterwards. */
export function useApiMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>, keys: string[][] = [['tasks'], ['task']]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}
