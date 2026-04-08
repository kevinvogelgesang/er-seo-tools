'use client';

import { useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';

interface FileDropzoneProps {
  files: string[];
  isUploading: boolean;
  onDrop: (files: File[]) => void;
}

export function FileDropzone({ files, isUploading, onDrop }: FileDropzoneProps) {
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
            <p className="text-gray-600 dark:text-white/60">Uploading...</p>
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
