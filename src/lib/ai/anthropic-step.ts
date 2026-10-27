/**
 * One streamed Anthropic Messages step with tool use. Server-only.
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  TextBlockParam,
  ToolResultBlockParam,
  ToolUseBlockParam,
} from '@anthropic-ai/sdk/resources/messages';
import { getAnthropicTools } from '@/lib/tools';
import type { AgentMessage, PendingToolCall } from './types';

type ContentBlock =
  | TextBlockParam
  | ToolUseBlockParam
  | ToolResultBlockParam;

function asBlocks(content: MessageParam['content']): ContentBlock[] {
  return (typeof content === 'string'
    ? [{ type: 'text' as const, text: content }]
    : (content as ContentBlock[]).slice()) as ContentBlock[];
}

function pushUser(messages: MessageParam[], block: ContentBlock) {
  const last = messages[messages.length - 1];
  if (last && last.role === 'user') {
    last.content = [...asBlocks(last.content), block] as MessageParam['content'];
  } else {
    messages.push({ role: 'user', content: [block] } as MessageParam);
  }
}

function pushAssistant(messages: MessageParam[], blocks: ContentBlock[]) {
  const last = messages[messages.length - 1];
  if (last && last.role === 'assistant') {
    last.content = [...asBlocks(last.content), ...blocks] as MessageParam['content'];
  } else {
    messages.push({ role: 'assistant', content: blocks } as MessageParam);
  }
}

/**
 * Converts our transcript to Anthropic's strict alternating user/assistant
 * turns, merging consecutive same-role messages.
 */
export function toAnthropicMessages(history: AgentMessage[]): MessageParam[] {
  const messages: MessageParam[] = [];
  for (const m of history) {
    if (m.role === 'system') continue; // sent via top-level `system`
    if (m.role === 'user') {
      pushUser(messages, { type: 'text', text: m.content });
    } else if (m.role === 'tool') {
      pushUser(messages, {
        type: 'tool_result',
        tool_use_id: m.toolCallId ?? '',
        content: m.content,
      });
    } else {
      const blocks: ContentBlock[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.args as Record<string, unknown>,
        });
      }
      if (blocks.length > 0) pushAssistant(messages, blocks);
    }
  }
  return messages;
}

export interface AnthropicStepResult {
  content: string;
  toolCalls: PendingToolCall[];
}

export async function runAnthropicStep(opts: {
  apiKey: string;
  model: string;
  system: string | null;
  history: AgentMessage[];
  signal?: AbortSignal;
  onText: (delta: string) => void;
}): Promise<AnthropicStepResult> {
  const client = new Anthropic({ apiKey: opts.apiKey });
  const stream = client.messages.stream(
    {
      model: opts.model,
      max_tokens: 4096,
      system: opts.system?.trim() ? opts.system : undefined,
      messages: toAnthropicMessages(opts.history),
      tools: getAnthropicTools(),
    },
    { signal: opts.signal },
  );

  for await (const event of stream) {
    if (opts.signal?.aborted) break;
    if (
      event.type === 'content_block_delta' &&
      event.delta.type === 'text_delta'
    ) {
      opts.onText(event.delta.text);
    }
  }

  const final = await stream.finalMessage();
  let content = '';
  const toolCalls: PendingToolCall[] = [];
  for (const block of final.content ?? []) {
    if (block.type === 'text') content += block.text;
    else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        args: (block.input ?? {}) as Record<string, unknown>,
      });
    }
  }
  return { content, toolCalls };
}
