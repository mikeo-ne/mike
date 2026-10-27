'use client';

import { useState } from 'react';
import { CalendarDays, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SystemPromptDto } from '@/lib/client-api';
import { CalendarPanel } from './CalendarPanel';
import { PromptsPanel } from './PromptsPanel';

type Tab = 'calendar' | 'prompts';

interface RightPanelProps {
  calendarRefreshKey: number;
  prompts: SystemPromptDto[];
  activePromptId: string | null;
  onSelectPrompt: (promptId: string) => void;
  onPromptsChanged: () => void;
  onClose: () => void;
}

export function RightPanel(props: RightPanelProps) {
  const {
    calendarRefreshKey,
    prompts,
    activePromptId,
    onSelectPrompt,
    onPromptsChanged,
    onClose,
  } = props;
  const [tab, setTab] = useState<Tab>('calendar');

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <div className="flex items-center gap-1 border-b border-slate-800 px-2 py-2">
        <button
          type="button"
          onClick={() => setTab('calendar')}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium',
            tab === 'calendar'
              ? 'bg-slate-800 text-slate-100'
              : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
          )}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          Calendar
        </button>
        <button
          type="button"
          onClick={() => setTab('prompts')}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium',
            tab === 'prompts'
              ? 'bg-slate-800 text-slate-100'
              : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Prompts
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 xl:hidden"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 p-3">
        {tab === 'calendar' ? (
          <CalendarPanel refreshKey={calendarRefreshKey} />
        ) : (
          <PromptsPanel
            prompts={prompts}
            activeId={activePromptId}
            onSelect={onSelectPrompt}
            onChanged={onPromptsChanged}
          />
        )}
      </div>
    </div>
  );
}
