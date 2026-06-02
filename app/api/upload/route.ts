import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { isValidSessionId, getUploadDir } from '@/lib/upload-helpers';

export const dynamic = 'force-dynamic';

function sanitizeFilename(filename: string): string {
  // Strip one level of directory prefix (webkitdirectory sends "FolderName/file.csv")
  const basename = filename.includes('/') ? filename.split('/').pop()! : filename;
  const sanitized = basename
    .replace(/[/\\]/g, '_')
    .replace(/\0/g, '')
    .replace(/\.\./g, '_');
  return sanitized || 'file.csv';
}

// Size-based upload rate limiting: 500MB per hour per IP
const UPLOAD_SIZE_LIMIT_BYTES = 500 * 1024 * 1024;
const DEFAULT_MAX_UPLOAD_BODY_BYTES = 100 * 1024 * 1024;
const UPLOAD_WINDOW_MS = 60 * 60 * 1000;

interface UploadTracker {
  totalBytes: number;
  windowStart: number;
}
const uploadSizeByIP = new Map<string, UploadTracker>();

function getMaxUploadBodyBytes(): number {
  const configured = Number(process.env.UPLOAD_MAX_BODY_BYTES);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_MAX_UPLOAD_BODY_BYTES;
}

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

function releaseUploadSize(ip: string, bytes: number) {
  const tracker = uploadSizeByIP.get(ip);
  if (!tracker) return;
  tracker.totalBytes = Math.max(0, tracker.totalBytes - bytes);
}

function getClientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function parseContentLength(request: NextRequest): number | null {
  const header = request.headers.get('content-length');
  if (!header) return null;

  const value = Number(header);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

async function hasBlockedBinarySignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (bytes.length < 2) return false;

  const isElf = bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46;
  const isPe = bytes[0] === 0x4d && bytes[1] === 0x5a;
  const isZip =
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08));

  return isElf || isPe || isZip;
}

/**
 * POST /api/upload
 * Accepts multipart/form-data with CSV files and an optional sessionId field.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const contentLength = parseContentLength(request);
    if (contentLength === null) {
      return NextResponse.json(
        { error: 'Content-Length header required for uploads' },
        { status: 411 }
      );
    }

    const maxUploadBodyBytes = getMaxUploadBodyBytes();
    if (contentLength > maxUploadBodyBytes) {
      return NextResponse.json(
        { error: `Upload body too large. Maximum request size is ${formatMB(maxUploadBodyBytes)}MB.` },
        { status: 413 }
      );
    }

    const preflight = checkUploadSizeLimit(ip, contentLength);
    if (!preflight.allowed) {
      const remainingMB = formatMB(preflight.remainingBytes);
      return NextResponse.json(
        { error: `Upload size limit exceeded. You have ${remainingMB}MB remaining this hour.` },
        { status: 429 }
      );
    }
    recordUploadSize(ip, contentLength);

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (error) {
      releaseUploadSize(ip, contentLength);
      throw error;
    }

    // Extract sessionId field (may be passed to add files to an existing session)
    const rawSessionId = formData.get('sessionId');
    const existingSessionId =
      typeof rawSessionId === 'string' && isValidSessionId(rawSessionId)
        ? rawSessionId
        : null;

    const sessionId = existingSessionId || randomUUID();

    // Workflow marker: keyword-research uploads (SEMRush exports) must not trigger
    // pillar analysis or pollute the technical client SEO trend. Default 'technical'.
    const rawWorkflow = formData.get('workflow');
    const workflow = rawWorkflow === 'keyword-research' ? 'keyword-research' : 'technical';

    // Collect all file entries
    const fileEntries: { file: File; filename: string }[] = [];
    for (const [, value] of Array.from(formData.entries())) {
      if (value instanceof File && value.size > 0) {
        const ext = path.extname(value.name).toLowerCase();
        if (ext === '.csv' || ext === '.txt' || value.type === 'text/csv') {
          if (await hasBlockedBinarySignature(value)) {
            releaseUploadSize(ip, contentLength);
            return NextResponse.json(
              { error: 'Invalid file content. Executables and archives are not accepted.' },
              { status: 400 }
            );
          }
          fileEntries.push({ file: value, filename: sanitizeFilename(value.name) });
        }
      }
    }

    if (fileEntries.length === 0) {
      releaseUploadSize(ip, contentLength);
      return NextResponse.json({ error: 'No valid files uploaded. Only .csv and .txt files are accepted.' }, { status: 400 });
    }

    // Validate existing session before writing new files.
    const existingSession = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { files: true, status: true },
    });

    if (existingSession) {
      if (existingSession.status !== 'pending') {
        releaseUploadSize(ip, contentLength);
        return NextResponse.json(
          { error: `Cannot add files to a ${existingSession.status} session` },
          { status: 409 }
        );
      }

      let existingFiles: string[] = [];
      try {
        const p = JSON.parse(existingSession.files);
        if (!Array.isArray(p)) throw new Error('files must be an array');
        existingFiles = p;
      } catch {
        releaseUploadSize(ip, contentLength);
        return NextResponse.json({ error: 'Session file manifest is corrupt' }, { status: 409 });
      }
    }

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
    if (existingSession) {
      const p = JSON.parse(existingSession.files);
      const existingFiles = p as string[];
      const updatedFiles = Array.from(new Set([...existingFiles, ...fileNames]));
      await prisma.session.update({
        where: { id: sessionId },
        // Honor an explicit keyword-research workflow on a still-pending append (avoids a stale 'technical' marker).
        data: { files: JSON.stringify(updatedFiles), ...(workflow === 'keyword-research' ? { workflow } : {}) },
      });
    } else {
      await prisma.session.create({
        data: {
          id: sessionId,
          files: JSON.stringify(fileNames),
          status: 'pending',
          workflow,
        },
      });
    }

    const remainingBytes = Math.max(0, preflight.remainingBytes - contentLength);
    const remainingMB = formatMB(remainingBytes);
    return NextResponse.json({
      sessionId,
      files: fileNames,
      message: `Uploaded ${fileNames.length} file(s) successfully`,
      remainingUploadQuotaMB: parseFloat(remainingMB),
    });
  } catch (error) {
    console.error('[upload] caught error:', error);
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
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, createdAt: true, status: true, files: true },
    });

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
