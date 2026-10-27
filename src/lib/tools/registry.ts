/**
 * Tool framework — the server-side contract for agent actions
 * (Function Calling / Tool Use).
 *
 * To add a new capability:
 *   1. Create a file under `src/lib/tools/` (see `calendar.ts`).
 *   2. Call `defineTool({ name, description, parameters, execute })`.
 *   3. Import the file from `src/lib/tools/index.ts`.
 *
 * The tool then automatically becomes available to:
 *   - the agentic loop (`streamText` in `src/app/api/chat/route.ts`),
 *   - REST execution via `POST /api/tools/[name]`,
 *   - the machine-readable catalogue at `GET /api/tools`.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { getDb, schema } from '@/db';

export interface ToolContext {
  /** Anonymous owner id — tools MUST scope all reads/writes to it. */
  profileId: string;
  /** Active chat session, when invoked from a conversation. */
  sessionId?: string;
  /** User's saved IANA timezone, when set (see profile_settings). */
  timezone?: string | null;
}

export interface ToolDefinition<
  T extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>,
> {
  name: string;
  description: string;
  parameters: T;
  execute: (args: z.infer<T>, ctx: ToolContext) => Promise<unknown>;
}

const registry = new Map<string, ToolDefinition<z.ZodObject<z.ZodRawShape>>>();

export function defineTool<T extends z.ZodObject<z.ZodRawShape>>(
  def: ToolDefinition<T>,
): ToolDefinition<T> {
  if (registry.has(def.name)) {
    throw new Error(`Duplicate tool name: ${def.name}`);
  }
  registry.set(
    def.name,
    def as unknown as ToolDefinition<z.ZodObject<z.ZodRawShape>>,
  );
  return def;
}

export function getTool(name: string) {
  return registry.get(name);
}

export function listTools() {
  return [...registry.values()];
}

/** JSON Schema for a tool's parameters (sent to the LLM provider). */
export function toolJsonSchema(tool: ToolDefinition) {
  return zodToJsonSchema(tool.parameters, { target: 'jsonSchema7' });
}

/** OpenAI Chat Completions `tools` payload. */
export function getOpenAITools() {
  return listTools().map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: toolJsonSchema(t),
    },
  }));
}

/** Anthropic Messages `tools` payload. */
export function getAnthropicTools() {
  return listTools().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: toolJsonSchema(t) as {
      type: 'object';
      properties?: Record<string, unknown>;
      required?: string[];
    },
  }));
}

async function audit(
  ctx: ToolContext,
  toolName: string,
  args: Record<string, unknown> | null,
  status: 'ok' | 'error',
  result: unknown,
  error: string | null,
  durationMs: number,
): Promise<void> {
  try {
    const { db } = await getDb();
    await db.insert(schema.toolExecutions).values({
      id: randomUUID(),
      sessionId: ctx.sessionId ?? null,
      profileId: ctx.profileId,
      toolName,
      args,
      result: status === 'ok' ? (result as object) : null,
      status,
      error,
      durationMs,
    });
  } catch {
    // Auditing must never break tool execution.
  }
}

function sanitiseForJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return { value: String(value) };
  }
}

/**
 * Validates arguments against the tool's zod schema, executes the tool,
 * and writes an audit row. Used by the agent loop AND the REST API, so both
 * paths share validation, scoping, and observability.
 */
export async function executeTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  const tool = getTool(name);
  if (!tool) {
    throw new Error(
      `Unknown tool "${name}". Available: ${listTools()
        .map((t) => t.name)
        .join(', ')}`,
    );
  }
  const parsed = tool.parameters.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid arguments for "${name}": ${issues}`);
  }
  const started = Date.now();
  try {
    const result = sanitiseForJson(
      await tool.execute(parsed.data, ctx),
    ) as Record<string, unknown>;
    await audit(ctx, name, parsed.data, 'ok', result, null, Date.now() - started);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await audit(
      ctx,
      name,
      parsed.data as Record<string, unknown>,
      'error',
      null,
      message,
      Date.now() - started,
    );
    throw err instanceof Error ? err : new Error(message);
  }
}
