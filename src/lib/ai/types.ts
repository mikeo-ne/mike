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


