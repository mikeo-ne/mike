/**
 * Shared workspace-context constants (safe for client + server).
 */
export const WORKSPACE_KINDS = ['note', 'project', 'guideline', 'brief', 'document'] as const;

export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export function isWorkspaceKind(value: unknown): value is WorkspaceKind {
  return (WORKSPACE_KINDS as readonly string[]).includes(value as string);
}
