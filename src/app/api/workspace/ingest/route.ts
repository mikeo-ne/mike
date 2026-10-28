import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { PDFParse } from 'pdf-parse';
import { getDb, schema } from '@/db';
import { applyProfileCookie, resolveProfile } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Vercel's free tier caps serverless request payloads at 4.5MB — stay under.
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_CHARS = 60000;
const CHUNK_CHARS = 8000;

/** Splits text into ~CHUNK_CHARS pieces on paragraph boundaries. */
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const para of text.split(/\n\n+/)) {
    const piece = para.trim();
    if (!piece) continue;
    if ((current + '\n\n' + piece).length > CHUNK_CHARS && current) {
      chunks.push(current.trim());
      current = '';
    }
    // A single giant paragraph gets hard-split.
    let rest = piece;
    while (rest.length > CHUNK_CHARS) {
      chunks.push((current ? current + '\n\n' : '') + rest.slice(0, CHUNK_CHARS));
      current = '';
      rest = rest.slice(CHUNK_CHARS);
    }
    current = current ? `${current}\n\n${rest}` : rest;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * POST multipart/form-data with a `file` field. Parses PDF / text uploads
 * and stores them as kind='document' workspace entries (chunked), so the
 * agent can retrieve them via get_project_context and they show in the Hub.
 */
export async function POST(req: Request) {
  const { profileId, setCookie } = resolveProfile(req);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'Expected a multipart file upload.' },
      { status: 400 },
    );
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: 'No file uploaded (form field "file").' },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        error: `That file is ${(file.size / 1048576).toFixed(1)}MB — the free tier caps uploads at 4MB. Split it or export fewer pages.`,
      },
      { status: 400 },
    );
  }
  const name = (file.name || 'upload').trim().slice(0, 120) || 'upload';
  const ext = name.toLowerCase().split('.').pop() ?? '';

  let text = '';
  let pages: number | null = null;
  if (ext === 'pdf') {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const parser = new PDFParse({ data: bytes });
      const result = await parser.getText();
      text = result.text ?? '';
      pages = Array.isArray(result.pages) ? result.pages.length : null;
    } catch (err) {
      return NextResponse.json(
        {
          error: `Could not read that PDF (${err instanceof Error ? err.message : 'parse failed'}). If it is a scan (photos of pages), it has no text — re-export it as a real PDF first.`,
        },
        { status: 400 },
      );
    }
  } else if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
    text = await file.text();
  } else {
    return NextResponse.json(
      { error: `Only PDF and text files for now (.pdf, .txt, .md) — not ".${ext}".` },
      { status: 400 },
    );
  }

  text = cleanText(text);
  if (!text) {
    return NextResponse.json(
      {
        error:
          'No readable text found in that file. Scanned PDFs (photos of pages) need OCR — re-export it as a real PDF first.',
      },
      { status: 400 },
    );
  }
  let truncated = false;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    truncated = true;
  }
  const chunks = chunkText(text);

  const { db } = await getDb();
  const items: Array<{ id: string; title: string }> = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const title =
      chunks.length > 1 ? `${name} — part ${i + 1}/${chunks.length}` : name;
    const header =
      i === 0
        ? `[Uploaded document: ${name}${pages ? `, ${pages} pages` : ''}]\n\n`
        : '';
    const [row] = await db
      .insert(schema.workspaceContext)
      .values({
        id: randomUUID(),
        profileId,
        title: title.slice(0, 200),
        kind: 'document',
        content: header + chunks[i],
      })
      .returning({ id: schema.workspaceContext.id, title: schema.workspaceContext.title });
    items.push({ id: row.id, title: row.title });
  }

  const res = NextResponse.json(
    {
      ok: true,
      filename: name,
      kind: 'document',
      chunks: chunks.length,
      chars: text.length,
      pages,
      truncated,
      items,
    },
    { status: 201 },
  );
  applyProfileCookie(res.headers, setCookie);
  return res;
}
