import { describe, expect, it } from 'vitest';
import { __test__ } from './shared.js';
describe('amazon shared helpers', () => {
    it('builds canonical product and discussion URLs from ASINs and product URLs', () => {
        expect(__test__.buildProductUrl('B0FJS72893')).toBe('https://www.amazon.com/dp/B0FJS72893');
        expect(__test__.buildProductUrl('https://www.amazon.com/dp/B0FJS72893/ref=something')).toBe('https://www.amazon.com/dp/B0FJS72893');
        expect(__test__.buildDiscussionUrl('https://www.amazon.com/dp/B0FJS72893')).toBe('https://www.amazon.com/product-reviews/B0FJS72893');
    });
    it('keeps the input marketplace instead of rewriting it to the US store', () => {
        expect(__test__.buildProductUrl('https://www.amazon.co.uk/dp/B0FGCPFY9L')).toBe('https://www.amazon.co.uk/dp/B0FGCPFY9L');
        expect(__test__.buildProductUrl('https://www.amazon.de/dp/B0FJS72893/ref=something')).toBe('https://www.amazon.de/dp/B0FJS72893');
        expect(__test__.buildProductUrl('https://www.amazon.com.au/dp/B0FJS72893')).toBe('https://www.amazon.com.au/dp/B0FJS72893');
        expect(__test__.buildDiscussionUrl('https://www.amazon.co.uk/product-reviews/B0FGCPFY9L?pageNumber=1')).toBe('https://www.amazon.co.uk/product-reviews/B0FGCPFY9L');
        expect(__test__.normalizeProductUrl('https://www.amazon.co.uk/dp/B0FGCPFY9L')).toBe('https://www.amazon.co.uk/dp/B0FGCPFY9L');
    });
    it('defaults to the US store for bare ASINs and non-marketplace hosts', () => {
        expect(__test__.amazonHostFromInput('B0FJS72893')).toBeNull();
        expect(__test__.buildProductUrl('B0FJS72893')).toBe('https://www.amazon.com/dp/B0FJS72893');
        expect(__test__.buildDiscussionUrl('B0FJS72893')).toBe('https://www.amazon.com/product-reviews/B0FJS72893');
        expect(__test__.normalizeProductUrl('B0FJS72893')).toBe('https://www.amazon.com/dp/B0FJS72893');
    });
    it('accepts sibling marketplaces but rejects look-alike hosts', () => {
        expect(__test__.amazonHostFromInput('https://www.amazon.co.uk/dp/B0FJS72893')).toBe('www.amazon.co.uk');
        expect(__test__.amazonHostFromInput('https://amazon.de/dp/B0FJS72893')).toBe('amazon.de');
        expect(__test__.amazonHostFromInput('https://amazon.com.au/dp/B0FJS72893')).toBe('amazon.com.au');
        expect(__test__.amazonHostFromInput('https://smile.amazon.com.be/dp/B0FJS72893')).toBe('smile.amazon.com.be');
        expect(__test__.amazonHostFromInput('https://evilamazon.com/dp/B0FJS72893')).toBeNull();
        expect(__test__.amazonHostFromInput('https://amazon.com.evil.com/dp/B0FJS72893')).toBeNull();
        expect(__test__.amazonHostFromInput('https://amazon.evil.com/dp/B0FJS72893')).toBeNull();
        expect(__test__.amazonHostFromInput('https://x.amazon.evil.com/dp/B0FJS72893')).toBeNull();
        expect(__test__.amazonHostFromInput('https://amazon.attacker.io/dp/B0FJS72893')).toBeNull();
        expect(__test__.amazonHostFromInput('https://amazon.shop/dp/B0FJS72893')).toBeNull();
        expect(__test__.amazonHostFromInput('https://amazon.zip/dp/B0FJS72893')).toBeNull();
        expect(() => __test__.canonicalizeAmazonUrl('https://amazon.evil.com/gp/bestsellers')).toThrow('Invalid Amazon URL');
        expect(__test__.canonicalizeAmazonUrl('https://www.amazon.co.uk/gp/bestsellers/books')).toBe('https://www.amazon.co.uk/gp/bestsellers/books');
        expect(() => __test__.canonicalizeAmazonUrl('https://evilamazon.com/gp/bestsellers')).toThrow('Invalid Amazon URL');
    });
    it('parses price, rating, and review-count text', () => {
        expect(__test__.parsePriceText('1 offer from $34.11')).toEqual({
            price_text: '$34.11',
            price_value: 34.11,
            currency: 'USD',
        });
        expect(__test__.parseRatingValue('3.9 out of 5 stars, rating details')).toBe(3.9);
        expect(__test__.parseReviewCount('27 global ratings')).toBe(27);
        expect(__test__.parseReviewCount('(2.9K)')).toBe(2900);
        expect(__test__.parseReviewCount('1.2M global ratings')).toBe(1200000);
        expect(__test__.extractReviewCountFromCardText('Desk Shelf\n4.3 out of 5 stars\n435\n$25.92')).toBe('435');
    });
    it('recognizes robot checks and Amazon-owned merchants', () => {
        expect(__test__.isAmazonEntity('Ships from Amazon')).toBe(true);
        expect(__test__.trimRatingPrefix('5.0 out of 5 stars Great value and quality')).toBe('Great value and quality');
        expect(__test__.isRobotState({
            title: 'Robot Check',
            body_text: 'Sorry, we just need to make sure you\'re not a robot',
        })).toBe(true);
    });
    it('requires a real best-sellers URL or path', () => {
        expect(__test__.resolveBestsellersUrl('/Best-Sellers/zgbs')).toBe('https://www.amazon.com/Best-Sellers/zgbs');
        expect(() => __test__.resolveBestsellersUrl('desk shelf organizer')).toThrow('amazon bestsellers expects a best sellers URL or /zgbs path');
    });
    it('resolves and validates all ranking list URLs', () => {
        expect(__test__.resolveRankingUrl('new_releases')).toBe('https://www.amazon.com/gp/new-releases');
        expect(__test__.resolveRankingUrl('movers_shakers')).toBe('https://www.amazon.com/gp/movers-and-shakers');
        expect(__test__.resolveRankingUrl('new_releases', '/gp/new-releases/kitchen')).toBe('https://www.amazon.com/gp/new-releases/kitchen');
        expect(__test__.resolveRankingUrl('bestsellers', 'https://www.amazon.com/Best-Sellers/zgbs/ref=zg_bsnr_tab_bs')).toBe('https://www.amazon.com/Best-Sellers/zgbs');
        expect(() => __test__.resolveRankingUrl('movers_shakers', 'https://example.com/gp/movers-and-shakers')).toThrow('Invalid Amazon URL');
    });
    it('extracts category node id from URL best effort', () => {
        expect(__test__.extractCategoryNodeId('https://www.amazon.com/Best-Sellers-Home-Kitchen/zgbs/home-garden/3744371')).toBe('3744371');
        expect(__test__.extractCategoryNodeId('https://www.amazon.com/s?k=desk+organizer&rh=n%3A1064954')).toBe('1064954');
    });
});
