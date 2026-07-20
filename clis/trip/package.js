/**
 * Trip.com (international) flight+hotel package search by route + dates.
 *
 * Trip.com prices its packages through the flight-selection step of the booking
 * flow: a public, unsigned POST keyed on the metro city codes plus the
 * destination hotel city id returns the outbound flight options priced at the
 * bundle rate (the specific hotel is picked in a later step). So this is a plain
 * public fetch (no browser) that resolves both endpoints through the same POI
 * search `trip search` uses, then lists the package flights (see
 * `fetchPackageSearch` in utils). Per-person package fares only; the return leg
 * rides on the hotel checkout date.
 */
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchPackageSearch, mapPackageRow, parseIsoDate, parseKeyword, parseListLimit, resolvePackageCity } from './utils.js';

function parseAdults(raw) {
    if (raw === undefined || raw === null || raw === '') return 2;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 9) {
        throw new ArgumentError(`--adults must be an integer between 1 and 9, got ${JSON.stringify(raw)}`);
    }
    return parsed;
}

cli({
    site: 'trip',
    name: 'package',
    access: 'read',
    description: 'Search Trip.com flight+hotel packages by route + dates; lists the package flight options priced at the bundle rate',
    domain: 'trip.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'from', required: true, positional: true, help: 'Origin city keyword (e.g. Seoul / London / Bangkok)' },
        { name: 'to', required: true, positional: true, help: 'Destination city keyword (e.g. Tokyo / Paris / Singapore)' },
        { name: 'depart', required: true, help: 'Outbound date (YYYY-MM-DD)' },
        { name: 'return', required: true, help: 'Return date (YYYY-MM-DD)' },
        { name: 'adults', type: 'int', default: 2, help: 'Number of adults (1-9, default 2)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of packages (1-50)' },
    ],
    columns: [
        'rank',
        'airline', 'flightNo',
        'from', 'to',
        'departure', 'arrival',
        'stops',
        'price', 'currency',
    ],
    func: async (kwargs) => {
        const from = parseKeyword('from', kwargs.from);
        const to = parseKeyword('to', kwargs.to);
        const depart = parseIsoDate('depart', kwargs.depart);
        const ret = parseIsoDate('return', kwargs.return);
        if (depart >= ret) {
            throw new ArgumentError(`--depart must be before --return (got ${depart} .. ${ret})`);
        }
        const adults = parseAdults(kwargs.adults);
        const limit = parseListLimit(kwargs.limit);

        const origin = await resolvePackageCity(from);
        if (!origin) {
            throw new ArgumentError(`Could not resolve origin "${from}" to a Trip.com city; run 'trip search ${from}' to find the name`);
        }
        const dest = await resolvePackageCity(to);
        if (!dest) {
            throw new ArgumentError(`Could not resolve destination "${to}" to a Trip.com city; run 'trip search ${to}' to find the name`);
        }
        if (origin.cityId === dest.cityId) {
            throw new ArgumentError(`--from and --to must differ (both resolved to ${dest.name})`);
        }

        const groups = await fetchPackageSearch({
            dcode: origin.cityCode,
            acode: dest.cityCode,
            hcityid: String(dest.cityId),
            depart,
            ret,
            adults,
        });
        if (groups.length === 0) {
            throw new EmptyResultError('trip package', `No flight+hotel packages for ${origin.name} to ${dest.name} on ${depart} .. ${ret}`);
        }
        const rows = groups
            .filter((g) => g && Array.isArray(g.flightlist) && g.flightlist.length)
            .map((g) => mapPackageRow(g, 0))
            .filter((row) => row.flightNo && row.from && row.to && row.departure && row.arrival);
        if (rows.length === 0) {
            throw new CommandExecutionError(`Trip.com package search returned ${groups.length} group(s) but none carried a parseable flight identity, route, and time`);
        }
        return rows.slice(0, limit).map((row, i) => ({ ...row, rank: i + 1 }));
    },
});
