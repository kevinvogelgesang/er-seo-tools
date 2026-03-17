import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { isValidSessionId } from '@/lib/upload-helpers';
import { AggregatedResult, Issue } from '@/lib/types';
import { formatPriorityMarkdown } from '@/lib/services/priority.service';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ sessionId: string; format: string }> };

function generateMarkdown(result: AggregatedResult): string {
  const lines: string[] = [];

  lines.push('# SEO Audit Report');
  lines.push('');

  const cs = result.crawl_summary;
  lines.push('## Crawl Summary');
  lines.push('');
  lines.push(`- **Total URLs:** ${cs.total_urls}`);
  if (cs.indexable_urls !== undefined) {
    lines.push(`- **Indexable:** ${cs.indexable_urls}`);
    lines.push(`- **Non-Indexable:** ${cs.non_indexable_urls}`);
  }
  if (cs.ok_responses !== undefined) {
    lines.push(`- **OK (2xx):** ${cs.ok_responses}`);
    lines.push(`- **Redirects (3xx):** ${cs.redirects}`);
    lines.push(`- **Client Errors (4xx):** ${cs.client_errors}`);
    lines.push(`- **Server Errors (5xx):** ${cs.server_errors}`);
  }
  if (cs.avg_word_count) lines.push(`- **Avg Word Count:** ${cs.avg_word_count}`);
  if (cs.avg_crawl_depth) {
    lines.push(`- **Avg Crawl Depth:** ${cs.avg_crawl_depth}`);
    lines.push(`- **Max Crawl Depth:** ${cs.max_crawl_depth}`);
  }
  lines.push('');

  lines.push(formatPriorityMarkdown(result.issues));

  lines.push('## All Issues');
  lines.push('');

  const formatIssues = (issues: Issue[], title: string) => {
    if (issues.length === 0) return;
    lines.push(`### ${title}`);
    lines.push('');
    lines.push('| Issue | Count | Description |');
    lines.push('|-------|-------|-------------|');
    for (const issue of issues) {
      lines.push(`| ${issue.type} | ${issue.count} | ${issue.description} |`);
    }
    lines.push('');
  };

  formatIssues(result.issues.critical, 'Critical Issues');
  formatIssues(result.issues.warnings, 'Warnings');
  formatIssues(result.issues.notices, 'Notices');

  if (result.recommendations.length > 0) {
    lines.push('## Recommendations');
    lines.push('');
    result.recommendations.forEach((rec, i) => lines.push(`${i + 1}. ${rec}`));
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`*Files processed: ${result.metadata.files_processed.join(', ')}*`);
  lines.push(`*Parsers used: ${result.metadata.parsers_used.join(', ')}*`);

  return lines.join('\n');
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
    const session = await prisma.session.findUnique({ where: { id: sessionId } });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (session.status !== 'complete' || !session.result) {
      return NextResponse.json({ error: 'Parsing not complete' }, { status: 400 });
    }

    const result = JSON.parse(session.result) as AggregatedResult;

    if (format === 'json') {
      return new NextResponse(JSON.stringify(result, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="seo-audit-${sessionId}.json"`,
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
      };
      return new NextResponse(JSON.stringify(summary, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="seo-summary-${sessionId}.json"`,
        },
      });
    }

    // markdown
    const markdown = generateMarkdown(result);
    return new NextResponse(markdown, {
      headers: {
        'Content-Type': 'text/markdown',
        'Content-Disposition': `attachment; filename="seo-audit-${sessionId}.md"`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
