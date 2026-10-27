/**
 * Workspace context tool — lets Mike reference the user's notes, project
 * guidelines, and briefs (workspace_context table) for background and
 * deadlines, and cross-reference them with the calendar.
 */
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { defineTool } from './registry';

export const getProjectContextSchema = z.object({
  query: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe(
      'Text to search across titles and contents, e.g. a project name or "deadline". Omit to get the most recently updated entries.',
    ),
  kind: z
    .enum(['note', 'project', 'guideline', 'brief'])
    .optional()
    .describe('Only return entries of this kind.'),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe('Maximum entries to return (1-20, default 5).'),
});

defineTool({
  name: 'get_project_context',
  description:
    'Query the user\'s workspace context (notes, projects, guidelines, briefs) for background information and project deadlines. Use this proactively before answering planning questions, and cross-reference returned deadlines with the calendar schedule to warn about collisions.',
  parameters: getProjectContextSchema,
  execute: async (args, ctx) => {
    const { db } = await getDb();
    const conditions = [eq(schema.workspaceContext.profileId, ctx.profileId)];
    if (args.kind) {
      conditions.push(eq(schema.workspaceContext.kind, args.kind));
    }
    if (args.query?.trim()) {
      const q = `%${args.query.trim()}%`;
      conditions.push(
        or(
          ilike(schema.workspaceContext.title, q),
          ilike(schema.workspaceContext.content, q),
        )!,
      );
    }
    const rows = await db
      .select()
      .from(schema.workspaceContext)
      .where(and(...conditions))
      .orderBy(desc(schema.workspaceContext.updatedAt))
      .limit(args.limit);
    return {
      contexts: rows.map((r) => ({
        id: r.id,
        title: r.title,
        kind: r.kind,
        snippet:
          r.content.length > 280 ? `${r.content.slice(0, 280)}…` : r.content,
        content:
          r.content.length > 4000
            ? `${r.content.slice(0, 4000)}\n…(truncated)`
            : r.content,
        updated_at: r.updatedAt.toISOString(),
      })),
      count: rows.length,
    };
  },
});
