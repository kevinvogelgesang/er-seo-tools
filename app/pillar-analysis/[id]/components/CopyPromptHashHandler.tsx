'use client';

import { useEffect } from 'react';

/**
 * If the page loads with #copy-prompt in the URL (deep link from the seo-parser
 * pillar card), scroll the Copy Claude Prompt button into view and pulse it
 * briefly so the analyst knows where to click.
 */
export function CopyPromptHashHandler() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash !== '#copy-prompt') return;

    // Wait one tick so the button has rendered.
    const timer = setTimeout(() => {
      const el = document.getElementById('copy-prompt');
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-4', 'ring-orange-300', 'transition-shadow');
      setTimeout(() => el.classList.remove('ring-4', 'ring-orange-300'), 2200);
    }, 100);

    return () => clearTimeout(timer);
  }, []);

  return null;
}
