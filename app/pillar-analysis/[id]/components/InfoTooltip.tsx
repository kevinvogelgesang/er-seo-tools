import React from 'react';

export function InfoTooltip({ children, label = 'About this section' }: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <span className="relative inline-block group ml-2 align-middle">
      <span
        aria-label={label}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 dark:bg-navy-border text-gray-600 dark:text-white/70 text-[10px] font-bold cursor-help"
      >
        i
      </span>
      <span
        role="tooltip"
        className="
          invisible group-hover:visible group-focus-within:visible
          absolute left-1/2 -translate-x-1/2 top-6
          z-20 w-72 p-3 rounded-lg
          bg-gray-900 dark:bg-gray-800 text-white text-xs leading-relaxed
          shadow-lg
          pointer-events-none group-hover:pointer-events-auto
        "
      >
        {children}
      </span>
    </span>
  );
}
