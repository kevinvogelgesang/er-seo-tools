import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isValidSessionId } from '@/lib/upload-helpers';
import { AggregatedResult, Issue } from '@/lib/types';
import { formatPriorityMarkdown } from '@/lib/services/priority.service';
import { loadArchivedSeoResult } from '@/lib/findings/seo-findings-fallback';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ sessionId: string; format: string }> };

function generateMarkdownSections(result: AggregatedResult): string[] {
  const sections: string[] = [];

  const cs = result.crawl_summary;

  // Section 1: Header + Crawl Summary
  const summaryLines: string[] = [
    '# SEO Audit Report',
    '',
    '## Crawl Summary',
    '',
    `- **Total URLs:** ${cs.total_urls}`,
  ];
  if (result.archived) {
    summaryLines.splice(2, 0, '> **Archived session** — full report data was pruned after 90 days; this export is rebuilt from the findings database (reduced data).', '');
  }
  if (cs.indexable_urls !== undefined) {
    summaryLines.push(`- **Indexable:** ${cs.indexable_urls}`);
    summaryLines.push(`- **Non-Indexable:** ${cs.non_indexable_urls}`);
  }
  if (cs.ok_responses !== undefined) {
    summaryLines.push(`- **OK (2xx):** ${cs.ok_responses}`);
    summaryLines.push(`- **Redirects (3xx):** ${cs.redirects}`);
    summaryLines.push(`- **Client Errors (4xx):** ${cs.client_errors}`);
    summaryLines.push(`- **Server Errors (5xx):** ${cs.server_errors}`);
  }
  if (cs.avg_word_count) summaryLines.push(`- **Avg Word Count:** ${cs.avg_word_count}`);
  if (cs.avg_crawl_depth) {
    summaryLines.push(`- **Avg Crawl Depth:** ${cs.avg_crawl_depth}`);
    summaryLines.push(`- **Max Crawl Depth:** ${cs.max_crawl_depth}`);
  }
  summaryLines.push('');
  sections.push(summaryLines.join('\n'));

  // Section 2: Priority issues
  sections.push(formatPriorityMarkdown(result.issues) + '\n');

  // Section 3: All Issues header
  sections.push('## All Issues\n\n');

  // Section 4+: per-severity issue tables
  const formatIssueSection = (issues: Issue[], title: string): string => {
    if (issues.length === 0) return '';
    const lines: string[] = [
      `### ${title}`,
      '',
      '| Issue | Count | Description |',
      '|-------|-------|-------------|',
      ...issues.map((issue) => `| ${issue.type} | ${issue.count} | ${issue.description} |`),
      '',
    ];
    return lines.join('\n');
  };

  const criticalSection = formatIssueSection(result.issues.critical, 'Critical Issues');
  if (criticalSection) sections.push(criticalSection);

  const warningsSection = formatIssueSection(result.issues.warnings, 'Warnings');
  if (warningsSection) sections.push(warningsSection);

  const noticesSection = formatIssueSection(result.issues.notices, 'Notices');
  if (noticesSection) sections.push(noticesSection);

  // Section: Recommendations
  if (result.recommendations.length > 0) {
    const recLines = [
      '## Recommendations',
      '',
      ...result.recommendations.map((rec, i) => `${i + 1}. ${rec}`),
      '',
    ];
    sections.push(recLines.join('\n'));
  }

  // Footer
  sections.push(
    [
      '---',
      '',
      `*Files processed: ${result.metadata.files_processed.join(', ')}*`,
      `*Parsers used: ${result.metadata.parsers_used.join(', ')}*`,
    ].join('\n')
  );

  return sections;
}

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

const EXPORT_EXCLUDED_ISSUE_TYPES = new Set(['spelling_errors', 'grammar_errors']);

function filterResultForExport(result: AggregatedResult): AggregatedResult {
  const filterIssues = (issues: Issue[]) =>
    issues.filter(i => !EXPORT_EXCLUDED_ISSUE_TYPES.has(i.type));
  return {
    ...result,
    issues: {
      critical: filterIssues(result.issues.critical),
      warnings: filterIssues(result.issues.warnings),
      notices: filterIssues(result.issues.notices),
    },
  };
}

function makeJsonStream(result: AggregatedResult): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  // Stream top-level keys individually so very large results don't block
  const keys = Object.keys(result) as (keyof AggregatedResult)[];
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{\n'));
      keys.forEach((key, index) => {
        const comma = index < keys.length - 1 ? ',' : '';
        const value = JSON.stringify(result[key], null, 2)
          // indent nested content by 2 spaces
          .split('\n')
          .join('\n  ');
        const chunk = `  ${JSON.stringify(key)}: ${value}${comma}\n`;
        controller.enqueue(encoder.encode(chunk));
      });
      controller.enqueue(encoder.encode('}\n'));
      controller.close();
    },
  });
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { sessionId, format } = await params;

  if (!isValidSessionId(sessionId)) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
  }

  if (!['json', 'summary', 'markdown'].includes(format)) {
    return NextResponse.json({ error: 'Invalid format. Use json, summary, or markdown.' }, { status: 400 });
  }

  try {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { status: true, result: true },
    });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.status !== 'complete') {
      return NextResponse.json({ error: 'Parsing not complete' }, { status: 400 });
    }

    let result: AggregatedResult | null = null;
    if (session.result) {
      result = JSON.parse(session.result) as AggregatedResult;
    } else {
      result = await loadArchivedSeoResult(sessionId); // C5: degraded export
    }
    if (!result) {
      return NextResponse.json({ error: 'Parsing not complete' }, { status: 400 });
    }

    if (format === 'json') {
      const stream = makeJsonStream(filterResultForExport(result));
      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="seo-audit-${sessionId}.json"`,
          'Transfer-Encoding': 'chunked',
        },
      });
    }

    if (format === 'summary') {
      const summary = {
        crawl_summary: result.crawl_summary,
        issue_counts: {
          critical: result.issues.critical.length,
          warnings: result.issues.warnings.length,
          notices: result.issues.notices.length,
        },
        top_issues: [
          ...result.issues.critical.slice(0, 3),
          ...result.issues.warnings.slice(0, 3),
        ].map((i) => ({
          type: i.type,
          severity: i.severity,
          count: i.count,
          description: i.description,
        })),
        recommendations: result.recommendations.slice(0, 5),
        metadata: result.metadata,
        archived: result.archived ?? false,
      };
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(JSON.stringify(summary, null, 2)));
          controller.close();
        },
      });
      return new NextResponse(stream, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="seo-summary-${sessionId}.json"`,
          'Transfer-Encoding': 'chunked',
        },
      });
    }

    // markdown — streamed section by section
    const sections = generateMarkdownSections(result);
    const stream = makeStream(sections);
    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/markdown',
        'Content-Disposition': `attachment; filename="seo-audit-${sessionId}.md"`,
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
