'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { FileDropzone } from '@/components/seo-parser/FileDropzone';
import { Spinner } from '@/components/Spinner';

export default function KeywordResearchPage() {
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
          formData.append('workflow', 'keyword-research');
          batch.forEach((f) => formData.append('files', f));

          const res = await fetch('/api/upload', { method: 'POST', body: formData });
          const data = await res.json();

          if (!res.ok) throw new Error(data.error || 'Upload failed');

          uploadedBytes += batch.reduce((s, f) => s + f.size, 0);
          setUploadProgress(totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : 0);

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

      router.push(`/keyword-research/${sessionId}`);
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
          <h1 className="font-display font-extrabold text-3xl text-[#1c2d4a] dark:text-white mb-2">Keyword Research</h1>
          <p className="text-gray-600 dark:text-white/60 text-sm leading-relaxed">
            Upload SEMRush exports to surface ranking keywords, cannibalization, quick wins, and
            content gaps — then generate a keyword strategy memo via Claude.
          </p>
        </div>

        {/* Upload card */}
        <div className="bg-white dark:bg-navy-card rounded-xl shadow-sm border border-gray-100 dark:border-navy-border p-6 mb-6">
          <h2 className="font-semibold text-[#1c2d4a] dark:text-white text-sm mb-4 uppercase tracking-wide">
            Upload SEMRush CSV Files
          </h2>
          <FileDropzone
            files={files}
            isUploading={isUploading}
            uploadProgress={uploadProgress}
            onDrop={handleDrop}
          />

          <div className="mt-4">
            <details className="text-sm text-gray-600 dark:text-white/60">
              <summary className="cursor-pointer font-medium text-[#1c2d4a] dark:text-white">
                Which SEMRush exports should I upload?
              </summary>
              <ul className="mt-2 space-y-1 list-disc ml-5">
                <li>
                  <span className="font-medium text-[#1c2d4a] dark:text-white">Organic Research → Positions</span>{' '}
                  — current ranking keywords (cannibalization, quick wins).
                </li>
                <li>
                  <span className="font-medium text-[#1c2d4a] dark:text-white">Organic Research → Pages</span>{' '}
                  — top organic pages by traffic.
                </li>
                <li>
                  <span className="font-medium text-[#1c2d4a] dark:text-white">Keyword Gap → &ldquo;Missing&rdquo;</span>{' '}
                  — content gap keywords competitors rank for that you don&rsquo;t.
                </li>
              </ul>
            </details>
          </div>

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
      </div>
    </div>
  );
}
