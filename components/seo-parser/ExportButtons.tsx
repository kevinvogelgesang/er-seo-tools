'use client';

interface ExportButtonsProps {
  sessionId: string;
}

export function ExportButtons({ sessionId }: ExportButtonsProps) {
  const handleExport = (format: 'json' | 'summary' | 'markdown') => {
    window.open(`/api/export/${sessionId}/${format}`, '_blank');
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => handleExport('json')}
        className="px-4 py-2 bg-[#1c2d4a] text-white rounded-lg hover:bg-[#0f1d30] transition-colors text-sm font-medium"
      >
        Export JSON
      </button>
      <button
        onClick={() => handleExport('summary')}
        className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
      >
        Export Summary
      </button>
      <button
        onClick={() => handleExport('markdown')}
        className="px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors text-sm font-medium"
      >
        Export Markdown
      </button>
    </div>
  );
}
