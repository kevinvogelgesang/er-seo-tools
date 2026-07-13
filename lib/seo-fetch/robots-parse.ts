// Rich UA-aware robots.txt parser + issue reporter for the validator UI and
// future D4 checks. The MINIMAL crawl-frontier matcher (star-group only,
// $-aware) lives in ./robots-match.ts — intentionally distinct semantics
// (spec D2); do not unify.

export interface RobotsIssue {
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
}

export interface RobotsGroup {
  userAgent: string;
  allows: string[];
  disallows: string[];
}

export interface RobotsParseResult {
  issues: RobotsIssue[];
  groups: RobotsGroup[];
  sitemapUrls: string[];
  crawlDelay?: number;
  blockedBots: string[];
  allowedBots: string[];
}

export const KNOWN_AI_BOTS = [
  'GPTBot',
  'ClaudeBot',
  'CCBot',
  'Amazonbot',
  'PerplexityBot',
  'Bytespider',
  'anthropic-ai',
  'ChatGPT-User',
  'Google-Extended',
  'FacebookBot',
]

function normalizePath(path: string): string {
  return path.toLowerCase()
}

function pathMatches(pattern: string, testPath: string): boolean {
  // Escape regex special chars except * and $
  const escaped = pattern.replace(/[.+?^{}()|[\]\\]/g, '\\$&')
  // Convert * to .*
  const regexStr = escaped.replace(/\*/g, '.*')
  try {
    const regex = new RegExp('^' + regexStr)
    return regex.test(testPath)
  } catch {
    return testPath.startsWith(pattern)
  }
}

function isBotBlocked(groupMap: Map<string, RobotsGroup>, botName: string): boolean {
  const botLower = botName.toLowerCase()

  // Check for an exact group matching this bot (case-insensitive)
  let botGroup: RobotsGroup | undefined
  for (const [agent, group] of groupMap) {
    if (agent.toLowerCase() === botLower) {
      botGroup = group
      break
    }
  }

  // Get the wildcard group
  let wildcardGroup: RobotsGroup | undefined
  for (const [agent, group] of groupMap) {
    if (agent === '*') {
      wildcardGroup = group
      break
    }
  }

  // Check specific bot group first
  if (botGroup) {
    const hasDisallowAll = botGroup.disallows.includes('/')
    if (hasDisallowAll) {
      // Check if there are Allow overrides that cover /
      const hasAllowOverride = botGroup.allows.some(
        (a) => a === '/' || a === ''
      )
      return !hasAllowOverride
    }
    // Bot has an explicit group but no Disallow: / — not blocked
    return false
  }

  // Fall back to wildcard group
  if (wildcardGroup) {
    const hasDisallowAll = wildcardGroup.disallows.includes('/')
    if (hasDisallowAll) {
      const hasAllowOverride = wildcardGroup.allows.some(
        (a) => a === '/' || a === ''
      )
      return !hasAllowOverride
    }
  }

  return false
}

export function parseRobotsTxt(content: string): RobotsParseResult {
  const issues: RobotsIssue[] = []
  const sitemapUrls: string[] = []
  let crawlDelay: number | undefined

  // groupMap: user-agent string -> group (we'll merge multiple UA lines into groups)
  const groupMap = new Map<string, RobotsGroup>()

  // Track groups in order (for multi-UA handling)
  // A "block" is one or more User-agent lines followed by directives
  interface ParseBlock {
    agents: string[]
    allows: string[]
    disallows: string[]
    firstDirectiveLine?: number
    agentLines: number[]
  }

  const blocks: ParseBlock[] = []
  let currentBlock: ParseBlock | null = null

  const lines = content.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const raw = lines[i]
    const line = raw.split('#')[0].trim() // strip comments
    if (!line) continue

    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) {
      issues.push({ severity: 'warning', message: `Line ${lineNum}: Unrecognized directive (no colon found): "${raw.trim()}"`, line: lineNum })
      continue
    }

    const field = line.slice(0, colonIdx).trim().toLowerCase()
    const value = line.slice(colonIdx + 1).trim()

    if (field === 'user-agent') {
      if (!currentBlock || currentBlock.allows.length > 0 || currentBlock.disallows.length > 0) {
        // Start a new block
        currentBlock = { agents: [], allows: [], disallows: [], agentLines: [] }
        blocks.push(currentBlock)
      }
      currentBlock.agents.push(value)
      currentBlock.agentLines.push(lineNum)
    } else if (field === 'disallow') {
      if (!currentBlock) {
        issues.push({ severity: 'warning', message: `Line ${lineNum}: Disallow directive without a preceding User-agent.`, line: lineNum })
        continue
      }
      if (currentBlock.agents.length > 1 && currentBlock.firstDirectiveLine === undefined) {
        // Multiple agents before first directive — this is actually valid robots.txt syntax but worth noting
        currentBlock.firstDirectiveLine = lineNum
      }
      currentBlock.disallows.push(value)

      // Check for missing trailing slash on path-like values (no wildcard, no slash at end, has a dot suggesting it's a file)
      if (value && value !== '/' && !value.endsWith('/') && !value.includes('*') && !value.includes('.')) {
        issues.push({
          severity: 'info',
          message: `Line ${lineNum}: Disallow "${value}" has no trailing slash — this blocks only the exact path, not subdirectories. Add a trailing slash to block the directory.`,
          line: lineNum,
        })
      }

      // Disallow: / with no allows yet (full block) — issue generated after parsing
    } else if (field === 'allow') {
      if (!currentBlock) {
        issues.push({ severity: 'warning', message: `Line ${lineNum}: Allow directive without a preceding User-agent.`, line: lineNum })
        continue
      }
      currentBlock.allows.push(value)
    } else if (field === 'sitemap') {
      if (value) sitemapUrls.push(value)
    } else if (field === 'crawl-delay') {
      const delay = parseFloat(value)
      if (!isNaN(delay)) {
        crawlDelay = delay
        if (delay < 1) {
          issues.push({ severity: 'warning', message: `Crawl-delay is very low (${delay}s) — some crawlers may ignore it or it may cause excessive crawling.` })
        } else if (delay > 10) {
          issues.push({ severity: 'warning', message: `Crawl-delay is very high (${delay}s) — this may significantly slow down legitimate search engine indexing.` })
        }
      } else {
        issues.push({ severity: 'error', message: `Line ${lineNum}: Invalid Crawl-delay value: "${value}"`, line: lineNum })
      }
    } else {
      issues.push({ severity: 'info', message: `Line ${lineNum}: Unknown directive "${field}" (ignored by most crawlers).`, line: lineNum })
    }
  }

  // Process blocks into groupMap and generate per-group issues
  for (const block of blocks) {
    if (block.agents.length === 0) continue

    // Check if block has no directives at all
    if (block.disallows.length === 0 && block.allows.length === 0) {
      issues.push({
        severity: 'info',
        message: `User-agent "${block.agents.join(', ')}" has no Allow or Disallow directives — this is a no-op group.`,
      })
    }

    // Check for Disallow: / with no Allow exceptions
    for (const agent of block.agents) {
      if (block.disallows.includes('/') && block.allows.length === 0) {
        issues.push({
          severity: 'warning',
          message: `User-agent "${agent}" has Disallow: / with no Allow exceptions — this blocks all crawling for this bot.`,
        })
      }
    }

    // Merge into groupMap (last-wins for same UA, which mirrors real robots.txt behavior)
    for (const agent of block.agents) {
      const existing = groupMap.get(agent)
      if (existing) {
        existing.allows.push(...block.allows)
        existing.disallows.push(...block.disallows)
      } else {
        groupMap.set(agent, {
          userAgent: agent,
          allows: [...block.allows],
          disallows: [...block.disallows],
        })
      }
    }
  }

  if (blocks.length === 0) {
    issues.push({ severity: 'error', message: 'No User-agent directives found — this file has no effect.' })
  }

  // Determine blocked/allowed known bots
  const blockedBots: string[] = []
  const allowedBots: string[] = []

  for (const bot of KNOWN_AI_BOTS) {
    if (isBotBlocked(groupMap, bot)) {
      blockedBots.push(bot)
    } else {
      allowedBots.push(bot)
    }
  }

  const groups = Array.from(groupMap.values())

  return { issues, groups, sitemapUrls, crawlDelay, blockedBots, allowedBots }
}

export function testUrlAgainstRobots(
  result: RobotsParseResult,
  url: string,
  userAgent = '*'
): { allowed: boolean; matchedRule: string; matchedAgent: string } {
  const path = url.startsWith('/') ? url : '/' + url
  const pathLower = normalizePath(path)

  const groups = result.groups
  const uaLower = userAgent.toLowerCase()

  // Find the most specific matching group
  let targetGroup: RobotsGroup | undefined
  for (const group of groups) {
    if (group.userAgent.toLowerCase() === uaLower) {
      targetGroup = group
      break
    }
  }

  // Fall back to wildcard
  if (!targetGroup) {
    for (const group of groups) {
      if (group.userAgent === '*') {
        targetGroup = group
        break
      }
    }
  }

  if (!targetGroup) {
    return { allowed: true, matchedRule: '(no matching rule)', matchedAgent: '*' }
  }

  // Find the longest matching Allow rule
  let longestAllowMatch = ''
  let longestAllowPattern = ''
  for (const allow of targetGroup.allows) {
    if (allow === '') continue
    const allowLower = normalizePath(allow)
    if (pathMatches(allowLower, pathLower) && allow.length > longestAllowMatch.length) {
      longestAllowMatch = allow
      longestAllowPattern = allow
    }
  }

  // Find the longest matching Disallow rule
  let longestDisallowMatch = ''
  let longestDisallowPattern = ''
  for (const disallow of targetGroup.disallows) {
    if (disallow === '') continue // empty Disallow means allow all
    const disallowLower = normalizePath(disallow)
    if (pathMatches(disallowLower, pathLower) && disallow.length > longestDisallowMatch.length) {
      longestDisallowMatch = disallow
      longestDisallowPattern = disallow
    }
  }

  if (!longestAllowMatch && !longestDisallowMatch) {
    return { allowed: true, matchedRule: '(no matching rule — default allow)', matchedAgent: targetGroup.userAgent }
  }

  // The more specific (longer) rule wins. Ties go to Allow.
  if (longestAllowMatch.length >= longestDisallowMatch.length) {
    return { allowed: true, matchedRule: `Allow: ${longestAllowPattern}`, matchedAgent: targetGroup.userAgent }
  }

  return { allowed: false, matchedRule: `Disallow: ${longestDisallowPattern}`, matchedAgent: targetGroup.userAgent }
}

/**
 * Pure `Sitemap:` line scan over a robots.txt body. Strips #-comments the
 * same way parseRobotsTxt does (spec D6) — a trailing " # note" or adjacent
 * "#fragment" never reaches the returned URL; percent-encoded %23 survives.
 * Duplicates are preserved (callers dedupe). Cheap alternative to running
 * the full parser on the discovery path.
 */
export function extractSitemapUrls(robotsText: string): string[] {
  const urls: string[] = []
  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim()
    if (!line) continue
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const field = line.slice(0, colonIdx).trim().toLowerCase()
    if (field !== 'sitemap') continue
    const value = line.slice(colonIdx + 1).trim()
    if (value) urls.push(value)
  }
  return urls
}
