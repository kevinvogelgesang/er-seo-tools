// URL patterns to exclude from SEO element analysis
// These are typically CMS backend files, assets, or non-user-facing pages

const EXCLUDED_URL_PATTERNS: RegExp[] = [
  // WordPress
  /\/wp-content\//i,
  /\/wp-includes\//i,
  /\/wp-admin\//i,
  /\/wp-json\//i,
  /\?doing_wp_cron/i,
  // Drupal
  /\/sites\/default\/files\//i,
  /\/modules\//i,
  /\/themes\/.*\.(php|js|css)/i,
  // Common CMS patterns
  /\/admin\//i,
  /\/administrator\//i,
  /\/backend\//i,
  /\/cms\//i,
  /\/_resources\//i,
  // Asset/file extensions that shouldn't have SEO elements
  /\.(php|asp|aspx|jsp|cgi)\?/i,
  /\.(js|css|xml|json|txt|ico|woff|woff2|ttf|eot)$/i,
  // Feed URLs
  /\/feed\/?$/i,
  /\/rss\/?$/i,
  /\/atom\/?$/i,
  // Common non-page paths
  /\/cgi-bin\//i,
  /\/includes\//i,
  /\/assets\//i,
  /\/_inc\//i,
];

/**
 * Check if a URL should be analyzed for SEO elements.
 * Returns false for CMS backend files, assets, and other non-user-facing URLs.
 */
export function isSeoRelevantUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  for (const pattern of EXCLUDED_URL_PATTERNS) {
    if (pattern.test(url)) {
      return false;
    }
  }

  return true;
}

/**
 * Truncate a URL list and add metadata
 */
export function truncateUrlList(
  urls: string[],
  limit: number = 30
): {
  urls: string[];
  total_affected: number;
  truncated: boolean;
} {
  const total = urls.length;
  return {
    urls: urls.slice(0, limit),
    total_affected: total,
    truncated: total > limit,
  };
}
