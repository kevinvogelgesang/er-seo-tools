'use client';

import React from 'react';

// app/pillar-analysis/[id]/components/SectionNav.tsx
// Sticky page-section nav. Plain anchor links; no JS scroll-handling.
// Active-section highlighting via IntersectionObserver is deferred to
// a future phase.

const LINKS = [
  { id: 'score', label: 'Score' },
  { id: 'memo', label: 'Memo' },
  { id: 'hub', label: 'Hub' },
  { id: 'pillars', label: 'Pillars' },
  { id: 'urls', label: 'URLs' },
];

export function SectionNav() {
  return (
    <nav
      className="sticky top-0 z-10 -mx-6 px-6 py-2 bg-[#f4f6f9]/90 dark:bg-navy-deep/90 backdrop-blur border-b border-gray-200 dark:border-navy-border"
      aria-label="Page sections"
    >
      <ul className="flex gap-4 text-sm">
        {LINKS.map(link => (
          <li key={link.id}>
            <a
              href={`#${link.id}`}
              className="text-gray-600 dark:text-white/60 hover:text-[#1c2d4a] dark:hover:text-white"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
