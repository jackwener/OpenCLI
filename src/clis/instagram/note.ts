import { ArgumentError, CommandExecutionError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

type InstagramNoteSuccessRow = {
  status: string;
  detail: string;
  noteId: string;
};

type BrowserNoteResult = {
  ok?: boolean;
  stage?: string;
  status?: number;
  text?: string;
  noteId?: string;
};

const INSTAGRAM_INBOX_URL = 'https://www.instagram.com/direct/inbox/';
const INSTAGRAM_NOTE_DOC_ID = '25155183657506484';
const INSTAGRAM_NOTE_MUTATION_NAME = 'usePolarisCreateInboxTrayItemSubmitMutation';
const INSTAGRAM_NOTE_ROOT_FIELD = 'xdt_create_inbox_tray_item';

function requirePage(page: IPage | null): IPage {
  if (!page) throw new CommandExecutionError('Browser session required for instagram note');
  return page;
}

function validateInstagramNoteArgs(kwargs: Record<string, unknown>): void {
  if (kwargs.content === undefined) {
    throw new ArgumentError(
      'Argument "content" is required.',
      'Provide a note text, for example: opencli instagram note "hello"',
    );
  }
}

function normalizeInstagramNoteContent(kwargs: Record<string, unknown>): string {
  const content = String(kwargs.content ?? '').trim();
  if (!content) {
    throw new ArgumentError(
      'Instagram note content cannot be empty.',
      'Provide a non-empty note text, for example: opencli instagram note "hello"',
    );
  }
  if (Array.from(content).length > 60) {
    throw new ArgumentError(
      'Instagram note content must be 60 characters or fewer.',
      'Shorten the note text and try again.',
    );
  }
  return content;
}

function buildNoteSuccessResult(noteId: string): InstagramNoteSuccessRow[] {
  return [{
    status: '✅ Posted',
    detail: 'Instagram note published successfully',
    noteId,
  }];
}

function buildPublishInstagramNoteJs(content: string): string {
  return `
    (async () => {
      const input = ${JSON.stringify({ content })};
      const html = document.documentElement?.outerHTML || '';
      const scripts = Array.from(document.scripts || [])
        .map((script) => script.textContent || '')
        .join('\\n');
      const source = html + '\\n' + scripts;
      const pick = (patterns) => {
        for (const pattern of patterns) {
          const match = source.match(pattern);
          if (!match) continue;
          for (let index = 1; index < match.length; index += 1) {
            if (match[index]) return match[index];
          }
          return match[0] || '';
        }
        return '';
      };
      const readCookie = (name) => {
        const prefix = name + '=';
        const part = document.cookie
          .split('; ')
          .find((cookie) => cookie.startsWith(prefix));
        return part ? decodeURIComponent(part.slice(prefix.length)) : '';
      };
      const actorId = pick([
        /"actorID":"(\\d+)"/,
        /"actor_id":"(\\d+)"/,
        /"viewerId":"(\\d+)"/,
      ]);
      const fbDtsg = pick([
        /(NAF[a-zA-Z0-9:_-]{20,})/,
        /(NAf[a-zA-Z0-9:_-]{20,})/,
      ]);
      const lsd = pick([
        /"LSD",\\[\\],\\{"token":"([^"]+)"\\}/,
        /"lsd":"([^"]+)"/,
      ]);
      const appId = pick([
        /"X-IG-App-ID":"(\\d+)"/,
        /"instagramWebAppId":"(\\d+)"/,
        /"appId":"(\\d+)"/,
      ]);
      const asbdId = pick([
        /"X-ASBD-ID":"(\\d+)"/,
        /"asbd_id":"(\\d+)"/,
      ]);
      const spinR = pick([/"__spin_r":(\\d+)/]);
      const spinB = pick([/"__spin_b":"([^"]+)"/]);
      const spinT = pick([/"__spin_t":(\\d+)/]);
      const csrfToken = readCookie('csrftoken') || pick([
        /"csrf_token":"([^"]+)"/,
        /"csrfToken":"([^"]+)"/,
      ]);
      const jazoest = fbDtsg
        ? '2' + Array.from(fbDtsg).reduce((total, char) => total + char.charCodeAt(0), 0)
        : '';

      if (!actorId || !fbDtsg || !lsd || !appId || !csrfToken || !spinR || !spinB || !spinT || !jazoest) {
        return {
          ok: false,
          stage: 'config',
          text: JSON.stringify({
            actorId: Boolean(actorId),
            fbDtsg: Boolean(fbDtsg),
            lsd: Boolean(lsd),
            appId: Boolean(appId),
            csrfToken: Boolean(csrfToken),
            spinR: Boolean(spinR),
            spinB: Boolean(spinB),
            spinT: Boolean(spinT),
            jazoest: Boolean(jazoest),
          }),
        };
      }

      const variables = {
        input: {
          actor_id: actorId,
          client_mutation_id: '1',
          additional_params: {
            note_create_params: {
              note_style: 0,
              text: input.content,
            },
          },
          audience: 0,
          inbox_tray_item_type: 'note',
        },
      };

      const body = new URLSearchParams();
      body.set('av', actorId);
      body.set('__user', '0');
      body.set('__a', '1');
      body.set('__req', '1');
      body.set('__hs', '');
      body.set('dpr', String(window.devicePixelRatio || 1));
      body.set('__ccg', 'UNKNOWN');
      body.set('__rev', spinR);
      body.set('__s', '');
      body.set('__hsi', '');
      body.set('__dyn', '');
      body.set('__csr', '');
      body.set('__comet_req', '7');
      body.set('fb_dtsg', fbDtsg);
      body.set('jazoest', jazoest);
      body.set('lsd', lsd);
      body.set('__spin_r', spinR);
      body.set('__spin_b', spinB);
      body.set('__spin_t', spinT);
      body.set('fb_api_caller_class', 'RelayModern');
      body.set('fb_api_req_friendly_name', '${INSTAGRAM_NOTE_MUTATION_NAME}');
      body.set('variables', JSON.stringify(variables));
      body.set('server_timestamps', 'true');
      body.set('doc_id', '${INSTAGRAM_NOTE_DOC_ID}');

      const headers = {
        Accept: '*/*',
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-ASBD-ID': asbdId || undefined,
        'X-CSRFToken': csrfToken,
        'X-FB-Friendly-Name': '${INSTAGRAM_NOTE_MUTATION_NAME}',
        'X-FB-LSD': lsd,
        'X-IG-App-ID': appId,
        'X-Root-Field-Name': '${INSTAGRAM_NOTE_ROOT_FIELD}',
      };

      const response = await fetch('/graphql/query', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: body.toString(),
      });
      const text = await response.text();
      const normalizedText = text.replace(/^for \\(;;\\);?/, '').trim();
      let data = null;
      try {
        data = JSON.parse(normalizedText);
      } catch {}

      const note = data?.data?.${INSTAGRAM_NOTE_ROOT_FIELD}?.inbox_tray_item;
      const noteId = String(note?.inbox_tray_item_id || note?.id || '');
      if (response.ok && noteId) {
        return {
          ok: true,
          stage: 'publish',
          noteId,
          text: String(note?.note_dict?.text || input.content || ''),
        };
      }

      return {
        ok: false,
        stage: 'publish',
        status: response.status,
        text: normalizedText || text,
      };
    })()
  `;
}

cli({
  site: 'instagram',
  name: 'note',
  description: 'Publish a text Instagram note',
  domain: 'www.instagram.com',
  strategy: Strategy.UI,
  browser: true,
  timeoutSeconds: 120,
  args: [
    { name: 'content', positional: true, required: true, help: 'Note text (max 60 characters)' },
  ],
  columns: ['status', 'detail', 'noteId'],
  validateArgs: validateInstagramNoteArgs,
  func: async (page: IPage | null, kwargs) => {
    const browserPage = requirePage(page);
    const content = normalizeInstagramNoteContent(kwargs as Record<string, unknown>);
    await browserPage.goto(INSTAGRAM_INBOX_URL);
    await browserPage.wait({ time: 2 });
    const result = await browserPage.evaluate(buildPublishInstagramNoteJs(content)) as BrowserNoteResult;
    if (!result?.ok) {
      throw new CommandExecutionError(
        `Instagram note publish failed at ${String(result?.stage || 'unknown')}: ${String(result?.text || 'unknown error')}`,
      );
    }
    return buildNoteSuccessResult(String(result.noteId || ''));
  },
});
