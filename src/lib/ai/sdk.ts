/**
 * Vercel AI SDK wiring (server-only).
 *
 * - resolveChatModel: OpenAI-compatible chat model (OPENAI_BASE_URL points it
 *   at Groq / OpenRouter / Ollama; unset = official OpenAI), Anthropic, or an
 *   in-house streaming demo mock when no API key is configured.
 * - buildSdkTools: adapts the registry tools (zod-validated + audited via
 *   executeTool) to AI SDK tool definitions for the agentic loop. Parameters
 *   are sent as strict JSON Schemas (every property required) because Groq
 *   rejects tool schemas with optional parameters.
 * - toModelMessages: maps stored transcript rows to CoreMessages, dropping
 *   orphaned tool calls/results so providers never see invalid history.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import {
  MockLanguageModelV1,
  simulateReadableStream,
} from 'ai/test';
import {
  jsonSchema,
  tool,
  type CoreAssistantMessage,
  type CoreMessage,
  type LanguageModel,
  type ToolSet,
} from 'ai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  executeTool,
  listTools,
  type ToolContext,
  type ToolDefinition,
} from '@/lib/tools';
import type { AgentMessage, ProviderName } from './types';

export function resolveChatModel(
  provider: ProviderName,
  model: string,
  apiKey: string | null,
): LanguageModel {
  if (!apiKey) return createDemoModel();
  if (provider === 'anthropic') {
    return createAnthropic({ apiKey })(model);
  }
  const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;
  if (baseURL && !/^https?:\/\//.test(baseURL)) {
    console.warn(
      `Ignoring invalid OPENAI_BASE_URL "${baseURL}" (must start with http:// or https://).`,
    );
  }
  return createOpenAI({
    apiKey,
    baseURL: baseURL && /^https?:\/\//.test(baseURL) ? baseURL : undefined,
  })(model);
}

type JsonSchemaInput = Parameters<typeof jsonSchema>[0];

/**
 * Converts a tool's zod parameters to the JSON Schema sent to the provider.
 * Groq strictly requires `required` to list EVERY key in `properties`
 * (optional params are rejected with "invalid JSON schema"), so all
 * properties are forced into `required`. Strict schemas are accepted by
 * OpenAI and Anthropic too. Execution-time validation still uses the
 * original zod schema (see executeTool), so the REST API keeps accepting
 * partial args.
 */
function strictParameters(def: ToolDefinition): JsonSchemaInput {
  const converted = zodToJsonSchema(def.parameters, {
    target: 'jsonSchema7',
  }) as unknown as {
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
  if (converted.properties && typeof converted.properties === 'object') {
    converted.required = Object.keys(converted.properties);
  }
  return converted as unknown as JsonSchemaInput;
}

/**
 * Adapts every registered tool to an AI SDK tool. Failures are returned as
 * `{ error }` results (instead of throwing) so the agent can explain the
 * failure and offer an alternative rather than aborting the run.
 */
export function buildSdkTools(
  ctx: ToolContext,
  opts?: { disabled?: string[] },
): ToolSet {
  const disabled = new Set(opts?.disabled ?? []);
  const tools: ToolSet = {};
  for (const def of listTools()) {
    if (disabled.has(def.name)) continue;
    tools[def.name] = tool({
      description: def.description,
      parameters: jsonSchema(strictParameters(def)),
      execute: async (args) => {
        try {
          return await executeTool(def.name, args ?? {}, ctx);
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }
  return tools;
}

export function toModelMessages(history: AgentMessage[]): CoreMessage[] {
  const callIds = new Set<string>();
  const resultIds = new Set<string>();
  for (const m of history) {
    if (m.role === 'assistant') {
      for (const tc of m.toolCalls ?? []) callIds.add(tc.id);
    } else if (m.role === 'tool' && m.toolCallId) {
      resultIds.add(m.toolCallId);
    }
  }
  // Keep only tool calls that have a matching result and vice versa —
  // partial (aborted) turns must not poison the next request.
  const kept = new Set([...callIds].filter((id) => resultIds.has(id)));

  const out: CoreMessage[] = [];
  for (const m of history) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'system') {
      out.push({ role: 'system', content: m.content });
    } else if (m.role === 'assistant') {
      const calls = (m.toolCalls ?? []).filter((tc) => kept.has(tc.id));
      if (calls.length === 0) {
        out.push({ role: 'assistant', content: m.content });
      } else {
        const content: CoreAssistantMessage['content'] = [];
        if (m.content) content.push({ type: 'text', text: m.content });
        for (const tc of calls) {
          content.push({
            type: 'tool-call',
            toolCallId: tc.id,
            toolName: tc.name,
            args: tc.args,
          });
        }
        out.push({ role: 'assistant', content });
      }
    } else if (m.role === 'tool' && m.toolCallId && kept.has(m.toolCallId)) {
      let result: unknown = m.content;
      try {
        result = JSON.parse(m.content);
      } catch {
        /* keep raw text */
      }
      out.push({
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: m.toolCallId,
            toolName: m.toolName ?? 'unknown',
            result,
          },
        ],
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Demo mode (no API key): a streaming mock model with a genuinely useful reply.
// ---------------------------------------------------------------------------

function lastUserText(prompt: readonly unknown[]): string {
  for (let i = prompt.length - 1; i >= 0; i -= 1) {
    const m = prompt[i] as { role?: unknown; content?: unknown };
    if (m?.role !== 'user') continue;
    if (typeof m.content === 'string' && m.content.trim()) return m.content.trim();
    if (Array.isArray(m.content)) {
      const part = m.content.find(
        (p): p is { type: 'text'; text: string } =>
          typeof p === 'object' &&
          p !== null &&
          (p as { type?: unknown }).type === 'text' &&
          typeof (p as { text?: unknown }).text === 'string',
      );
      if (part?.text.trim()) return part.text.trim();
    }
  }
  return '';
}

function demoReply(input: string): string {
  const quoted =
    input.length > 200 ? `"${input.slice(0, 200)}…"` : input ? `"${input}"` : '';
  return [
    `Hi! I'm **Mike**, your workspace AI assistant — currently running in **demo mode** (no API key configured), so I can't call the real AI or run tools from here.`,
    ``,
    quoted ? `You said: ${quoted}` : ``,
    `What I can do once an API key is added:`,
    ``,
    `- Manage your calendar with conflict checking ("what's on this week?", "schedule lunch tomorrow at 12:30")`,
    `- Track tasks and action items from chat`,
    `- Summarize projects and generate action plans into the **Project Hub**`,
    `- Remember workspace notes, briefs, and deadlines across conversations`,
    ``,
    `Add \`OPENAI_API_KEY\` (works with Groq's free tier via \`OPENAI_BASE_URL\`) or \`ANTHROPIC_API_KEY\` to your secrets and redeploy for the full experience.`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}

function chunkText(text: string, size = 24): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks.length > 0 ? chunks : [''];
}

export function createDemoModel(): LanguageModel {
  const buildReply = (prompt: readonly unknown[]): string =>
    demoReply(lastUserText(prompt));
  return new MockLanguageModelV1({
    provider: 'mike-demo',
    modelId: 'demo-mode',
    doGenerate: async (options) => ({
      text: buildReply(options.prompt),
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0 },
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
    doStream: async (options) => ({
      stream: simulateReadableStream({
        chunks: [
          ...chunkText(buildReply(options.prompt)).map((textDelta) => ({
            type: 'text-delta' as const,
            textDelta,
          })),
          {
            type: 'finish' as const,
            finishReason: 'stop' as const,
            usage: { promptTokens: 0, completionTokens: 0 },
          },
        ],
      }),
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  });
}
