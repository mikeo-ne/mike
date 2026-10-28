'use client';

import { useState } from 'react';
import {
  Bot,
  CalendarDays,
  Clock,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Settings,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SystemPromptDto } from '@/lib/client-api';
import AgentPanel from './AgentPanel';
import { CalendarPanel } from './CalendarPanel';
import ClockworkPanel from './ClockworkPanel';
import { DashboardPanel } from './DashboardPanel';
import { ProjectHub } from './ProjectHub';
import { PromptsPanel } from './PromptsPanel';
import { SettingsPanel } from './SettingsPanel';
import { WorkspacePanel } from './WorkspacePanel';

type Tab =
  | 'dashboard'
  | 'hub'
  | 'clockwork'
  | 'agent'
  | 'calendar'
  | 'workspace'
  | 'prompts'
  | 'settings';

const TABS: Array<{ id: Tab; label: string; icon: typeof CalendarDays }> = [
  { id: 'dashboard', label: 'Today', icon: LayoutDashboard },
  { id: 'hub', label: 'Projects', icon: FolderKanban },
  { id: 'clockwork', label: 'Briefings', icon: Clock },
  { id: 'agent', label: 'Agent', icon: Bot },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'workspace', label: 'Notes', icon: FileText },
  { id: 'prompts', label: 'Styles', icon: SlidersHorizontal },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface RightPanelProps {
  calendarRefreshKey: number;
  prompts: SystemPromptDto[];
  activePromptId: string | null;
  provider: string;
  model: string;
  demoMode: boolean;
  onSelectPrompt: (promptId: string) => void;
  onPromptsChanged: () => void;
  onClose: () => void;
}

export function RightPanel(props: RightPanelProps) {
  const {
    calendarRefreshKey,
    prompts,
    activePromptId,
    provider,
    model,
    demoMode,
    onSelectPrompt,
    onPromptsChanged,
    onClose,
  } = props;
  const [tab, setTab] = useState<Tab>('dashboard');

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 pb-1.5 pt-2.5">
        <LayoutDashboard className="h-4 w-4 text-indigo-400" />
        <span className="text-sm font-bold tracking-tight text-slate-50">
          Mike&apos;s Dashboard
        </span>
        <span className="flex items-center gap-1 text-[10px] text-emerald-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          live
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 xl:hidden"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex items-stretch gap-1 overflow-x-auto border-b border-slate-800 px-2 py-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[10px] font-medium',
              tab === t.id
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'dashboard' && (
          <DashboardPanel
            refreshKey={calendarRefreshKey}
            onNavigate={(t) => setTab(t)}
          />
        )}
        {tab === 'hub' && <ProjectHub refreshKey={calendarRefreshKey} />}
        {tab === 'clockwork' && <ClockworkPanel />}
        {tab === 'agent' && <AgentPanel />}
        {tab === 'calendar' && <CalendarPanel refreshKey={calendarRefreshKey} />}
        {tab === 'workspace' && (
          <WorkspacePanel refreshKey={calendarRefreshKey} />
        )}
        {tab === 'prompts' && (
          <PromptsPanel
            prompts={prompts}
            activeId={activePromptId}
            onSelect={onSelectPrompt}
            onChanged={onPromptsChanged}
          />
        )}
        {tab === 'settings' && (
          <SettingsPanel
            provider={provider}
            model={model}
            demoMode={demoMode}
          />
        )}
      </div>
    </div>
  );
}
