import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { prisma } from '@/lib/db';
import { isValidSessionId, getUploadDir } from '@/lib/upload-helpers';
import { BriefService } from '@/lib/services/brief.service';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ sessionId: string }> };

function detectFileType(filename: string, content: string): 'internal' | 'structured' | 'semrush' | 'unknown' {
  const nameLower = filename.toLowerCase();
  const contentPreview = content.slice(0, 3000).toLowerCase();

  if (nameLower.includes('internal') && (nameLower.includes('all') || nameLower.includes('html'))) return 'internal';
  if (contentPreview.includes('address') && contentPreview.includes('statuscode')) return 'internal';
  if (nameLower.includes('structured') || nameLower.includes('schema')) return 'structured';
  if (contentPreview.includes('schematype') || contentPreview.includes('itemtype') || contentPreview.includes('type-1')) return 'structured';
  if (nameLower.includes('semrush') || nameLower.includes('keyword') || nameLower.includes('position') || nameLower.includes('organic') || nameLower.includes('ranking')) return 'semrush';
  if (contentPreview.includes('searchvolume') || contentPreview.includes('search volume') || contentPreview.includes('keyword difficulty') || (contentPreview.includes('keyword') && contentPreview.includes('position')) || (contentPreview.includes('keyword') && contentPreview.includes('volume'))) return 'semrush';

  return 'unknown';
}

/**
 * POST /api/brief/:sessionId
 * Generate an AI-ready brief from uploaded files.
 * Body: { clientName: string }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { sessionId } = await params;
  const body = await request.json().catch(() => ({}));
  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : '';

  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
  }
  if (!clientName) {
    return NextResponse.json({ error: 'Client name is required' }, { status: 400 });
  }

  try {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const uploadDir = getUploadDir(sessionId);
    const briefService = new BriefService();
    const filesProcessed: Array<{ name: string; type: string; count: number }> = [];
    let sessionFiles: string[] = [];
    try { sessionFiles = JSON.parse(session.files) as string[]; } catch { sessionFiles = []; }

    for (const filename of sessionFiles) {
      const filePath = path.join(uploadDir, filename);
      try { await fs.access(filePath); } catch { continue; }

      const content = await fs.readFile(filePath, 'utf-8');
      const fileType = detectFileType(filename, content);

      switch (fileType) {
        case 'internal': {
          const count = briefService.parseInternalCsv(content);
          filesProcessed.push({ name: filename, type: 'ScreamingFrog Internal', count });
          break;
        }
        case 'structured': {
          const count = briefService.parseStructuredDataCsv(content);
          filesProcessed.push({ name: filename, type: 'ScreamingFrog Structured Data', count });
          break;
        }
        case 'semrush': {
          const count = briefService.parseSemrushCsv(content);
          filesProcessed.push({ name: filename, type: 'SEMRush Keywords', count });
          break;
        }
        default:
          filesProcessed.push({ name: filename, type: 'Unknown (skipped)', count: 0 });
      }
    }

    const result = briefService.generate(clientName);
    return NextResponse.json({ brief: result.brief, stats: result.stats, filesProcessed });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Brief generation error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
