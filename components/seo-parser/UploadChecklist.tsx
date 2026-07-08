'use client';
import React from 'react';
import { matchExpectedExports, type ExportTier } from '@/lib/parsers/expected-exports';

const TIER_LABEL: Record<ExportTier, string> = {
  core: 'Required',
  recommended: 'Recommended',
  optional: 'Optional',
};

export function UploadChecklist({ files }: { files: string[] }) {
  const coverage = matchExpectedExports(files);
  // Only flag missing core AFTER the user has selected files — an empty initial
  // state should not show a red "missing required exports" block.
  const missingCore = files.length > 0
    ? coverage.filter((c) => c.export.tier === 'core' && !c.present)
    : [];

  return (
    <div className="text-sm text-gray-600 dark:text-white/60 space-y-3">
      {missingCore.length > 0 && (
        <div
          data-testid="core-missing"
          className="p-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-300"
        >
          <p className="font-semibold">
            Missing required export{missingCore.length > 1 ? 's' : ''}:{' '}
            {missingCore.map((c) => c.export.label).join(', ')}
          </p>
          <ul className="mt-1 list-disc ml-5 space-y-1">
            {missingCore.map((c) => (
              <li key={c.export.id}>{c.export.sfInstructions}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs">Add these before analyzing — the audit can&apos;t run without them.</p>
        </div>
      )}

      <details>
        <summary className="cursor-pointer font-medium text-navy dark:text-white">
          Crawl coverage ({coverage.filter((c) => c.present).length}/{coverage.length} expected exports)
        </summary>
        <ul className="mt-2 space-y-1">
          {coverage.map((c) => (
            <li key={c.export.id} className="flex items-start gap-2">
              <span className={c.present ? 'text-green-500' : 'text-gray-400 dark:text-white/30'} aria-hidden>
                {c.present ? '✓' : '○'}
              </span>
              <span>
                <span className="text-navy dark:text-white">{c.export.label}</span>{' '}
                <span className="text-xs uppercase tracking-wide text-gray-400 dark:text-white/40">
                  {TIER_LABEL[c.export.tier]}
                </span>
                {!c.present && !c.export.notExpectedFromSf && (
                  <span className="block text-xs text-gray-500 dark:text-white/50">{c.export.sfInstructions}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
