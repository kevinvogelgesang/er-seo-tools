'use client';

import { INPUTS, SCENARIOS, type InputKey } from '@/lib/eat-checklist/state';

interface InputTogglesProps {
  present: Set<InputKey>;
  onToggle: (key: InputKey) => void;
  onSelectScenario: (present: InputKey[]) => void;
}

export function InputToggles({ present, onToggle, onSelectScenario }: InputTogglesProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-navy dark:text-white">
          What we received from the client
        </h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Toggle each input the client actually supplied. The checklist below adapts to scope the
          quarter&apos;s work.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {INPUTS.map((input) => {
            const active = present.has(input.key);
            return (
              <button
                key={input.key}
                type="button"
                onClick={() => onToggle(input.key)}
                aria-pressed={active}
                className={`flex flex-col items-start rounded-lg border p-4 text-left transition-colors ${
                  active
                    ? 'border-orange bg-orange/10 dark:bg-orange/15'
                    : 'border-gray-300 bg-white hover:border-orange/60 dark:border-navy-border dark:bg-navy-card dark:hover:border-orange/60'
                }`}
              >
                <span className="flex w-full items-center justify-between">
                  <span className="font-medium text-navy dark:text-white">{input.label}</span>
                  <span
                    className={`ml-2 flex h-5 w-5 flex-none items-center justify-center rounded border text-xs ${
                      active
                        ? 'border-orange bg-orange text-white'
                        : 'border-gray-400 text-transparent dark:border-navy-border'
                    }`}
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                </span>
                <span className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                  {input.detail}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Or start from a named scenario
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {SCENARIOS.map((scenario) => (
            <button
              key={scenario.key}
              type="button"
              onClick={() => onSelectScenario(scenario.present)}
              title={scenario.tagline}
              className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm text-navy transition-colors hover:border-orange hover:text-orange dark:border-navy-border dark:bg-navy-card dark:text-white dark:hover:border-orange dark:hover:text-orange"
            >
              {scenario.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
