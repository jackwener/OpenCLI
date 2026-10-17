import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { ensureGarmin, getProfile } from './utils.js';
// ── garmin whoami / login ───────────────────────────────────────────────
//
// Identity comes from the social-profile service. displayName is an opaque GUID
// that the rest of the API keys off; fullName / userName are the human-readable bits.
async function verifyGarminIdentity(page) {
    await ensureGarmin(page);
    const sp = await getProfile(page);
    return {
        full_name: sp.fullName || '',
        user_name: sp.userName || '',
        display_name: sp.displayName || '',
        location: sp.location || '',
    };
}
registerSiteAuthCommands({
    site: 'garmin',
    domain: 'connect.garmin.com',
    loginUrl: 'https://connect.garmin.com/signin/',
    columns: ['full_name', 'user_name', 'display_name', 'location'],
    whoamiDescription: 'Show the currently logged-in Garmin Connect athlete',
    loginDescription: 'Log into Garmin Connect in the bound browser (run once)',
    verify: verifyGarminIdentity,
    poll: verifyGarminIdentity,
});
