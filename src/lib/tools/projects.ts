/**
 * Project intelligence tools — the engine behind the Project Hub.
 *
 * - summarizeProject: gathers workspace notes, tasks, and upcoming schedule
 *   for a project, composes a Markdown status summary, and saves it as a
 *   brief so it appears in the Project Hub.
 * - generateActionPlan: turns a goal into phased, dated steps, creates one
 *   tracked task per step, and saves the full plan as a brief.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '@/db';
import { listLocalEvents } from '@/lib/calendar/local';
import { createTask, listTasks } from '@/lib/tasks';
import { defineTool, type ToolContext } from './registry';

const DAY_MS = 24 * 3600 * 1000;

function fmtDay(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString('en-GB', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function snippet(text: string, max = 280): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

async function saveBrief(
  ctx: ToolContext,
  title: string,
  content: string,
): Promise<string> {
  const { db } = await getDb();
  const id = randomUUID();
  await db.insert(schema.workspaceContext).values({
    id,
    profileId: ctx.profileId,
    title,
    kind: 'brief',
    content,
  });
  return id;
}

async function findWorkspaceNotes(ctx: ToolContext, query: string, limit: number) {
  const { db } = await getDb();
  const q = `%${query.trim()}%`;
  return db
    .select()
    .from(schema.workspaceContext)
    .where(
      and(
        eq(schema.workspaceContext.profileId, ctx.profileId),
        or(
          ilike(schema.workspaceContext.title, q),
          ilike(schema.workspaceContext.content, q),
        )!,
      ),
    )
    .orderBy(desc(schema.workspaceContext.updatedAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// summarizeProject
// ---------------------------------------------------------------------------

export const summarizeProjectSchema = z.object({
  project: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .describe('Project name or keyword — matched against workspace notes, tasks, and calendar events.'),
  includeTasks: z.boolean().default(true).describe('Include matching tasks in the summary.'),
  includeSchedule: z.boolean().default(true).describe('Include upcoming matching calendar events in the summary.'),
  days: z.coerce
    .number()
    .int()
    .min(1)
    .max(90)
    .default(14)
    .describe('How many days ahead to scan the schedule (1-90, default 14).'),
  saveBrief: z
    .boolean()
    .default(true)
    .describe('Save the summary as a brief so it appears in the Project Hub.'),
});

defineTool({
  name: 'summarizeProject',
  description:
    'Build a Markdown status summary for a project from workspace notes, tracked tasks, and the upcoming schedule. Saves the summary to the Project Hub as a brief (unless saveBrief is false). Use it when the user asks what is going on with a project or wants a status update.',
  parameters: summarizeProjectSchema,
  execute: async (args, ctx) => {
    const notes = await findWorkspaceNotes(ctx, args.project, 10);
    const allTasks = args.includeTasks
      ? (await listTasks(ctx.profileId, { limit: 100 })).tasks
      : [];
    const needle = args.project.toLowerCase();
    const tasks = allTasks.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        (t.notes ?? '').toLowerCase().includes(needle),
    );
    const openTasks = tasks.filter((t) => t.status !== 'done');
    const now = new Date();
    const schedule = args.includeSchedule
      ? (
          await listLocalEvents(ctx.profileId, {
            from: now.toISOString(),
            to: new Date(now.getTime() + args.days * DAY_MS).toISOString(),
            query: args.project,
            limit: 20,
          })
        ).events
      : [];
    const overdue = openTasks.filter(
      (t) => t.due_at && new Date(t.due_at).getTime() < now.getTime(),
    );
    const dueSoon = openTasks.filter((t) => {
      if (!t.due_at) return false;
      const due = new Date(t.due_at).getTime();
      return due >= now.getTime() && due < now.getTime() + 7 * DAY_MS;
    });

    const lines: string[] = [
      `# ${args.project} — Project summary`,
      ``,
      `_Generated ${fmtDateTime(now)} · ${notes.length} note(s) · ${openTasks.length} open task(s) · ${schedule.length} upcoming event(s)_`,
      ``,
    ];
    if (notes.length > 0) {
      lines.push(`## Workspace notes`, ``);
      for (const n of notes) {
        lines.push(`- **${n.title}** _(${n.kind})_ — ${snippet(n.content) || '—'}`);
      }
      lines.push(``);
    }
    if (args.includeTasks) {
      lines.push(`## Open tasks (${openTasks.length})`, ``);
      if (openTasks.length === 0) {
        lines.push(`No open tasks mention this project.`, ``);
      } else {
        for (const t of openTasks.slice(0, 15)) {
          const due = t.due_at ? ` _(due ${fmtDay(new Date(t.due_at))})_` : '';
          lines.push(`- [ ] **${t.title}**${due} _[${t.priority}]_`);
        }
        lines.push(``);
      }
    }
    if (args.includeSchedule) {
      lines.push(`## Upcoming on the schedule (${schedule.length})`, ``);
      if (schedule.length === 0) {
        lines.push(`Nothing mentioning this project in the next ${args.days} days.`, ``);
      } else {
        for (const e of schedule) {
          lines.push(`- **${e.title}** — ${fmtDateTime(new Date(e.starts_at))}`);
        }
        lines.push(``);
      }
    }
    lines.push(`## Deadline watch`, ``);
    if (overdue.length === 0 && dueSoon.length === 0) {
      lines.push(`No overdue tasks and nothing due in the next 7 days.`, ``);
    } else {
      for (const t of overdue) {
        lines.push(`- ⚠️ **${t.title}** — overdue${t.due_at ? ` (was due ${fmtDay(new Date(t.due_at))})` : ''}`);
      }
      for (const t of dueSoon) {
        lines.push(`- ⏰ **${t.title}** — due ${fmtDay(new Date(t.due_at as string))}`);
      }
      lines.push(``);
    }
    lines.push(`## Suggested next actions`, ``);
    if (overdue.length > 0) lines.push(`- Clear the ${overdue.length} overdue task(s) first — renegotiate or reschedule them.`);
    if (openTasks.length > 0) lines.push(`- Review the ${openTasks.length} open task(s) and confirm owners and due dates.`);
    if (schedule.length > 0) lines.push(`- Protect the ${schedule.length} scheduled slot(s) above; prep before each one.`);
    if (overdue.length === 0 && openTasks.length === 0 && schedule.length === 0) {
      lines.push(`- No signals yet — add a project note or run generateActionPlan to kick this project off.`);
    }
    lines.push(``);

    const summary = lines.join('\n');
    let briefId: string | null = null;
    if (args.saveBrief) {
      briefId = await saveBrief(ctx, `${args.project} — Project summary`, summary);
    }
    return {
      project: args.project,
      summary,
      briefId,
      savedToProjectHub: briefId !== null,
      counts: {
        notes: notes.length,
        tasks: tasks.length,
        openTasks: openTasks.length,
        events: schedule.length,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// generateActionPlan
// ---------------------------------------------------------------------------

export const generateActionPlanSchema = z.object({
  goal: z
    .string()
    .trim()
    .min(3)
    .max(500)
    .describe('The goal to plan for, e.g. "launch the new website".'),
  project: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe('Related project name — pulls its workspace notes into the plan for context.'),
  deadline: z
    .string()
    .max(64)
    .optional()
    .describe('Target date in ISO 8601. Steps are scheduled backwards from it; omit for a 3-week rolling plan.'),
  createTasks: z
    .boolean()
    .default(true)
    .describe('Create one tracked task per action step (shown on the dashboard).'),
  saveBrief: z
    .boolean()
    .default(true)
    .describe('Save the full plan as a brief so it appears in the Project Hub.'),
});

interface PlanStep {
  phase: string;
  title: string;
  detail: string;
  dueAt: Date;
  priority: 'high' | 'medium';
}

defineTool({
  name: 'generateActionPlan',
  description:
    'Turn a goal into a phased, dated action plan with tracked tasks. Pulls related project notes for context, creates one task per step (unless createTasks is false), and saves the full plan to the Project Hub as a brief (unless saveBrief is false). Use it when the user wants a plan, roadmap, or next steps for a goal or project.',
  parameters: generateActionPlanSchema,
  execute: async (args, ctx) => {
    const now = new Date();
    let target: Date | null = null;
    if (args.deadline?.trim()) {
      const parsed = new Date(args.deadline.trim());
      if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > now.getTime()) {
        target = parsed;
      }
    }
    const horizonMs = target ? target.getTime() - now.getTime() : 21 * DAY_MS;
    const at = (frac: number) => new Date(now.getTime() + horizonMs * frac);

    const notes = args.project
      ? await findWorkspaceNotes(ctx, args.project, 5)
      : [];
    const goal = args.goal.trim();
    const tag = args.project?.trim() ? `[${args.project.trim()}] ` : '';

    const steps: PlanStep[] = [
      {
        phase: 'Scope & prep',
        title: `${tag}Define "done" for: ${goal}`,
        detail: `Write the 1-paragraph success criteria and the hard constraints (budget, time, people). No execution until this exists.`,
        dueAt: at(0.15),
        priority: 'high',
      },
      {
        phase: 'Scope & prep',
        title: `${tag}Gather inputs and constraints`,
        detail: notes.length > 0
          ? `Review the ${notes.length} related workspace note(s) (${notes.map((n) => n.title).join('; ')}) and list open questions.`
          : `Collect every input, file, and dependency the goal needs; list open questions and who can answer them.`,
        dueAt: at(0.3),
        priority: 'medium',
      },
      {
        phase: 'Execute',
        title: `${tag}Ship the first version`,
        detail: `Produce the smallest complete version of the outcome — draft, prototype, or pilot. Done beats perfect.`,
        dueAt: at(0.6),
        priority: 'high',
      },
      {
        phase: 'Execute',
        title: `${tag}Review and iterate`,
        detail: `Get feedback from one trusted reviewer, fix the top 3 issues, and re-check against the success criteria.`,
        dueAt: at(0.8),
        priority: 'medium',
      },
      {
        phase: 'Land it',
        title: `${tag}Final review and ship`,
        detail: `Final pass against "done", ship it, then capture retro notes (what worked, what to change) back into the workspace.`,
        dueAt: target ?? at(1),
        priority: 'high',
      },
    ];

    const lines: string[] = [
      `# Action plan — ${goal}`,
      ``,
      `_Generated ${fmtDateTime(now)}${target ? ` · target: ${fmtDay(target)}` : ' · rolling 3-week horizon'}${args.project ? ` · project: ${args.project}` : ''}_`,
      ``,
      `## Objective`,
      ``,
      goal,
      ``,
    ];
    if (notes.length > 0) {
      lines.push(`## Project context used`, ``);
      for (const n of notes) {
        lines.push(`- **${n.title}** — ${snippet(n.content)}`);
      }
      lines.push(``);
    }
    let lastPhase = '';
    for (const [i, s] of steps.entries()) {
      if (s.phase !== lastPhase) {
        lastPhase = s.phase;
        lines.push(`## Phase: ${s.phase}`, ``);
      }
      lines.push(`### ${i + 1}. ${s.title}`, ``);
      lines.push(`- **Due:** ${fmtDay(s.dueAt)} · **Priority:** ${s.priority}`, `- ${s.detail}`, ``);
    }
    lines.push(`## First 3 moves (do these today)`, ``);
    lines.push(`1. ${steps[0].title}`, `2. ${steps[1].title}`, `3. Block calendar time for "${steps[2].title}".`, ``);
    const plan = lines.join('\n');

    const taskIds: string[] = [];
    if (args.createTasks) {
      for (const s of steps) {
        try {
          const { task } = await createTask(ctx.profileId, {
            title: s.title,
            notes: `${s.phase}: ${s.detail}`,
            priority: s.priority,
            due_at: s.dueAt.toISOString(),
          });
          taskIds.push(task.id);
        } catch {
          // One failed task must not sink the whole plan.
        }
      }
    }

    let briefId: string | null = null;
    if (args.saveBrief) {
      const title = `Action plan — ${goal.length > 60 ? `${goal.slice(0, 60)}…` : goal}`;
      briefId = await saveBrief(ctx, title, plan);
    }
    return {
      goal,
      plan,
      briefId,
      taskIds,
      savedToProjectHub: briefId !== null,
      counts: { steps: steps.length, tasksCreated: taskIds.length },
      targetDate: target ? target.toISOString() : null,
    };
  },
});
