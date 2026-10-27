/**
 * One streamed OpenAI Chat Completions step with function calling.
 * Server-only.
 */
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { getOpenAITools } from '@/lib/tools';
import type { AgentMessage, PendingToolCall } from './types';

export function toOpenAIMessages(
  system: string | null,
  history: AgentMessage[],
): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [];
  if (system?.trim()) {
    messages.push({ role: 'system', content: system });
  }
  for (const m of history) {
    if (m.role === 'user') {
      messages.push({ role: 'user', content: m.content });
    } else if (m.role === 'system') {
      messages.push({ role: 'system', content: m.content });
    } else if (m.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: m.toolCallId ?? '',
        content: m.content,
      });
    } else {
      // assistant
      if (m.toolCalls?.length) {
        messages.push({
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        });
      } else {
        messages.push({ role: 'assistant', content: m.content });
      }
    }
  }
  return messages;
}

export interface OpenAIStepResult {
  content: string;
  toolCalls: PendingToolCall[];
}

export async function runOpenAIStep(opts: {
  apiKey: string;
  model: string;
  system: string | null;
  history: AgentMessage[];
  signal?: AbortSignal;
  onText: (delta: string) => void;
}): Promise<OpenAIStepResult> {
  // OPENAI_BASE_URL (optional) points Mike at any OpenAI-compatible API —
  // Groq / OpenRouter free tiers, Ollama, etc. Unset = official OpenAI.
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
  });
  const stream = await client.chat.completions.create(
    {
      model: opts.model,
      messages: toOpenAIMessages(opts.system, opts.history),
      tools: getOpenAITools() as ChatCompletionTool[],
      tool_choice: 'auto',
      stream: true,
    },
    { signal: opts.signal },
  );

  let content = '';
  const acc = new Map<
    number,
    { id: string; name: string; argsJson: string }
  >();

  for await (const chunk of stream) {
    if (opts.signal?.aborted) break;
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      content += delta.content;
      opts.onText(delta.content);
    }
    for (const tc of delta.tool_calls ?? []) {
      const slot = acc.get(tc.index) ?? { id: '', name: '', argsJson: '' };
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name = tc.function.name;
      if (tc.function?.arguments) slot.argsJson += tc.function.arguments;
      acc.set(tc.index, slot);
    }
  }

  const toolCalls: PendingToolCall[] = [];
  for (const slot of [...acc.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, v]) => v)) {
    if (!slot.name) continue;
    let args: Record<string, unknown> = {};
    try {
      args = slot.argsJson ? JSON.parse(slot.argsJson) : {};
    } catch {
      args = { _raw: slot.argsJson };
    }
    toolCalls.push({ id: slot.id, name: slot.name, args });
  }
  return { content, toolCalls };
}
