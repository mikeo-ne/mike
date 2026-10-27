/**
 * Clockwork runner (server-only): executes scheduled tasks.
 *
 * Each run: builds the briefing prompt (Mike core + live context + the task's
 * own instructions), runs a non-streaming agentic loop with the profile's
 * enabled tools, saves the result as a Project Hub brief, optionally delivers
 * a spoken version (Telegram voice note and/or Twilio phone call), and
 * records everything in `scheduled_runs`.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { generateText, type LanguageModel } from 'ai';
import { getDb, schema } from '@/db';
import {
  apiKeyFor,
  defaultModel,
  defaultProvider,
  maxSteps,
} from '@/lib/ai/config';
import { MIKE_EXECUTIVE_PROMPT } from '@/lib/ai/executive';
import { buildSdkTools, resolveChatModel } from '@/lib/ai/sdk';
import '@/lib/tools';
import { saveWorkspaceBrief } from '@/lib/tools/projects';
import { getProfilePreferences } from '@/lib/settings';
import { defaultAlertPhone, placeCall } from '@/lib/calls/twilio';
import {
  defaultTelegramChat,
  sendTelegramMessage,
  sendTelegramVoice,
} from '@/lib/notify/telegram';
import { synthesizeSpeech } from '@/lib/notify/speech';

export const CLOCKWORK_DUE_HOURS = 20;
const MAX_CRON_TASKS = 5;

export interface TaskRunResult {
  taskId: string;
  taskName: string;
  runId: string;
  status: 'ok' | 'error';
  briefId: string | null;
  callSid: string | null;
  telegramMessageId: string | null;
  summary: string | null;
  error: string | null;
}

function todayLabel(timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone ?? 'UTC',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function deliveryOf(task: typeof schema.scheduledTasks.$inferSelect): string[] {
  return Array.isArray(task.delivery)
    ? task.delivery.filter((d): d is string => typeof d === 'string')
    : [];
}

function appUrl(): string {
  const url = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (!url) {
    throw new Error(
      'Phone delivery needs APP_URL (your public site URL, e.g. https://mike-one-silk.vercel.app) so Twilio can fetch the call script.',
    );
  }
  return url;
}

/** Distills a written briefing into a 60–90 second spoken script. */
async function distillSpeechScript(
  model: LanguageModel,
  text: string,
): Promise<string> {
  const scripted = await generateText({
    model,
    system:
      'You turn a written briefing into a short spoken phone script. Plain sentences only — no markdown, no bullet characters, no URLs. 60–90 seconds when read aloud. Start with "Good morning" and the day.',
    prompt: `Briefing to distill:\n\n${text.slice(0, 6000)}`,
    maxSteps: 1,
  });
  const script = scripted.text.replace(/\s+/g, ' ').trim().slice(0, 1400);
  if (!script) throw new Error('Could not distill a spoken briefing script.');
  return script;
}

export async function runScheduledTask(taskId: string): Promise<TaskRunResult> {
  const { db } = await getDb();
  const rows = await db
    .select()
    .from(schema.scheduledTasks)
    .where(eq(schema.scheduledTasks.id, taskId))
    .limit(1);
  const task = rows[0];
  if (!task) throw new Error('Scheduled task not found.');

  const runId = randomUUID();
  const startedAt = new Date();
  await db.insert(schema.scheduledRuns).values({
    id: runId,
    taskId: task.id,
    profileId: task.profileId,
    status: 'ok',
    startedAt,
  });

  const fail = async (message: string): Promise<TaskRunResult> => {
    await db
      .update(schema.scheduledRuns)
      .set({ status: 'error', error: message, finishedAt: new Date() })
      .where(eq(schema.scheduledRuns.id, runId));
    await db
      .update(schema.scheduledTasks)
      .set({
        lastRunAt: new Date(),
        lastStatus: 'error',
        runCount: task.runCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.scheduledTasks.id, task.id));
    return {
      taskId: task.id,
      taskName: task.name,
      runId,
      status: 'error',
      briefId: null,
      callSid: null,
      telegramMessageId: null,
      summary: null,
      error: message,
    };
  };

  try {
    const prefs = await getProfilePreferences(task.profileId);
    const agentName = prefs.agentName || 'Mike';
    const provider = defaultProvider();
    const model = defaultModel(provider);
    const apiKey = apiKeyFor(provider);
    const chatModel = resolveChatModel(provider, model, apiKey);

    const contextBits: string[] = [
      `You are running autonomously as a scheduled Clockwork task ("${task.name}") — no user is watching. Do the work with tools, then write the final briefing.`,
      `Today is ${todayLabel(prefs.timezone)}${prefs.timezone ? ` (${prefs.timezone})` : ''}.`,
      `The user calls you "${agentName}" — refer to yourself by that name.`,
    ];
    if (prefs.timezone) {
      contextBits.push(`User timezone: ${prefs.timezone}. Interpret all relative dates in it.`);
    }
    if (prefs.schedulingRules) {
      contextBits.push(`User scheduling rules:\n${prefs.schedulingRules}`);
    }
    if (prefs.workdayStart || prefs.workdayEnd) {
      contextBits.push(
        `User workday: ${prefs.workdayStart ?? '…'}–${prefs.workdayEnd ?? '…'}.`,
      );
    }
    if (prefs.preferredCalendar === 'google') {
      contextBits.push('The user\'s preferred calendar is Google — default "calendar" parameters to "google".');
    }
    if (prefs.systemInstructions) {
      contextBits.push(`Additional personal instructions:\n${prefs.systemInstructions}`);
    }
    if (task.instructions.trim()) {
      contextBits.push(`This task's instructions:\n${task.instructions.trim()}`);
    }
    const system = `${MIKE_EXECUTIVE_PROMPT}\n\n[Live context]\n${contextBits.join('\n\n')}`;

    const briefing = await generateText({
      model: chatModel,
      system,
      prompt:
        'Produce the morning briefing for this scheduled task. Use your tools: pull today\'s agenda and the week\'s schedule, review open tasks and deadlines, check for conflicts, and arrange meetings where needed (propose concrete open slots inside the workday for anything that needs scheduling; do not double-book). ' +
        'Write the result as sharp Markdown: agenda, deadlines, conflicts, and top 3 next actions. Keep it skimmable.',
      tools: buildSdkTools(
        { profileId: task.profileId, timezone: prefs.timezone },
        { disabled: prefs.disabledTools },
      ),
      maxSteps: Math.min(maxSteps(), 6),
    });
    const text = briefing.text.trim() || '(The briefing came back empty.)';

    const briefId = await saveWorkspaceBrief(
      task.profileId,
      `${task.name} — ${todayLabel(prefs.timezone)}`,
      text,
    );

    const delivery = deliveryOf(task);
    let callSid: string | null = null;
    let telegramMessageId: string | null = null;

    // Spoken delivery: distill once, then fan out to phone and/or Telegram.
    let script: string | null = null;
    if (delivery.includes('call') || delivery.includes('telegram')) {
      script = await distillSpeechScript(chatModel, text);
    }

    if (delivery.includes('call')) {
      const to = task.phone?.trim() || defaultAlertPhone();
      if (!to) {
        throw new Error(
          'Call delivery needs a recipient: set ALERT_PHONE_NUMBER in secrets or a phone number on the task.',
        );
      }
      const base = appUrl();
      const placed = await placeCall({
        to,
        twimlUrl: `${base}/api/calls/briefing?run=${runId}`,
        statusCallbackUrl: `${base}/api/calls/status`,
      });
      callSid = placed.sid;
      // Stash the script on the run so the TwiML endpoint can speak it.
      await db
        .update(schema.scheduledRuns)
        .set({ outputSummary: script, callSid })
        .where(eq(schema.scheduledRuns.id, runId));
    }

    if (delivery.includes('telegram')) {
      const chatId = task.telegramChatId?.trim() || defaultTelegramChat();
      if (!chatId) {
        throw new Error(
          'Telegram delivery needs a recipient: set TELEGRAM_CHAT_ID in secrets or a chat id on the task (and /start your bot).',
        );
      }
      const audio = await synthesizeSpeech(script ?? text);
      const voice = await sendTelegramVoice(
        chatId,
        audio,
        `${task.name} — ${todayLabel(prefs.timezone)}`,
      );
      await sendTelegramMessage(
        chatId,
        `${task.name} — ${todayLabel(prefs.timezone)}\n\n${text}`,
      );
      telegramMessageId = String(voice.messageId);
      await db
        .update(schema.scheduledRuns)
        .set({ telegramMessageId, telegramStatus: 'sent' })
        .where(eq(schema.scheduledRuns.id, runId));
    }

    if (!delivery.includes('call')) {
      await db
        .update(schema.scheduledRuns)
        .set({ outputSummary: text.slice(0, 500), briefId })
        .where(eq(schema.scheduledRuns.id, runId));
    }

    await db
      .update(schema.scheduledRuns)
      .set({
        status: 'ok',
        briefId,
        callSid,
        telegramMessageId,
        telegramStatus: telegramMessageId ? 'sent' : null,
        finishedAt: new Date(),
        ...(delivery.includes('call') ? {} : { outputSummary: text.slice(0, 500) }),
      })
      .where(eq(schema.scheduledRuns.id, runId));
    await db
      .update(schema.scheduledTasks)
      .set({
        lastRunAt: new Date(),
        lastStatus: 'ok',
        runCount: task.runCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(schema.scheduledTasks.id, task.id));

    return {
      taskId: task.id,
      taskName: task.name,
      runId,
      status: 'ok',
      briefId,
      callSid,
      telegramMessageId,
      summary: text.slice(0, 300),
      error: null,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Scheduled run failed.');
  }
}

/** Runs every enabled task that hasn't run in the last due window. */
export async function runDueTasks(): Promise<TaskRunResult[]> {
  const { db } = await getDb();
  const cutoff = new Date(Date.now() - CLOCKWORK_DUE_HOURS * 3600_000);
  const due = await db
    .select()
    .from(schema.scheduledTasks)
    .where(
      and(
        eq(schema.scheduledTasks.enabled, true),
        or(
          isNull(schema.scheduledTasks.lastRunAt),
          lt(schema.scheduledTasks.lastRunAt, cutoff),
        )!,
      ),
    )
    .limit(MAX_CRON_TASKS);
  const results: TaskRunResult[] = [];
  for (const task of due) {
    results.push(await runScheduledTask(task.id));
  }
  return results;
}
