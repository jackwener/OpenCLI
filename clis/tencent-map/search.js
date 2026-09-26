// tencent-map search — keyword → candidate places with coordinates.
//
// Two upstream shapes, picked by whether the caller knows the city:
//   --region <城市>  → place/v1/search      (boundary=region(<城市>,0))
//   no --region      → place/v1/suggestion  (nationwide keyword lookup)
//
// `place/v1/search` demands a real `boundary`; `region(全国,0)` is syntactically
// valid but always returns 0 rows, so a nationwide query must use the
// suggestion endpoint. The `source` column records which one answered, because
// the two rank differently and an agent comparing runs deserves to know.
import { ArgumentError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { APPTAG, TMAP_MAX_PAGES, TMAP_PAGE_SIZE, emptyResult, normalizeLimit, requireString, tmapRequest } from './utils.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 60;

const COLUMNS = [
    'rank', 'title', 'address', 'lat', 'lng',
    'category', 'tel', 'poi_id', 'adcode', 'province', 'city', 'district', 'source',
];

// Intermediate shapes are deliberately NOT named after columns: the
// silent-column-drop audit flags any object literal that overlaps `columns`
// while carrying extra keys.
function readSearchItem(item, rank) {
    const info = item?.ad_info && typeof item.ad_info === 'object' ? item.ad_info : {};
    const point = item?.location && typeof item.location === 'object' ? item.location : {};
    return {
        rank,
        title: typeof item?.title === 'string' ? item.title : null,
        address: typeof item?.address === 'string' ? item.address : null,
        lat: Number.isFinite(Number(point.lat)) ? Number(point.lat) : null,
        lng: Number.isFinite(Number(point.lng)) ? Number(point.lng) : null,
        category: typeof item?.category === 'string' ? item.category : null,
        tel: typeof item?.tel === 'string' && item.tel ? item.tel : null,
        poi_id: item?.id != null ? String(item.id) : null,
        adcode: info.adcode != null ? String(info.adcode) : null,
        province: typeof info.province === 'string' ? info.province : null,
        city: typeof info.city === 'string' ? info.city : null,
        district: typeof info.district === 'string' ? info.district : null,
        source: 'search',
    };
}

function readSuggestionItem(item, rank) {
    const point = item?.location && typeof item.location === 'object' ? item.location : {};
    return {
        rank,
        title: typeof item?.title === 'string' ? item.title : null,
        address: typeof item?.address === 'string' ? item.address : null,
        lat: Number.isFinite(Number(point.lat)) ? Number(point.lat) : null,
        lng: Number.isFinite(Number(point.lng)) ? Number(point.lng) : null,
        category: typeof item?.category === 'string' ? item.category : null,
        tel: null,
        poi_id: item?.id != null ? String(item.id) : null,
        adcode: item?.adcode != null ? String(item.adcode) : null,
        province: typeof item?.province === 'string' ? item.province : null,
        city: typeof item?.city === 'string' ? item.city : null,
        district: typeof item?.district === 'string' ? item.district : null,
        source: 'suggestion',
    };
}

cli({
    site: 'tencent-map',
    name: 'search',
    access: 'read',
    description: '腾讯地图关键词搜索：候选地点列表（标题 / 地址 / 坐标 / POI ID），--region 限定城市',
    domain: 'h5gw.map.qq.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'keyword', type: 'string', required: true, positional: true, help: '关键词，如「腾讯滨海大厦」' },
        { name: 'region', type: 'string', default: '', help: '城市名限定范围（如 深圳市）；省略则在全国范围用输入提示接口检索' },
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `返回条数 (max ${MAX_LIMIT})` },
    ],
    columns: COLUMNS,
    func: async (args) => {
        const keyword = requireString(args.keyword, 'keyword');
        const region = typeof args.region === 'string' ? args.region.trim() : '';
        // The city is interpolated into Tencent's `region(<城市>,0)` boundary
        // DSL, so a parenthesis or comma would silently change the query shape.
        if (/[(),]/.test(region)) {
            throw new ArgumentError('--region must be a plain city name', `Got "${region}" — pass e.g. 深圳市, not a boundary expression.`);
        }
        const limit = normalizeLimit(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
        const pageSize = limit >= TMAP_PAGE_SIZE ? TMAP_PAGE_SIZE : limit;

        const isRegional = region.length > 0;
        const path = isRegional ? '/place/v1/search' : '/place/v1/suggestion';
        const apptag = isRegional ? APPTAG.search : APPTAG.suggestion;
        const label = isRegional ? `tencent-map search in ${region}` : 'tencent-map search';
        const readItem = isRegional ? readSearchItem : readSuggestionItem;

        const rows = [];
        for (let pageIndex = 1; pageIndex <= TMAP_MAX_PAGES && rows.length < limit; pageIndex++) {
            const body = await tmapRequest(path, {
                keyword,
                boundary: isRegional ? `region(${region},0)` : undefined,
                page_size: pageSize,
                page_index: pageIndex,
                region_fix: isRegional ? undefined : 0,
            }, label, { apptag });

            const items = Array.isArray(body.data) ? body.data : [];
            if (items.length === 0) break;
            for (const item of items) {
                if (rows.length >= limit) break;
                rows.push(readItem(item, rows.length + 1));
            }
            if (items.length < pageSize) break;
        }

        if (rows.length === 0) {
            throw emptyResult(label, isRegional
                ? `No place matched "${keyword}" inside ${region}.`
                : `No place matched "${keyword}". Try --region <城市> to widen the search with the regional endpoint.`);
        }
        return rows;
    },
});
