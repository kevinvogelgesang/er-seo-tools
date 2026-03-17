'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';

interface FileDropzoneProps {
  files: string[];
  isUploading: boolean;
  onDrop: (files: File[]) => void;
}

export function FileDropzone({ files, isUploading, onDrop }: FileDropzoneProps) {
  const handleDrop = useCallback(
    (acceptedFiles: File[]) => {
      const csvFiles = acceptedFiles.filter((f) => f.name.toLowerCase().endsWith('.csv'));
      if (csvFiles.length > 0) onDrop(csvFiles);
    },
    [onDrop]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    accept: { 'text/csv': ['.csv'] },
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
          ${isDragActive ? 'border-[#f5a623] bg-orange-50' : 'border-gray-300 hover:border-[#f5a623]'}
          ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input {...getInputProps()} />
        <div className="space-y-2">
          <svg className="mx-auto h-12 w-12 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
            <path
              d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {isUploading ? (
            <p className="text-gray-600">Uploading...</p>
          ) : isDragActive ? (
            <p className="text-[#f5a623] font-medium">Drop CSV files here</p>
          ) : (
            <>
              <p className="text-gray-600">Drag and drop Screaming Frog CSV exports here</p>
              <p className="text-sm text-gray-500">or click to select files</p>
            </>
          )}
        </div>
      </div>

      {files.length > 0 && (
        <div className="bg-gray-50 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Uploaded Files ({files.length})</h3>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {files.map((file, index) => (
              <li key={index} className="text-sm text-gray-600 flex items-center">
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
