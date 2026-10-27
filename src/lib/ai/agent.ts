/**
 * Agentic loop: model → tool calls → execute tools server-side → model …
 * until a text-only answer is produced or `maxSteps` is reached.
 * Server-only.
 */
import { randomUUID } from 'node:crypto';
import { executeTool, type ToolContext } from '@/lib/tools';
import { safeJson } from '@/lib/utils';
import type { AgentMessage, ProviderName, StreamEvent } from './types';
import { runOpenAIStep } from './openai-step';
import { runAnthropicStep } from './anthropic-step';

export type Emit = (event: StreamEvent) => void;

export interface AgentRunOptions {
  provider: ProviderName;
  model: string;
  apiKey: string;
  system: string | null;
  history: AgentMessage[];
  toolContext: ToolContext;
  maxSteps: number;
  signal?: AbortSignal;
}

export interface AgentRunResult {
  /** The new transcript suffix produced by this run (assistant + tool msgs). */
  produced: AgentMessage[];
  steps: number;
}

export async function runAgent(
  opts: AgentRunOptions,
  emit: Emit,
): Promise<AgentRunResult> {
  const transcript: AgentMessage[] = [...opts.history];
  const produced: AgentMessage[] = [];
  let steps = 0;

  for (let step = 1; step <= opts.maxSteps; step += 1) {
    if (opts.signal?.aborted) break;
    steps = step;

    const onText = (delta: string) => emit({ type: 'text', delta });
    const stepResult =
      opts.provider === 'anthropic'
        ? await runAnthropicStep({
            apiKey: opts.apiKey,
            model: opts.model,
            system: opts.system,
            history: transcript,
            signal: opts.signal,
            onText,
          })
        : await runOpenAIStep({
            apiKey: opts.apiKey,
            model: opts.model,
            system: opts.system,
            history: transcript,
            signal: opts.signal,
            onText,
          });

    const toolCalls = stepResult.toolCalls.map((tc) => ({
      ...tc,
      id: tc.id || `call_${randomUUID()}`,
    }));

    if (toolCalls.length === 0) {
      const msg: AgentMessage = { role: 'assistant', content: stepResult.content };
      transcript.push(msg);
      produced.push(msg);
      break;
    }

    const assistantMsg: AgentMessage = {
      role: 'assistant',
      content: stepResult.content,
      toolCalls,
    };
    transcript.push(assistantMsg);
    produced.push(assistantMsg);

    for (const tc of toolCalls) {
      if (opts.signal?.aborted) break;
      emit({ type: 'tool_call', id: tc.id, name: tc.name, args: tc.args });
      let result: unknown;
      try {
        result = await executeTool(tc.name, tc.args, opts.toolContext);
      } catch (err) {
        result = {
          error: err instanceof Error ? err.message : String(err),
        };
      }
      emit({ type: 'tool_result', id: tc.id, name: tc.name, result });
      const toolMsg: AgentMessage = {
        role: 'tool',
        content: safeJson(result),
        toolName: tc.name,
        toolCallId: tc.id,
      };
      transcript.push(toolMsg);
      produced.push(toolMsg);
    }
  }

  return { produced, steps };
}
