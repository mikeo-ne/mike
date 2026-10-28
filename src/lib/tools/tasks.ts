/**
 * Task management tool — lets 1ne capture, track, and complete the action
 * items shown on 1ne's Dashboard.
 */
import { z } from 'zod';
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  createTask,
  deleteTask,
  listTasks,
  updateTask,
} from '@/lib/tasks';
import { defineTool } from './registry';

export const manageTasksSchema = z.object({
  action: z
    .enum(['list', 'create', 'update', 'complete', 'reopen', 'delete'])
    .describe(
      'list: show tasks (optional status filter). create: needs title. update: needs id. complete/reopen/delete: needs id.',
    ),
  id: z.string().uuid().optional().describe('Task id (all actions except list/create).'),
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional().describe('Filter for list, or target for update.'),
  priority: z.enum(TASK_PRIORITIES).optional(),
  due_at: z
    .string()
    .max(64)
    .nullable()
    .optional()
    .describe('Due date-time in ISO 8601 (null clears it).'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

defineTool({
  name: 'manage_tasks',
  description:
    'Manage the user\'s task list (shown on 1ne\'s Dashboard). When the user mentions something to do, create a task for it and propose a time slot; use list to review open work before planning the day.',
  parameters: manageTasksSchema,
  execute: async (args, ctx) => {
    switch (args.action) {
      case 'list':
        return listTasks(ctx.profileId, {
          status: args.status,
          limit: args.limit,
        });
      case 'create':
        if (!args.title) throw new Error('action "create" requires "title".');
        return {
          action: 'created' as const,
          ...(await createTask(ctx.profileId, {
            title: args.title,
            notes: args.notes ?? undefined,
            priority: args.priority,
            due_at: args.due_at ?? undefined,
          })),
        };
      case 'update': {
        if (!args.id) throw new Error('action "update" requires "id".');
        return {
          action: 'updated' as const,
          ...(await updateTask(ctx.profileId, args.id, {
            title: args.title,
            notes: args.notes ?? undefined,
            status: args.status,
            priority: args.priority,
            due_at: args.due_at === null ? null : (args.due_at ?? undefined),
          })),
        };
      }
      case 'complete':
        if (!args.id) throw new Error('action "complete" requires "id".');
        return {
          action: 'completed' as const,
          ...(await updateTask(ctx.profileId, args.id, { status: 'done' })),
        };
      case 'reopen':
        if (!args.id) throw new Error('action "reopen" requires "id".');
        return {
          action: 'reopened' as const,
          ...(await updateTask(ctx.profileId, args.id, { status: 'open' })),
        };
      case 'delete':
        if (!args.id) throw new Error('action "delete" requires "id".');
        return {
          action: 'deleted' as const,
          ...(await deleteTask(ctx.profileId, args.id)),
        };
    }
  },
});
