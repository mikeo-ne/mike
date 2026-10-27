'use client';

import { useCallback, useRef, useState } from 'react';
import { FileUp, Files, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StagedFile {
  id: string;
  name: string;
  size: number;
  type: string;
}

let stagedId = 0;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Drag-and-drop file upload zone. Files are staged in the browser only —
 * ingestion (parsing + indexing into the workspace) ships next, at which
 * point this component will POST to the ingestion endpoint.
 */
export function FileDropzone() {
  const [dragging, setDragging] = useState(false);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const stage = useCallback((files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setStaged((prev) => [
      ...prev,
      ...list.map((f) => ({
        id: `staged_${Date.now().toString(36)}_${(stagedId += 1)}`,
        name: f.name,
        size: f.size,
        type: f.type || 'unknown',
      })),
    ]);
  }, []);

  const remove = useCallback((id: string) => {
    setStaged((prev) => prev.filter((f) => f.id !== id));
  }, []);

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          e.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          stage(e.dataTransfer.files);
        }}
        className={cn(
          'flex w-full flex-col items-center gap-1 rounded-xl border border-dashed px-3 py-4 text-center transition',
          dragging
            ? 'border-indigo-400 bg-indigo-500/10'
            : 'border-slate-700 bg-slate-900/40 hover:border-slate-500 hover:bg-slate-900/70',
        )}
        aria-label="Drop files to stage them for ingestion"
      >
        <FileUp
          className={cn(
            'h-5 w-5',
            dragging ? 'text-indigo-300' : 'text-slate-500',
          )}
        />
        <span className="text-xs font-medium text-slate-300">
          {dragging ? 'Drop files to stage them' : 'Drag & drop files here'}
        </span>
        <span className="text-[11px] text-slate-500">
          or click to browse — ingestion coming soon
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            stage(e.target.files ?? []);
            e.target.value = '';
          }}
        />
      </button>

      {staged.length > 0 && (
        <div className="mt-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
            <Files className="h-3.5 w-3.5 text-slate-500" />
            Staged locally ({staged.length}) — not uploaded yet
          </div>
          <ul className="mt-1.5 space-y-1">
            {staged.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-2 text-xs text-slate-400"
              >
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-slate-600">
                  {formatBytes(f.size)}
                </span>
                <button
                  type="button"
                  onClick={() => remove(f.id)}
                  className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                  aria-label={`Remove "${f.name}"`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
