import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  apiKeyFor,
  defaultModel,
  defaultProvider,
} from '@/lib/ai/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { mode } = await getDb();
    const provider = defaultProvider();
    const model = defaultModel(provider);
    return NextResponse.json({
      ok: true,
      provider,
      model,
      demoMode: !apiKeyFor(provider),
      database: mode,
      time: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Database unavailable',
      },
      { status: 500 },
    );
  }
}
