# Upload Progress Bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a slim green progress bar inside the upload dropzone that fills from 0% → 100% as file batches are uploaded.

**Architecture:** Add `uploadProgress` state (0–100) to the SEO Parser page component, compute it from batch byte counts after each successful batch upload, and pass it as a prop to `FileDropzone` which renders the bar. No server changes needed.

**Tech Stack:** React (useState, useCallback), Tailwind CSS, TypeScript

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `app/seo-parser/page.tsx` | Add `uploadProgress` state, compute from batch bytes, reset on finish/reset, pass to FileDropzone |
| Modify | `components/seo-parser/FileDropzone.tsx` | Accept `uploadProgress` prop, render green progress bar + label when uploading |

---

## Task 1: Add progress tracking to `page.tsx`

**Files:**
- Modify: `app/seo-parser/page.tsx`

- [ ] **Step 1: Add `uploadProgress` state and wire it into `handleDrop` and `handleReset`**

Replace the entire file content with:

```tsx
'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FileDropzone } from '@/components/seo-parser/FileDropzone';
import { Spinner } from '@/components/Spinner';
import { HistoryList } from '@/components/seo-parser/HistoryList';

export default function SEOParserPage() {
  const router = useRouter();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDrop = useCallback(
    async (droppedFiles: File[]) => {
      setIsUploading(true);
      setUploadProgress(0);
      setError(null);

      try {
        // Split files into batches ≤40MB each to stay under Nginx's 50MB limit
        const MAX_BATCH_BYTES = 40 * 1024 * 1024;
        const batches: File[][] = [];
        let currentBatch: File[] = [];
        let currentBatchSize = 0;

        for (const file of droppedFiles) {
          if (currentBatch.length > 0 && currentBatchSize + file.size > MAX_BATCH_BYTES) {
            batches.push(currentBatch);
            currentBatch = [];
            currentBatchSize = 0;
          }
          currentBatch.push(file);
          currentBatchSize += file.size;
        }
        if (currentBatch.length > 0) batches.push(currentBatch);

        const totalBytes = droppedFiles.reduce((s, f) => s + f.size, 0);
        let uploadedBytes = 0;

        let activeSessionId = sessionId;
        const allFiles: string[] = [];

        for (const batch of batches) {
          const formData = new FormData();
          if (activeSessionId) formData.append('sessionId', activeSessionId);
          batch.forEach((f) => formData.append('files', f));

          const res = await fetch('/api/upload', { method: 'POST', body: formData });
          const data = await res.json();

          if (!res.ok) throw new Error(data.error || 'Upload failed');

          uploadedBytes += batch.reduce((s, f) => s + f.size, 0);
          setUploadProgress(Math.round((uploadedBytes / totalBytes) * 100));

          activeSessionId = data.sessionId;
          allFiles.push(...data.files);
        }

        setSessionId(activeSessionId);
        setFiles((prev) => Array.from(new Set([...prev, ...allFiles])));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setIsUploading(false);
        setUploadProgress(0);
      }
    },
    [sessionId]
  );

  const handleAnalyze = async () => {
    if (!sessionId) return;
    setIsParsing(true);
    setError(null);

    try {
      const res = await fetch(`/api/parse/${sessionId}`, { method: 'POST' });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Parsing failed');

      router.push(`/seo-parser/results/${sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parsing failed');
      setIsParsing(false);
    }
  };

  const handleReset = () => {
    setSessionId(null);
    setFiles([]);
    setError(null);
    setUploadProgress(0);
  };

  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-navy-deep py-12 px-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display font-extrabold text-3xl text-[#1c2d4a] dark:text-white mb-2">SEO Parser</h1>
          <p className="text-gray-600 dark:text-white/60 text-sm leading-relaxed">
            Upload Screaming Frog CSV exports to surface critical SEO issues, crawl metrics, and
            actionable recommendations.
          </p>
        </div>

        {/* Upload card */}
        <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6 mb-6">
          <h2 className="font-semibold text-[#1c2d4a] dark:text-white text-sm mb-4 uppercase tracking-wide">
            Upload CSV Files
          </h2>
          <FileDropzone
            files={files}
            isUploading={isUploading}
            uploadProgress={uploadProgress}
            onDrop={handleDrop}
          />

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {files.length > 0 && (
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={handleAnalyze}
                disabled={isParsing || isUploading}
                className="flex-1 bg-[#f5a623] text-[#1c2d4a] font-display font-bold text-sm px-6 py-3 rounded-lg hover:bg-[#e8971a] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isParsing ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner className="w-4 h-4" />
                    Analyzing…
                  </span>
                ) : (
                  `Analyze ${files.length} File${files.length !== 1 ? 's' : ''}`
                )}
              </button>
              <button
                onClick={handleReset}
                disabled={isParsing}
                className="px-4 py-3 border border-gray-200 dark:border-navy-border text-gray-600 dark:text-white/60 rounded-lg hover:bg-gray-50 dark:hover:bg-navy-light text-sm transition-colors disabled:opacity-60"
              >
                Reset
              </button>
            </div>
          )}
        </div>

        {/* Compare link */}
        <div className="text-center">
          <Link
            href="/seo-parser/diff"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-white/50 hover:text-[#1c2d4a] dark:hover:text-white transition-colors"
          >
            Compare two crawls
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>

        {/* History */}
        <HistoryList />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/seo-parser/page.tsx
git commit -m "feat: track upload progress by byte count across batches"
```

---

## Task 2: Add progress bar UI to `FileDropzone.tsx`

**Files:**
- Modify: `components/seo-parser/FileDropzone.tsx`

- [ ] **Step 1: Update the component with `uploadProgress` prop and progress bar**

Replace the entire file content with:

```tsx
'use client';

import { useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';

interface FileDropzoneProps {
  files: string[];
  isUploading: boolean;
  uploadProgress?: number;
  onDrop: (files: File[]) => void;
}

export function FileDropzone({ files, isUploading, uploadProgress = 0, onDrop }: FileDropzoneProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (acceptedFiles: File[]) => {
      const validFiles = acceptedFiles.filter(
        (f) => f.name.toLowerCase().endsWith('.csv') || f.name.toLowerCase().endsWith('.txt')
      );
      if (validFiles.length > 0) onDrop(validFiles);
    },
    [onDrop]
  );

  const handleFolderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList) return;
      const validFiles = Array.from(fileList).filter(
        (f) => f.name.toLowerCase().endsWith('.csv') || f.name.toLowerCase().endsWith('.txt')
      );
      if (validFiles.length > 0) onDrop(validFiles);
      // Reset so the same folder can be re-selected if needed
      e.target.value = '';
    },
    [onDrop]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    accept: { 'text/csv': ['.csv'], 'text/plain': ['.txt'] },
    multiple: true,
    disabled: isUploading,
  });

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
          transition-colors duration-200
          ${isDragActive ? 'border-[#f5a623] bg-orange-50' : 'border-gray-300 dark:border-navy-border hover:border-[#f5a623]'}
          ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />
        <div className="space-y-2">
          <svg className="mx-auto h-12 w-12 text-gray-400 dark:text-white/40" stroke="currentColor" fill="none" viewBox="0 0 48 48">
            <path
              d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {isUploading ? (
            <div className="space-y-2 px-4">
              <div className="w-full bg-gray-200 dark:bg-navy-border rounded-full h-1.5">
                <div
                  className="bg-green-500 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-white/50">Uploading… {uploadProgress}%</p>
            </div>
          ) : isDragActive ? (
            <p className="text-[#f5a623] font-medium">Drop CSV or TXT files here</p>
          ) : (
            <>
              <p className="text-gray-600 dark:text-white/60">Drag and drop Screaming Frog CSV exports here</p>
              <p className="text-sm text-gray-500 dark:text-white/50">or click to select files (.csv, .txt)</p>
            </>
          )}
        </div>
      </div>

      {/* Hidden folder input — webkitdirectory is non-standard but widely supported */}
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error webkitdirectory is not in standard HTMLInputElement types
        webkitdirectory=""
        multiple
        className="hidden"
        onChange={handleFolderChange}
        disabled={isUploading}
        aria-hidden="true"
        tabIndex={-1}
      />

      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => folderInputRef.current?.click()}
          disabled={isUploading}
          className={`
            inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
            border border-gray-300 dark:border-navy-border
            text-gray-700 dark:text-white/70
            bg-white dark:bg-navy-card
            hover:border-[#f5a623] hover:text-[#f5a623] dark:hover:text-[#f5a623]
            transition-colors duration-200
            ${isUploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 7a2 2 0 012-2h4l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
            />
          </svg>
          Upload Folder
        </button>
      </div>

      {files.length > 0 && (
        <div className="bg-gray-50 dark:bg-navy-deep rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-white/70 mb-2">Uploaded Files ({files.length})</h3>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {files.map((file, index) => (
              <li key={index} className="text-sm text-gray-600 dark:text-white/60 flex items-center">
                <svg className="w-4 h-4 mr-2 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                {file}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: 804 tests pass, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add components/seo-parser/FileDropzone.tsx
git commit -m "feat: add green progress bar to upload dropzone"
```

---

## Post-implementation verification

- [ ] Start dev server: `npm run dev`
- [ ] Open `/seo-parser`, drop a folder of CSV files
- [ ] Confirm green bar appears and fills during upload, disappears when done
- [ ] Confirm percentage label updates alongside the bar
- [ ] Confirm error state still shows correctly if upload fails
- [ ] Run `npm run build` to confirm production build is clean
