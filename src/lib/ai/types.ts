/**
 * Shared AI/agent types (safe to import from client code — no secrets here).
 */
export type ProviderName = 'openai' | 'anthropic';

/** Provider-agnostic transcript message used by the agent loop. */
export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  /** role="assistant" that invoked tools */
  toolCalls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  /** role="tool" */
  toolName?: string;
  toolCallId?: string;
}

export interface PendingToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Events streamed from POST /api/chat as Server-Sent Events. */
export type StreamEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'notice'; message: string }
  | { type: 'text'; delta: string }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      args: Record<string, unknown>;
    }
  | { type: 'tool_result'; id: string; name: string; result: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string };

export function encodeStreamEvent(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
