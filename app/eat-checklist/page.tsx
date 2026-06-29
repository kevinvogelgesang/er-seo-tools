'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ChecklistResults } from '@/components/eat-checklist/ChecklistResults';
import { InputToggles } from '@/components/eat-checklist/InputToggles';
import { meta, type InputKey } from '@/lib/eat-checklist/state';

export default function EatChecklistPage() {
  const [present, setPresent] = useState<Set<InputKey>>(new Set());

  function handleToggle(key: InputKey) {
    setPresent((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleSelectScenario(keys: InputKey[]) {
    setPresent(new Set(keys));
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy dark:text-white sm:text-3xl">
            {meta.title}
          </h1>
          <p className="mt-2 max-w-2xl text-gray-600 dark:text-gray-300">{meta.purpose}</p>
        </div>
        <Link
          href="/eat-checklist/audit"
          className="inline-flex flex-none items-center gap-1.5 rounded-md bg-orange px-4 py-2 text-sm font-semibold text-navy transition-colors hover:bg-orange-light"
        >
          Run the Audit Checklist
          <span aria-hidden="true">&rarr;</span>
        </Link>
      </header>

      <div className="space-y-10">
        <InputToggles
          present={present}
          onToggle={handleToggle}
          onSelectScenario={handleSelectScenario}
        />
        <ChecklistResults present={present} />
      </div>
    </main>
  );
}
