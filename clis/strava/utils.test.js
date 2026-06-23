import { describe, expect, it } from 'vitest';
import { cleanText, normalizeActivityId, normalizeAthleteId, normalizeClubId, normalizeSegmentId, parseActivityId, parseInlineStats, pickFollowCount, sportFromIcon, } from './utils.js';
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
