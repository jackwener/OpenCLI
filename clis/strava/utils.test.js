import { describe, expect, it } from 'vitest';
import { cleanText, normalizeActivityId, normalizeAthleteId, normalizeClubId, normalizeSegmentId, parseActivityId, parseInlineStats, parseMoreStats, pickFollowCount, sportFromIcon, } from './utils.js';
describe('strava utils', () => {
    it('extracts the activity id from every link shape', () => {
        expect(parseActivityId('/activities/19010729205')).toBe('19010729205');
        expect(parseActivityId('/activities/18785265067#3497639849450753438')).toBe('18785265067');
        expect(parseActivityId('/activities/9981932437/best-efforts')).toBe('9981932437');
        expect(parseActivityId('/athletes/101963811')).toBeNull();
        expect(parseActivityId('')).toBeNull();
    });
    it('normalizes activity ids from bare ids, paths, and urls', () => {
        expect(normalizeActivityId('19010729205')).toBe('19010729205');
        expect(normalizeActivityId('/activities/18917110778#abc')).toBe('18917110778');
        expect(normalizeActivityId('https://www.strava.com/activities/18800239878')).toBe('18800239878');
        expect(normalizeActivityId('')).toBe('');
    });
    it('normalizes athlete ids from bare ids, paths, and urls', () => {
        expect(normalizeAthleteId('101963811')).toBe('101963811');
        expect(normalizeAthleteId('/athletes/101963811')).toBe('101963811');
        expect(normalizeAthleteId('https://www.strava.com/athletes/101963811?num_entries=10')).toBe('101963811');
        expect(normalizeAthleteId(null)).toBe('');
    });
    it('normalizes club ids from bare ids, paths, and urls', () => {
        expect(normalizeClubId('919984')).toBe('919984');
        expect(normalizeClubId('/clubs/1006535')).toBe('1006535');
        expect(normalizeClubId('https://www.strava.com/clubs/537051')).toBe('537051');
        expect(normalizeClubId(null)).toBe('');
    });
    it('normalizes segment ids from bare ids, paths, and urls', () => {
        expect(normalizeSegmentId('35556162')).toBe('35556162');
        expect(normalizeSegmentId('/segments/11162359')).toBe('11162359');
        expect(normalizeSegmentId('https://www.strava.com/segments/612665')).toBe('612665');
        expect(normalizeSegmentId('')).toBe('');
    });
    it('derives the sport from the icon class, falling back to the icon text', () => {
        expect(sportFromIcon('icon-ride', 'Ride')).toBe('ride');
        expect(sportFromIcon('icon-run', '')).toBe('run');
        expect(sportFromIcon('', 'Workout')).toBe('workout');
        expect(sportFromIcon('', '')).toBe('');
    });
    it('maps inline-stats rows into stable stat keys', () => {
        const stats = parseInlineStats([
            { strong: '59.39 km', full: '59.39 km Distance' },
            { strong: '2:25:22', full: '2:25:22 Moving Time' },
            { strong: '282 m', full: '282 m Elevation' },
        ]);
        expect(stats).toEqual({
            distance: '59.39 km',
            moving_time: '2:25:22',
            elevation: '282 m',
        });
    });
    it('ignores unknown stat labels and blank values', () => {
        const stats = parseInlineStats([
            { strong: '', full: ' Distance' },
            { strong: '125 W', full: '125 W Avg Watts' },
        ]);
        expect(stats).toEqual({});
    });
    it('maps the ride secondary inline-stats (weighted avg power / total work)', () => {
        const stats = parseInlineStats([
            { strong: '171 W', full: '171 W Weighted Avg Power' },
            { strong: '809 kJ', full: '809 kJ Total Work' },
        ]);
        expect(stats).toEqual({
            weighted_avg_power: '171 W',
            total_work: '809 kJ',
        });
    });
    it('flattens the More Stats table into avg_/max_ and single keys', () => {
        const stats = parseMoreStats([
            { label: 'Speed', avg: '28.8 km/h', max: '53.9 km/h' },
            { label: 'Heart Rate', avg: '146 bpm', max: '180 bpm' },
            { label: 'Cadence', avg: '84', max: '118' },
            { label: 'Power', avg: '148 W', max: '878 W' },
            { label: 'Calories', avg: '941', max: '' },
            { label: 'Temperature', avg: '31 ℃', max: '' },
            { label: 'Elapsed Time', avg: '1:34:50', max: '' },
        ]);
        expect(stats).toEqual({
            avg_speed: '28.8 km/h', max_speed: '53.9 km/h',
            avg_hr: '146 bpm', max_hr: '180 bpm',
            avg_cadence: '84', max_cadence: '118',
            avg_power: '148 W', max_power: '878 W',
            calories: '941',
            temperature: '31 ℃',
            elapsed_time: '1:34:50',
        });
    });
    it('handles run pace rows and drops unknown labels', () => {
        const stats = parseMoreStats([
            { label: 'Pace', avg: '5:12 /km', max: '4:01 /km' },
            { label: 'Relative Effort', avg: '72', max: '' },
            { label: '', avg: '99', max: '' },
        ]);
        expect(stats).toEqual({ avg_pace: '5:12 /km', max_pace: '4:01 /km' });
    });
    it('picks the follower/following count off the link that carries digits', () => {
        const links = [
            { href: '/athletes/101963811/follows?type=following', text: 'Following' },
            { href: '/athletes/101963811/follows?type=following', text: '239' },
            { href: '/athletes/101963811/follows?type=followers', text: '169' },
        ];
        expect(pickFollowCount(links, 'following')).toBe('239');
        expect(pickFollowCount(links, 'followers')).toBe('169');
        expect(pickFollowCount([], 'following')).toBe('');
    });
    it('collapses whitespace and truncates', () => {
        expect(cleanText('  hello   world  ')).toBe('hello world');
        expect(cleanText('abcdef', 3)).toBe('abc');
        expect(cleanText(null)).toBe('');
    });
});
