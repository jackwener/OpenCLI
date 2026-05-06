// disease-sh shared helpers — COVID-19 stats from disease.sh (free, no auth).
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';

export const DISEASE_BASE = 'https://disease.sh/v3/covid-19';
const UA = 'opencli-disease-sh/1.0';

export function requireString(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ArgumentError(`--${name} is required`);
    }
    return value.trim();
}

export async function diseaseFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err.message}`);
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `${label} returned 404 (unknown country/region).`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}.`);
    }
    try {
        return await resp.json();
    } catch (err) {
        throw new CommandExecutionError(`${label} returned non-JSON body: ${err.message}`);
    }
}

export function projectStats(s) {
    return {
        cases: Number(s?.cases ?? 0),
        todayCases: Number(s?.todayCases ?? 0),
        deaths: Number(s?.deaths ?? 0),
        todayDeaths: Number(s?.todayDeaths ?? 0),
        recovered: Number(s?.recovered ?? 0),
        active: Number(s?.active ?? 0),
        critical: Number(s?.critical ?? 0),
        casesPerMillion: Number(s?.casesPerOneMillion ?? 0),
        deathsPerMillion: Number(s?.deathsPerOneMillion ?? 0),
        tests: Number(s?.tests ?? 0),
        population: Number(s?.population ?? 0),
    };
}
