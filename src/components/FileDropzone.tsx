'use client';

import { useCallback, useRef, useState } from 'react';
import { CheckCircle2, FileUp, Files, Loader2, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/client-api';

const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPT = '.pdf,.txt,.md,.markdown';

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  status: 'uploading' | 'done' | 'error';
  detail: string;
}

let uploadId = 0;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function checkFile(f: File): string | null {
  const ext = (f.name.toLowerCase().split('.').pop() ?? '').trim();
  if (!['pdf', 'txt', 'md', 'markdown'].includes(ext)) {
    return `Only PDF and text files for now — not ".${ext}".`;
  }
  if (f.size > MAX_BYTES) {
    return `Too large (${formatBytes(f.size)}). Max 4MB on the free tier.`;
  }
  if (f.size === 0) return 'That file is empty.';
  return null;
}

/**
 * Drag-and-drop file upload zone. Dropped files upload immediately to
 * /api/workspace/ingest, which parses them into kind='document' workspace
 * entries that show in the Hub and are searchable by the agent.
 */
export function FileDropzone() {
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const upload = useCallback(async (id: string, file: File) => {
    try {
      const result = await api.ingestDocument(file);
      const bits = [
        `${result.chunks} ${result.chunks === 1 ? 'chunk' : 'chunks'}`,
        `${result.chars.toLocaleString()} chars`,
      ];
      if (result.pages) bits.unshift(`${result.pages} pages`);
      if (result.truncated) bits.push('truncated at 60k chars');
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? { ...f, status: 'done', detail: `Ingested — ${bits.join(' · ')}` }
            : f,
        ),
      );
    } catch (err) {
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                status: 'error',
                detail: err instanceof Error ? err.message : 'Upload failed.',
              }
            : f,
        ),
      );
    }
  }, []);

  const stage = useCallback(
    (incoming: FileList | File[]) => {
      const list = Array.from(incoming);
      if (list.length === 0) return;
      for (const f of list) {
        const id = `upload_${Date.now().toString(36)}_${(uploadId += 1)}`;
        const problem = checkFile(f);
        if (problem) {
          setFiles((prev) => [
            ...prev,
            { id, name: f.name, size: f.size, status: 'error', detail: problem },
          ]);
          continue;
        }
        setFiles((prev) => [
          ...prev,
          {
            id,
            name: f.name,
            size: f.size,
            status: 'uploading',
            detail: 'Uploading & parsing…',
          },
        ]);
        void upload(id, f);
      }
    },
    [upload],
  );

  const remove = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
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
        aria-label="Drop files to upload and ingest them"
      >
        <FileUp
          className={cn(
            'h-5 w-5',
            dragging ? 'text-indigo-300' : 'text-slate-500',
          )}
        />
        <span className="text-xs font-medium text-slate-300">
          {dragging ? 'Drop files to upload them' : 'Drag & drop files here'}
        </span>
        <span className="text-[11px] text-slate-500">
          or click to browse — PDF & text · max 4MB · lands in the Hub
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            stage(e.target.files ?? []);
            e.target.value = '';
          }}
        />
      </button>

      {files.length > 0 && (
        <div className="mt-2 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
            <Files className="h-3.5 w-3.5 text-slate-500" />
            Uploads ({files.length})
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {files.map((f) => (
              <li key={f.id} className="text-xs">
                <div className="flex items-center gap-2">
                  {f.status === 'uploading' && (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-indigo-300" />
                  )}
                  {f.status === 'done' && (
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  )}
                  {f.status === 'error' && (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-slate-300">
                    {f.name}
                  </span>
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
                </div>
                <p
                  className={cn(
                    'pl-5 text-[11px]',
                    f.status === 'done'
                      ? 'text-emerald-300'
                      : f.status === 'error'
                        ? 'text-red-300'
                        : 'text-slate-500',
                  )}
                >
                  {f.detail}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
