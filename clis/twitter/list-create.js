import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { unwrapBrowserResult } from './shared.js';
import { TWITTER_BEARER_TOKEN } from './utils.js';

const CREATE_LIST_QUERY_ID = 'UQRa0jJ9doxGEIQRea1Y0w';
const NAME_MAX = 25;
const DESCRIPTION_MAX = 100;

// Minimal feature set as observed in the real CreateList web request payload.
// Twitter rejects requests with extra/unknown features (DecodeException).
const FEATURES = {
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: false,
    rweb_tipjar_consumption_enabled: false,
    verified_phone_label_enabled: false,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
};

export function parseListCreateArgs(kwargs) {
    const name = String(kwargs.name || '').trim();
    const description = String(kwargs.description || '').trim();
    const modeRaw = String(kwargs.mode || 'public').trim().toLowerCase();
    if (!name) {
        throw new ArgumentError('List name is required', 'Example: opencli twitter list-create "My List"');
    }
    if (name.length > NAME_MAX) {
        throw new ArgumentError(`List name too long: ${name.length} chars (max ${NAME_MAX})`);
    }
    if (description.length > DESCRIPTION_MAX) {
        throw new ArgumentError(`Description too long: ${description.length} chars (max ${DESCRIPTION_MAX})`);
    }
    if (modeRaw !== 'public' && modeRaw !== 'private') {
        throw new ArgumentError(`Invalid mode: ${JSON.stringify(kwargs.mode)}. Expected "public" or "private".`);
    }
    return { listName: name, listDescription: description, listMode: modeRaw, privateFlag: modeRaw === 'private' };
}

function requireCreateListResult(result, expectedName, expectedMode) {
    if (!result || typeof result !== 'object') {
        throw new CommandExecutionError(`Unexpected result from twitter list-create: ${JSON.stringify(result)}`);
    }
    if (result.httpStatus === 401 || result.httpStatus === 403) {
        throw new AuthRequiredError('x.com', `Twitter CreateList returned HTTP ${result.httpStatus}`);
    }
    if (!result.ok) {
        const snippet = String(result.bodyText || '').slice(0, 300);
        throw new CommandExecutionError(`HTTP ${result.httpStatus} from CreateList: ${snippet}`);
    }
    if (!result.bodyJson || typeof result.bodyJson !== 'object') {
        throw new CommandExecutionError(`CreateList returned malformed JSON payload. Body: ${String(result.bodyText || '').slice(0, 300)}`);
    }
    const list = result.bodyJson?.data?.list;
    if (!list || typeof list !== 'object') {
        const errors = result.bodyJson?.errors;
        if (Array.isArray(errors) && errors.length > 0) {
            throw new CommandExecutionError(`CreateList failed: ${errors[0].message || JSON.stringify(errors[0])}`);
        }
        throw new CommandExecutionError(`CreateList returned no list payload. Body: ${String(result.bodyText || '').slice(0, 300)}`);
    }
    const id = String(list.id_str || list.id || '');
    if (!/^\d+$/.test(id)) {
        throw new CommandExecutionError('CreateList returned a list payload without a numeric list id.');
    }
    if (typeof list.name !== 'string' || !list.name.trim()) {
        throw new CommandExecutionError('CreateList returned a list payload without a list name.');
    }
    if (list.name.trim() !== expectedName) {
        throw new CommandExecutionError(`CreateList returned name ${JSON.stringify(list.name)}, expected ${JSON.stringify(expectedName)}.`);
    }
    const modeValue = typeof list.mode === 'string' ? list.mode : '';
    if (!modeValue) {
        throw new CommandExecutionError('CreateList returned a list payload without list mode.');
    }
    const mode = /private/i.test(modeValue) ? 'private' : 'public';
    if (mode !== expectedMode) {
        throw new CommandExecutionError(`CreateList returned mode ${mode}, expected ${expectedMode}.`);
    }
    return { createdList: list, listId: id, listMode: mode };
}

export function buildListCreateRow({ result, name, description, mode }) {
    const { createdList, listId, listMode } = requireCreateListResult(result, name, mode);
    return {
        id: listId,
        name: createdList.name,
        description: typeof createdList.description === 'string' ? createdList.description : description,
        mode: listMode,
        status: 'success',
    };
}

cli({
    site: 'twitter',
    name: 'list-create',
    description: 'Create a new Twitter/X list (returns the new list id)',
    access: 'write',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'name', positional: true, type: 'string', required: true, help: `List name (max ${NAME_MAX} chars)` },
        { name: 'description', type: 'string', default: '', help: `Optional list description (max ${DESCRIPTION_MAX} chars)` },
        { name: 'mode', type: 'string', default: 'public', help: 'public | private' },
    ],
    columns: ['id', 'name', 'description', 'mode', 'status'],
    func: async (page, kwargs) => {
        const { listName: name, listDescription: description, listMode: mode, privateFlag: isPrivate } = parseListCreateArgs(kwargs);

        await page.goto('https://x.com');
        await page.wait(3);
        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
        if (!ct0) throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

        // Hardcode queryId: it must match the FEATURES schema below.
        // Letting resolveTwitterQueryId() drift would pull a newer queryId
        // whose schema would reject our simplified features payload.
        const queryId = CREATE_LIST_QUERY_ID;

        const headers = JSON.stringify({
            'Authorization': `Bearer ${decodeURIComponent(TWITTER_BEARER_TOKEN)}`,
            'X-Csrf-Token': ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
            'Content-Type': 'application/json',
        });
        const body = JSON.stringify({
            variables: { isPrivate, name, description },
            features: FEATURES,
            queryId,
        });
        const apiUrl = `/i/api/graphql/${queryId}/CreateList`;

        const result = unwrapBrowserResult(await page.evaluate(`async () => {
            const r = await fetch(${JSON.stringify(apiUrl)}, {
                method: 'POST',
                headers: ${headers},
                credentials: 'include',
                body: ${JSON.stringify(body)},
            });
            const bodyText = await r.text();
            let bodyJson = null;
            try { bodyJson = JSON.parse(bodyText); } catch {}
            return { ok: r.ok, httpStatus: r.status, bodyJson, bodyText };
        }`));

        // Note: Twitter sometimes returns a non-fatal `errors` array (e.g. a
        // strato DecodeException from a side-effect serializer) WHILE STILL
        // creating the list. So check for a valid list payload FIRST and
        // only treat errors as fatal if no list came back.
        return [buildListCreateRow({ result, name, description, mode })];
    },
});
