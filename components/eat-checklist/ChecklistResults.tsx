'use client';

import {
  BUCKETS,
  BUDGET_MIN,
  bucketLabel,
  meta,
  pillarCoverage,
  roleLabel,
  tasksForInputs,
  totalMinutes,
  type BucketKey,
  type InputKey,
  type Task,
} from '@/lib/eat-checklist/state';

interface ChecklistResultsProps {
  present: Set<InputKey>;
}

function formatMinutes(min: number): string {
  const hours = Math.floor(min / 60);
  const rem = min % 60;
  if (hours === 0) return `${rem} min`;
  if (rem === 0) return `${hours} hr`;
  return `${hours} hr ${rem} min`;
}

export function ChecklistResults({ present }: ChecklistResultsProps) {
  const tasks = tasksForInputs(present);
  const total = totalMinutes(tasks);
  const coverage = pillarCoverage(present);
  const overBudget = total > BUDGET_MIN;

  // Group tasks by bucket, preserving BUCKETS order (tasks already ordered).
  const grouped: { bucket: BucketKey; tasks: Task[] }[] = BUCKETS.map((bucket) => ({
    bucket: bucket.key,
    tasks: tasks.filter((t) => t.bucket === bucket.key),
  })).filter((group) => group.tasks.length > 0);

  return (
    <div className="space-y-6">
      {/* Summary: time vs budget */}
      <div className="rounded-lg border border-gray-300 bg-white p-5 dark:border-navy-border dark:bg-navy-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Quarter workload
            </p>
            <p className="mt-1 text-2xl font-bold text-navy dark:text-white">
              {formatMinutes(total)}
              <span className="ml-2 text-base font-normal text-gray-500 dark:text-gray-400">
                / {formatMinutes(BUDGET_MIN)} budget
              </span>
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              overBudget
                ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                : 'bg-orange/15 text-orange-dark dark:bg-orange/20 dark:text-orange-light'
            }`}
          >
            {overBudget ? 'Over budget' : 'Within budget'}
          </span>
        </div>

        {/* Budget bar */}
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-navy-light">
          <div
            className={`h-full rounded-full ${overBudget ? 'bg-red-500' : 'bg-orange'}`}
            style={{ width: `${Math.min(100, (total / BUDGET_MIN) * 100)}%` }}
          />
        </div>

        <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
          {overBudget
            ? 'Over the ~8 hr/quarter budget. Prioritize by the audit (YMYL-critical first) and rotate build tasks across quarters rather than rebuilding every page at once.'
            : meta.budgetNote}
        </p>
      </div>

      {/* Pillar coverage badges */}
      <div className="rounded-lg border border-gray-300 bg-white p-5 dark:border-navy-border dark:bg-navy-card">
        <p className="text-sm font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          E-E-A-T pillar coverage
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {coverage.map(({ pillar, status }) => (
            <span
              key={pillar.key}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
                status === 'covered'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  status === 'covered' ? 'bg-green-500' : 'bg-red-500'
                }`}
                aria-hidden="true"
              />
              {pillar.label}
              <span className="text-xs font-normal opacity-80">
                {status === 'covered' ? 'covered' : 'at risk'}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Task list grouped by bucket */}
      <div className="space-y-5">
        {grouped.map((group) => {
          const groupTotal = totalMinutes(group.tasks);
          return (
            <section
              key={group.bucket}
              className="rounded-lg border border-gray-300 bg-white dark:border-navy-border dark:bg-navy-card"
            >
              <header className="flex items-baseline justify-between border-b border-gray-200 px-5 py-3 dark:border-navy-border">
                <h3 className="font-semibold text-navy dark:text-white">
                  {bucketLabel(group.bucket)}
                </h3>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {formatMinutes(groupTotal)}
                </span>
              </header>
              <ul className="divide-y divide-gray-200 dark:divide-navy-border">
                {group.tasks.map((task) => (
                  <li key={task.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium text-navy dark:text-white">
                        <span className="mr-2 text-xs font-semibold text-orange">{task.id}</span>
                        {task.name}
                      </p>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {formatMinutes(task.timeMin)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      {task.description}
                    </p>
                    <p className="mt-2 text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      {roleLabel(task.owner)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
