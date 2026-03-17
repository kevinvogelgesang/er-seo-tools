import { BaseParser } from '../base.parser';
import { ParsedData, Issue } from '../../types';
import { toNumber, toString } from '../../utils/columnMapper';

export class AnalyticsParser extends BaseParser {
  static filenamePattern = 'analytics';

  parse(): ParsedData {
    if (this.isEmpty) return {};

    const addressCol = this.findColumn(['Address', 'URL']);
    const sessionsCol = this.findColumn(['GA4 Sessions', 'Sessions']);
    const viewsCol = this.findColumn(['GA4 Views', 'Views', 'Pageviews']);
    const bounceCol = this.findColumn(['GA4 Bounce rate', 'Bounce rate', 'Bounce Rate']);
    const engagedSessionsCol = this.findColumn(['GA4 Engaged sessions', 'Engaged sessions']);
    const keyEventsCol = this.findColumn(['GA4 Key events', 'Key events', 'Conversions']);
    const eventCountCol = this.findColumn(['GA4 Event count', 'Event count']);
    const avgDurationCol = this.findColumn(['GA4 Average session duration', 'Average session duration']);

    const issues: Issue[] = [];
    const stats: Record<string, number> = {};

    // Calculate traffic stats
    let totalSessions = 0;
    let sessionsCount = 0;

    if (sessionsCol) {
      const noTrafficUrls: string[] = [];
      let noTrafficCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const sessions = toNumber(this.data[i][sessionsCol]);
        if (sessions !== null) {
          totalSessions += sessions;
          sessionsCount++;

          if (sessions === 0) {
            noTrafficCount++;
            if (addressCol && noTrafficUrls.length < 30) {
              noTrafficUrls.push(toString(this.data[i][addressCol]));
            }
          }
        }
      }

      stats.total_sessions = totalSessions;
      stats.avg_sessions_per_page = sessionsCount > 0 ? Math.round((totalSessions / sessionsCount) * 100) / 100 : 0;

      if (noTrafficCount > 0) {
        issues.push({
          type: 'pages_no_traffic',
          severity: 'notice',
          count: noTrafficCount,
          description: `${noTrafficCount} pages with zero sessions in analytics`,
          urls: noTrafficUrls,
        });
      }
    }

    // Total views
    if (viewsCol) {
      let totalViews = 0;
      for (let i = 0; i < this.data.length; i++) {
        const views = toNumber(this.data[i][viewsCol]);
        if (views !== null) totalViews += views;
      }
      stats.total_views = totalViews;
    }

    // Bounce rate
    if (bounceCol) {
      const highBounceUrls: string[] = [];
      let highBounceCount = 0;
      let totalBounce = 0;
      let bounceCount = 0;

      for (let i = 0; i < this.data.length; i++) {
        const bounce = toNumber(this.data[i][bounceCol]);
        if (bounce !== null) {
          totalBounce += bounce;
          bounceCount++;

          // Check for high bounce (over 80% - values might be 0-100 or 0-1)
          const bounceThreshold = bounce > 1 ? 80 : 0.8;
          if (bounce > bounceThreshold) {
            highBounceCount++;
            if (addressCol && highBounceUrls.length < 20) {
              highBounceUrls.push(toString(this.data[i][addressCol]));
            }
          }
        }
      }

      stats.avg_bounce_rate = bounceCount > 0 ? Math.round((totalBounce / bounceCount) * 1000) / 1000 : 0;

      if (highBounceCount > 0) {
        issues.push({
          type: 'high_bounce_rate',
          severity: 'notice',
          count: highBounceCount,
          description: `${highBounceCount} pages with bounce rate over 80%`,
          urls: highBounceUrls,
        });
      }
    }

    // Engaged sessions
    if (engagedSessionsCol) {
      let totalEngaged = 0;
      for (let i = 0; i < this.data.length; i++) {
        const engaged = toNumber(this.data[i][engagedSessionsCol]);
        if (engaged !== null) totalEngaged += engaged;
      }
      stats.total_engaged_sessions = totalEngaged;

      if (totalSessions > 0) {
        stats.avg_engagement_rate = Math.round((totalEngaged / totalSessions) * 1000) / 1000;
      }
    }

    // Key events (conversions)
    if (keyEventsCol) {
      let totalKeyEvents = 0;
      for (let i = 0; i < this.data.length; i++) {
        const events = toNumber(this.data[i][keyEventsCol]);
        if (events !== null) totalKeyEvents += events;
      }
      stats.total_key_events = totalKeyEvents;

      if (totalSessions > 0) {
        stats.conversion_rate = Math.round((totalKeyEvents / totalSessions) * 10000) / 10000;
      }
    }

    // Total events
    if (eventCountCol) {
      let totalEvents = 0;
      for (let i = 0; i < this.data.length; i++) {
        const events = toNumber(this.data[i][eventCountCol]);
        if (events !== null) totalEvents += events;
      }
      stats.total_events = totalEvents;
    }

    // Average session duration (weighted by sessions)
    if (avgDurationCol && sessionsCol) {
      let weightedDuration = 0;
      for (let i = 0; i < this.data.length; i++) {
        const sessions = toNumber(this.data[i][sessionsCol]) || 0;
        const durationStr = toString(this.data[i][avgDurationCol]);
        const durationSec = this.parseDuration(durationStr);
        weightedDuration += durationSec * sessions;
      }

      if (totalSessions > 0) {
        stats.avg_session_duration_sec = Math.round((weightedDuration / totalSessions) * 10) / 10;
      }
    }

    return {
      total_pages: this.length,
      stats,
      issues,
    };
  }

  /**
   * Parse duration string (HH:MM:SS) to seconds
   */
  private parseDuration(val: string): number {
    if (!val) return 0;
    const parts = val.split(':');
    if (parts.length === 3) {
      const hours = parseInt(parts[0], 10) || 0;
      const minutes = parseInt(parts[1], 10) || 0;
      const seconds = parseInt(parts[2], 10) || 0;
      return hours * 3600 + minutes * 60 + seconds;
    }
    return 0;
  }
}
