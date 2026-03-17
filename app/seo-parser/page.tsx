'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { FileDropzone } from '@/components/seo-parser/FileDropzone';
import { HistoryList } from '@/components/seo-parser/HistoryList';

export default function SEOParserPage() {
  const router = useRouter();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDrop = useCallback(
    async (droppedFiles: File[]) => {
      setIsUploading(true);
      setError(null);

      try {
        const formData = new FormData();
        if (sessionId) formData.append('sessionId', sessionId);
        droppedFiles.forEach((f) => formData.append('files', f));

        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Upload failed');

        setSessionId(data.sessionId);
        setFiles((prev) => Array.from(new Set([...prev, ...data.files])));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setIsUploading(false);
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
  };

  return (
    <div className="min-h-screen bg-[#f4f6f9] py-12 px-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display font-extrabold text-3xl text-[#1c2d4a] mb-2">SEO Parser</h1>
          <p className="text-gray-600 text-sm leading-relaxed">
            Upload Screaming Frog CSV exports to surface critical SEO issues, crawl metrics, and
            actionable recommendations.
          </p>
        </div>

        {/* Upload card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="font-semibold text-[#1c2d4a] text-sm mb-4 uppercase tracking-wide">
            Upload CSV Files
          </h2>
          <FileDropzone files={files} isUploading={isUploading} onDrop={handleDrop} />

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
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
                    </svg>
                    Analyzing…
                  </span>
                ) : (
                  `Analyze ${files.length} File${files.length !== 1 ? 's' : ''}`
                )}
              </button>
              <button
                onClick={handleReset}
                disabled={isParsing}
                className="px-4 py-3 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 text-sm transition-colors disabled:opacity-60"
              >
                Reset
              </button>
            </div>
          )}
        </div>

        {/* History */}
        <HistoryList />
      </div>
    </div>
  );
}
