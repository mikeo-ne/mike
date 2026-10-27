/**
 * Tool catalogue entrypoint. Importing this module registers every tool.
 * Server-side only — never import from client components.
 */
import './time';
import './calendar';
import './agenda';
import './schedule';
import './workspace';
import './tasks';
import './projects';

export {
  defineTool,
  executeTool,
  getAnthropicTools,
  getOpenAITools,
  getTool,
  listTools,
  toolJsonSchema,
  type ToolContext,
  type ToolDefinition,
} from './registry';
