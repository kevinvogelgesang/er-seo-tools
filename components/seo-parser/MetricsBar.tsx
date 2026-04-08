'use client';

import React from 'react';

interface MetricsBarProps {
  healthScore?: number;
  totalUrls: number;
  criticalCount: number;
  warningsCount: number;
  noticesCount: number;
  indexableUrls?: number;
}

function healthColors(score: number) {
  if (score >= 70) return { ring: 'bg-green-100 dark:bg-green-500/15', text: 'text-green-700 dark:text-green-400', label: 'Good' };
  if (score >= 40) return { ring: 'bg-orange-100 dark:bg-orange-500/15', text: 'text-orange-700 dark:text-orange-400', label: 'Fair' };
  return { ring: 'bg-red-100 dark:bg-red-500/15', text: 'text-red-700 dark:text-red-400', label: 'Poor' };
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-navy-card rounded-lg border border-gray-100 dark:border-navy-border p-4 flex flex-col items-center justify-center text-center gap-1">
      {children}
      <span className="text-xs text-gray-500 dark:text-white/50 uppercase tracking-wide font-medium">{label}</span>
    </div>
  );
}

export function MetricsBar({ healthScore, totalUrls, criticalCount, warningsCount, noticesCount, indexableUrls }: MetricsBarProps) {
  const colors = healthScore !== undefined ? healthColors(healthScore) : null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <Tile label="Health Score">
        {colors && healthScore !== undefined ? (
          <div className={`w-12 h-12 rounded-full flex items-center justify-center ${colors.ring}`}>
            <span className={`font-bold text-lg leading-none ${colors.text}`}>{healthScore}</span>
          </div>
        ) : (
          <span className="text-2xl font-bold text-gray-400 dark:text-white/40">—</span>
        )}
        {colors && <span className={`text-xs font-semibold ${colors.text}`}>{colors.label}</span>}
      </Tile>

      <Tile label="Total URLs">
        <span className="font-bold text-2xl text-[#1c2d4a] dark:text-white">{totalUrls.toLocaleString()}</span>
      </Tile>

      <Tile label="Critical">
        <span className="font-bold text-2xl text-red-600 dark:text-red-400">{criticalCount}</span>
      </Tile>

      <Tile label="Warnings">
        <span className="font-bold text-2xl text-orange-500 dark:text-orange-400">{warningsCount}</span>
      </Tile>

      <Tile label="Notices">
        <span className="font-bold text-2xl text-blue-600 dark:text-blue-400">{noticesCount}</span>
      </Tile>

      <Tile label="Indexable">
        {indexableUrls !== undefined ? (
          <span className="font-bold text-2xl text-green-600 dark:text-green-400">{indexableUrls.toLocaleString()}</span>
        ) : (
          <span className="text-2xl font-bold text-gray-400 dark:text-white/40">—</span>
        )}
      </Tile>
    </div>
  );
}
