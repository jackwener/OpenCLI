// tencent-map convert — coordinate reference system conversion (WGS-84 / GCJ-02 / BD-09).
//
// The getPoint page has no such feature: it only ever shows GCJ-02 ("腾讯坐标"),
// which silently differs from what a GPS device reports. This command closes
// that gap locally — pure math in ./coords.js, no request, no quota, and it
// keeps working when the WebService is unreachable.
//
// `shift_meters` is the honest signal: an identity conversion (a point outside
// mainland China, where GCJ-02 obfuscation does not apply) reports 0, and a
// WGS-84 → GCJ-02 hop in Shenzhen reports ~603 m.
import { ArgumentError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { convertCoord, formatLatLng, haversineMeters, normalizeCrs, outOfChina, parseLatLngList } from './coords.js';

const COLUMNS = ['input', 'from', 'to', 'lat', 'lng', 'shift_meters', 'inside_china'];

// Applied here as well as in the arg declaration: `default` feeds the CLI/help
// layer, while func() is also called directly (tests, pipeline steps) with the
// raw kwargs.
const DEFAULT_FROM = 'wgs84';
const DEFAULT_TO = 'gcj02';

cli({
    site: 'tencent-map',
    name: 'convert',
    access: 'read',
    description: '坐标转换：WGS-84(GPS) / GCJ-02(腾讯·高德) / BD-09(百度) 互转，纯本地计算',
    domain: 'lbs.qq.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'coords', type: 'string', required: true, positional: true, help: '一个或多个 "lat,lng"，用 ; 分隔；纬度在前' },
        { name: 'from', type: 'string', default: DEFAULT_FROM, help: '源坐标系：wgs84(GPS) / gcj02(腾讯·高德) / bd09(百度)' },
        { name: 'to', type: 'string', default: DEFAULT_TO, help: '目标坐标系：wgs84 / gcj02 / bd09' },
    ],
    columns: COLUMNS,
    func: async (args) => {
        const from = normalizeCrs(args.from ?? DEFAULT_FROM, '--from');
        const to = normalizeCrs(args.to ?? DEFAULT_TO, '--to');
        if (from === to) {
            throw new ArgumentError('--from and --to must differ', `Both resolved to "${from}".`);
        }
        const points = parseLatLngList(args.coords, 'coords');

        return points.map(({ lat, lng }) => {
            const [outLat, outLng] = convertCoord(lat, lng, from, to);
            return {
                input: formatLatLng(lat, lng),
                from,
                to,
                lat: Number(outLat.toFixed(6)),
                lng: Number(outLng.toFixed(6)),
                shift_meters: Math.round(haversineMeters(lat, lng, outLat, outLng) * 100) / 100,
                inside_china: !outOfChina(lat, lng),
            };
        });
    },
});
