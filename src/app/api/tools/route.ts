import { NextResponse } from 'next/server';
import { listTools, toolJsonSchema } from '@/lib/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Machine-readable catalogue of every registered agent tool. */
export async function GET() {
  const tools = listTools().map((t) => ({
    name: t.name,
    description: t.description,
    parameters: toolJsonSchema(t),
  }));
  return NextResponse.json({ tools, count: tools.length });
}
