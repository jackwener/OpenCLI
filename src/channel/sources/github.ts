/**
 * GitHub source adapter.
 *
 * Uses `gh api` CLI for all API calls — inherits auth, proxy, host config.
 *
 * Origin formats:
 *   github:owner/repo          — repo-level events
 *   github:owner/repo#42       — issue/PR comments
 *   github:owner/repo/pulls    — all PR activity
 *   github:owner/repo/issues   — all issue activity
 */

import { execFileSync } from 'node:child_process';
import type {
  ChannelEvent,
  ChannelSource,
  PollResult,
  SourcePollConfig,
  SubscribableItem,
} from '../types.js';

// ── Origin parsing ──────────────────────────────────────────────────

interface RepoPollConfig extends SourcePollConfig {
  kind: 'repo';
  owner: string;
  repo: string;
}

interface IssuePollConfig extends SourcePollConfig {
  kind: 'issue';
  owner: string;
  repo: string;
  number: number;
}

interface PullsPollConfig extends SourcePollConfig {
  kind: 'pulls';
  owner: string;
  repo: string;
}

interface IssuesPollConfig extends SourcePollConfig {
  kind: 'issues';
  owner: string;
  repo: string;
}

type GitHubPollConfig = RepoPollConfig | IssuePollConfig | PullsPollConfig | IssuesPollConfig;

// ── Helpers ─────────────────────────────────────────────────────────

function ghJson<T>(endpoint: string): { data: T; pollInterval?: number } {
  // Use execFileSync to avoid shell injection — origin strings are user-supplied.
  const raw = execFileSync('gh', ['api', '--include', endpoint], {
    encoding: 'utf8',
    timeout: 30_000,
  });

  // Find the start of JSON body — first '[' or '{' that starts a line
  const jsonStart = raw.search(/^\s*[\[{]/m);
  const headers = jsonStart > 0 ? raw.slice(0, jsonStart) : '';
  const body = jsonStart >= 0 ? raw.slice(jsonStart) : raw;

  const data = JSON.parse(body) as T;

  // Extract X-Poll-Interval if present
  let pollInterval: number | undefined;
  const match = headers.match(/x-poll-interval:\s*(\d+)/i);
  if (match) pollInterval = parseInt(match[1], 10) * 1000;

  return { data, pollInterval };
}

// ── Source implementation ───────────────────────────────────────────

export class GitHubSource implements ChannelSource {
  readonly name = 'github';

  async listSubscribable(_config: Record<string, unknown>): Promise<SubscribableItem[]> {
    // List user's repos as subscribable items
    try {
      const { data } = ghJson<Array<{ full_name: string; description: string | null }>>(
        '/user/repos?per_page=30&sort=updated',
      );
      return data.map(r => ({
        origin: `github:${r.full_name}`,
        description: r.description ?? r.full_name,
      }));
    } catch {
      return [
        { origin: 'github:<owner>/<repo>', description: 'Subscribe to repo events' },
        { origin: 'github:<owner>/<repo>#<number>', description: 'Subscribe to issue/PR comments' },
        { origin: 'github:<owner>/<repo>/pulls', description: 'Subscribe to all PR activity' },
        { origin: 'github:<owner>/<repo>/issues', description: 'Subscribe to all issue activity' },
      ];
    }
  }

  parseOrigin(origin: string): GitHubPollConfig | null {
    if (!origin.startsWith('github:')) return null;
    const rest = origin.slice('github:'.length);

    // github:owner/repo/pulls
    const pullsMatch = rest.match(/^([^/]+)\/([^/]+)\/pulls$/);
    if (pullsMatch) return { kind: 'pulls', owner: pullsMatch[1], repo: pullsMatch[2] };

    // github:owner/repo/issues
    const issuesMatch = rest.match(/^([^/]+)\/([^/]+)\/issues$/);
    if (issuesMatch) return { kind: 'issues', owner: issuesMatch[1], repo: issuesMatch[2] };

    // github:owner/repo#42
    const issueMatch = rest.match(/^([^/]+)\/([^/#]+)#(\d+)$/);
    if (issueMatch) return { kind: 'issue', owner: issueMatch[1], repo: issueMatch[2], number: parseInt(issueMatch[3], 10) };

    // github:owner/repo
    const repoMatch = rest.match(/^([^/]+)\/([^/#]+)$/);
    if (repoMatch) return { kind: 'repo', owner: repoMatch[1], repo: repoMatch[2] };

    return null;
  }

  async poll(config: SourcePollConfig, cursor: string | null): Promise<PollResult> {
    const c = config as GitHubPollConfig;
    switch (c.kind) {
      case 'repo': return this.pollRepoEvents(c, cursor);
      case 'issue': return this.pollIssueComments(c, cursor);
      case 'pulls': return this.pollPullRequests(c, cursor);
      case 'issues': return this.pollIssues(c, cursor);
    }
  }

  // ── Poll strategies ─────────────────────────────────────────────

  private pollRepoEvents(c: RepoPollConfig, cursor: string | null): PollResult {
    const endpoint = `/repos/${c.owner}/${c.repo}/events?per_page=100`;
    const { data, pollInterval } = ghJson<Array<{
      id: string;
      type: string;
      created_at: string;
      actor: { login: string };
      payload: Record<string, unknown>;
    }>>(endpoint);

    const cursorTs = cursor ? Date.parse(cursor) : 0;
    const events: ChannelEvent[] = data
      .filter(e => Date.parse(e.created_at) > cursorTs)
      .map(e => ({
        id: `gh-event-${e.id}`,
        source: 'github',
        type: mapGitHubEventType(e.type),
        timestamp: e.created_at,
        origin: `github:${c.owner}/${c.repo}`,
        payload: {
          actor: e.actor.login,
          eventType: e.type,
          ...e.payload,
        },
      }));

    const newCursor = data.length > 0 ? data[0].created_at : (cursor ?? '');

    return {
      events,
      cursor: newCursor,
      recommendedIntervalMs: pollInterval,
    };
  }

  private pollIssueComments(c: IssuePollConfig, cursor: string | null): PollResult {
    const sinceParam = cursor ? `?since=${cursor}` : '';
    const endpoint = `/repos/${c.owner}/${c.repo}/issues/${c.number}/comments${sinceParam}`;
    const { data, pollInterval } = ghJson<Array<{
      id: number;
      created_at: string;
      updated_at: string;
      body: string;
      html_url: string;
      user: { login: string };
    }>>(endpoint);

    // GitHub's `since` param filters by updated_at, so we must also
    // filter by updated_at to avoid missing edits or re-delivering stale items.
    const cursorTs = cursor ? Date.parse(cursor) : 0;
    const events: ChannelEvent[] = data
      .filter(comment => Date.parse(comment.updated_at) > cursorTs)
      .map(comment => ({
        id: `gh-comment-${comment.id}-${comment.updated_at}`,
        source: 'github',
        type: comment.created_at === comment.updated_at
          ? 'issue_comment.created'
          : 'issue_comment.updated',
        timestamp: comment.updated_at,
        origin: `github:${c.owner}/${c.repo}#${c.number}`,
        payload: {
          author: comment.user.login,
          body: comment.body,
          htmlUrl: comment.html_url,
        },
      }));

    const newCursor = data.length > 0
      ? data[data.length - 1].updated_at
      : (cursor ?? '');

    return {
      events,
      cursor: newCursor,
      recommendedIntervalMs: pollInterval,
    };
  }

  private pollPullRequests(c: PullsPollConfig, cursor: string | null): PollResult {
    const sinceParam = cursor ? `&since=${cursor}` : '';
    const endpoint = `/repos/${c.owner}/${c.repo}/pulls?state=all&sort=updated&direction=desc&per_page=30${sinceParam}`;
    const { data, pollInterval } = ghJson<Array<{
      id: number;
      number: number;
      title: string;
      state: string;
      updated_at: string;
      created_at: string;
      user: { login: string };
      html_url: string;
    }>>(endpoint);

    const cursorTs = cursor ? Date.parse(cursor) : 0;
    const events: ChannelEvent[] = data
      .filter(pr => Date.parse(pr.updated_at) > cursorTs)
      .map(pr => ({
        id: `gh-pr-${pr.id}-${pr.updated_at}`,
        source: 'github',
        type: `pull_request.${pr.state}`,
        timestamp: pr.updated_at,
        origin: `github:${c.owner}/${c.repo}/pulls`,
        payload: {
          number: pr.number,
          title: pr.title,
          state: pr.state,
          author: pr.user.login,
          htmlUrl: pr.html_url,
        },
      }));

    const newCursor = data.length > 0
      ? data[0].updated_at
      : (cursor ?? '');

    return {
      events,
      cursor: newCursor,
      recommendedIntervalMs: pollInterval,
    };
  }

  private pollIssues(c: IssuesPollConfig, cursor: string | null): PollResult {
    const sinceParam = cursor ? `&since=${cursor}` : '';
    const endpoint = `/repos/${c.owner}/${c.repo}/issues?state=all&sort=updated&direction=desc&per_page=30${sinceParam}`;
    const { data, pollInterval } = ghJson<Array<{
      id: number;
      number: number;
      title: string;
      state: string;
      updated_at: string;
      created_at: string;
      user: { login: string };
      html_url: string;
      pull_request?: unknown;
    }>>(endpoint);

    const cursorTs = cursor ? Date.parse(cursor) : 0;
    const events: ChannelEvent[] = data
      // Filter out PRs (GitHub issues API includes PRs)
      .filter(issue => !issue.pull_request)
      .filter(issue => Date.parse(issue.updated_at) > cursorTs)
      .map(issue => ({
        id: `gh-issue-${issue.id}-${issue.updated_at}`,
        source: 'github',
        type: `issue.${issue.state}`,
        timestamp: issue.updated_at,
        origin: `github:${c.owner}/${c.repo}/issues`,
        payload: {
          number: issue.number,
          title: issue.title,
          state: issue.state,
          author: issue.user.login,
          htmlUrl: issue.html_url,
        },
      }));

    const newCursor = data.length > 0
      ? data[0].updated_at
      : (cursor ?? '');

    return {
      events,
      cursor: newCursor,
      recommendedIntervalMs: pollInterval,
    };
  }
}

// ── Event type mapping ──────────────────────────────────────────────

function mapGitHubEventType(ghType: string): string {
  const map: Record<string, string> = {
    PushEvent: 'push',
    PullRequestEvent: 'pull_request',
    PullRequestReviewEvent: 'pull_request_review',
    PullRequestReviewCommentEvent: 'pull_request_review_comment',
    IssuesEvent: 'issue',
    IssueCommentEvent: 'issue_comment',
    CreateEvent: 'create',
    DeleteEvent: 'delete',
    ForkEvent: 'fork',
    WatchEvent: 'star',
    ReleaseEvent: 'release',
  };
  return map[ghType] ?? ghType.replace(/Event$/, '').toLowerCase();
}
