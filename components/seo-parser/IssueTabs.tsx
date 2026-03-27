'use client';

import { useState } from 'react';
import { IssuesResult } from '@/lib/types';
import { IssueList } from './IssueList';

type TabKey = 'critical' | 'warnings' | 'notices';

const tabs: { key: TabKey; label: string; activeColor: string }[] = [
  { key: 'critical', label: 'Critical', activeColor: 'text-red-600 border-red-600' },
  { key: 'warnings', label: 'Warnings', activeColor: 'text-yellow-600 border-yellow-600' },
  { key: 'notices', label: 'Notices', activeColor: 'text-blue-600 border-blue-600' },
];

const severityMap: Record<TabKey, 'critical' | 'warning' | 'notice'> = {
  critical: 'critical',
  warnings: 'warning',
  notices: 'notice',
};

interface IssueTabsProps {
  issues: IssuesResult;
  onUrlClick?: (url: string) => void;
}

export function IssueTabs({ issues, onUrlClick }: IssueTabsProps) {
  const [active, setActive] = useState<TabKey>('critical');

  const counts: Record<TabKey, number> = {
    critical: issues.critical.length,
    warnings: issues.warnings.length,
    notices: issues.notices.length,
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100">
      <div className="border-b border-gray-200">
        <nav className="flex -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActive(tab.key)}
              className={`
                flex-1 py-3 px-4 text-center border-b-2 font-medium text-sm transition-colors
                ${active === tab.key
                  ? tab.activeColor
                  : 'border-transparent text-gray-500 hover:text-gray-700'}
              `}
            >
              {tab.label}
              <span
                className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                  active === tab.key
                    ? 'bg-[#1c2d4a] text-white'
                    : 'bg-gray-100 text-gray-600'
                }`}
              >
                {counts[tab.key]}
              </span>
            </button>
          ))}
        </nav>
      </div>
      <div className="p-4">
        <IssueList issues={issues[active]} severity={severityMap[active]} onUrlClick={onUrlClick} />
      </div>
    </div>
  );
}
