import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const SITE = 'lesswrong';
export const DOMAIN = 'www.lesswrong.com';

const GRAPHQL_URL = `https://${DOMAIN}/graphql`;

interface GqlResponse {
  data?: Record<string, unknown>;
  errors?: Array<{ message?: string }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- GraphQL responses vary per query
export async function gqlRequest(query: string): Promise<any> {
  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(15000),
  });

  if (!resp.ok) {
    throw new CommandExecutionError(`LessWrong API returned HTTP ${resp.status}`);
  }

  const json = (await resp.json()) as GqlResponse;

  if (json.errors?.length) {
    throw new CommandExecutionError(
      json.errors[0]?.message ?? 'Unknown GraphQL error',
    );
  }

  return json.data;
}

export function gqlEscape(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script[^>]*>.*?<\/script>/gis, ' ')
    .replace(/<style[^>]*>.*?<\/style>/gis, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

export async function resolveTagId(
  slug: string,
): Promise<{ _id: string; name: string } | null> {
  const normalized = gqlEscape(slug.toLowerCase().trim().replace(/\s+/g, '-'));
  const query = `query TagBySlug {
    tags(input: {terms: {view: "tagBySlug", slug: "${normalized}"}}) {
      results { _id name slug }
    }
  }`;
  const data = await gqlRequest(query);
  const tag = data?.tags?.results?.[0];
  if (!tag?._id || !tag?.name) return null;
  return { _id: tag._id as string, name: tag.name as string };
}

export function resolveUserId(slug: string): Promise<{ _id: string; displayName: string }> {
  const normalized = gqlEscape(slug.toLowerCase());
  const query = `query UserProfile {
    user(input: {selector: {slug: "${normalized}"}}) {
      result { _id displayName slug }
    }
  }`;
  return gqlRequest(query).then((data) => {
    const user = data?.user?.result;
    if (!user?._id) {
      throw new EmptyResultError(
        `lesswrong user ${slug}`,
        'Check the username — LessWrong slugs are lowercase (e.g. "zvi", "eliezer-yudkowsky")',
      );
    }
    return { _id: user._id as string, displayName: (user.displayName ?? '') as string };
  });
}

export function parsePostId(urlOrId: string): string {
  const trimmed = urlOrId.trim();
  const match = trimmed.match(/posts\/([a-zA-Z0-9]+)/);
  return match ? match[1] : trimmed;
}
