import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { isValidSessionId, getUploadDir } from '@/lib/upload-helpers';

export const dynamic = 'force-dynamic';

function sanitizeFilename(filename: string): string {
  const sanitized = filename
    .replace(/[/\\]/g, '_')
    .replace(/\0/g, '')
    .replace(/\.\./g, '_');
  return sanitized || 'file.csv';
}

// Size-based upload rate limiting: 500MB per hour per IP
const UPLOAD_SIZE_LIMIT_BYTES = 500 * 1024 * 1024;
const UPLOAD_WINDOW_MS = 60 * 60 * 1000;

interface UploadTracker {
  totalBytes: number;
  windowStart: number;
}
const uploadSizeByIP = new Map<string, UploadTracker>();

function checkUploadSizeLimit(ip: string, incomingBytes: number) {
  const now = Date.now();
  let tracker = uploadSizeByIP.get(ip);
  if (!tracker || now - tracker.windowStart > UPLOAD_WINDOW_MS) {
    tracker = { totalBytes: 0, windowStart: now };
    uploadSizeByIP.set(ip, tracker);
  }
  const remainingBytes = UPLOAD_SIZE_LIMIT_BYTES - tracker.totalBytes;
  return { allowed: incomingBytes <= remainingBytes, remainingBytes };
}

function recordUploadSize(ip: string, bytes: number) {
  const now = Date.now();
  let tracker = uploadSizeByIP.get(ip);
  if (!tracker || now - tracker.windowStart > UPLOAD_WINDOW_MS) {
    tracker = { totalBytes: 0, windowStart: now };
    uploadSizeByIP.set(ip, tracker);
  }
  tracker.totalBytes += bytes;
}

/**
 * POST /api/upload
 * Accepts multipart/form-data with CSV files and an optional sessionId field.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    // Extract sessionId field (may be passed to add files to an existing session)
    const rawSessionId = formData.get('sessionId');
    const existingSessionId =
      typeof rawSessionId === 'string' && isValidSessionId(rawSessionId)
        ? rawSessionId
        : null;

    const sessionId = existingSessionId || randomUUID();

    // Collect all file entries
    const fileEntries: { file: File; filename: string }[] = [];
    for (const [, value] of Array.from(formData.entries())) {
      if (value instanceof File && value.size > 0) {
        const ext = path.extname(value.name).toLowerCase();
        if (ext === '.csv' || value.type === 'text/csv') {
          fileEntries.push({ file: value, filename: sanitizeFilename(value.name) });
        }
      }
    }

    if (fileEntries.length === 0) {
      return NextResponse.json({ error: 'No CSV files uploaded' }, { status: 400 });
    }

    // Check upload size limit
    const totalBytes = fileEntries.reduce((sum, e) => sum + e.file.size, 0);
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    const { allowed, remainingBytes } = checkUploadSizeLimit(ip, totalBytes);

    if (!allowed) {
      const remainingMB = (remainingBytes / (1024 * 1024)).toFixed(1);
      return NextResponse.json(
        { error: `Upload size limit exceeded. You have ${remainingMB}MB remaining this hour.` },
        { status: 429 }
      );
    }

    recordUploadSize(ip, totalBytes);

    // Write files to disk
    const uploadDir = getUploadDir(sessionId);
    await fs.mkdir(uploadDir, { recursive: true });

    const fileNames: string[] = [];
    await Promise.all(
      fileEntries.map(async ({ file, filename }) => {
        const dest = path.join(uploadDir, filename);
        const buffer = Buffer.from(await file.arrayBuffer());
        await fs.writeFile(dest, buffer);
        fileNames.push(filename);
      })
    );

    // Create or update session in DB
    const existingSession = await prisma.session.findUnique({ where: { id: sessionId } });

    if (existingSession) {
      let existingFiles: string[] = [];
      try { const p = JSON.parse(existingSession.files); existingFiles = Array.isArray(p) ? p : []; } catch { existingFiles = []; }
      const updatedFiles = Array.from(new Set([...existingFiles, ...fileNames]));
      await prisma.session.update({
        where: { id: sessionId },
        data: { files: JSON.stringify(updatedFiles) },
      });
    } else {
      await prisma.session.create({
        data: {
          id: sessionId,
          files: JSON.stringify(fileNames),
          status: 'pending',
        },
      });
    }

    const remainingMB = ((remainingBytes - totalBytes) / (1024 * 1024)).toFixed(1);
    return NextResponse.json({
      sessionId,
      files: fileNames,
      message: `Uploaded ${fileNames.length} file(s) successfully`,
      remainingUploadQuotaMB: parseFloat(remainingMB),
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Failed to upload files' }, { status: 500 });
  }
}

/**
 * GET /api/upload?sessionId=xxx
 * Return session info (file list, status — no full result).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId') || '';

  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
  }

  try {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    let files: string[] = [];
    try { files = JSON.parse(session.files); } catch { files = []; }
    return NextResponse.json({
      id: session.id,
      createdAt: session.createdAt,
      status: session.status,
      files,
    });
  } catch (error) {
    console.error('Get session error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
