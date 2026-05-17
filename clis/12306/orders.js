/**
 * 12306 in-progress orders for the logged-in user.
 *
 * Returns orders that have not yet been ridden / refunded / completed
 * (the `noComplete` slice). Order history covering completed and
 * refunded tickets uses a separate endpoint that requires extra
 * referer / page-state handshakes and is left for a follow-up so this
 * command can ship reliably.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { require12306Login } from './utils.js';

const NO_COMPLETE_URL = 'https://kyfw.12306.cn/otn/queryOrder/queryMyOrderNoComplete';

cli({
    site: '12306',
    name: 'orders',
    access: 'read',
    description: 'List in-progress 12306 orders (not yet ridden, refunded, or completed) for the logged-in user',
    domain: 'kyfw.12306.cn',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [],
    columns: ['order_id', 'order_date', 'train_code', 'from_station', 'to_station', 'departure', 'passengers', 'status', 'amount'],
    func: async (page) => {
        if (!page) throw new CommandExecutionError('Browser session required for 12306 orders');
        await page.goto('https://kyfw.12306.cn/otn/view/index.html');
        await require12306Login(page, AuthRequiredError);
        const json = await page.evaluate(`async () => {
      const r = await fetch(${JSON.stringify(NO_COMPLETE_URL)}, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: '_json_att=', credentials: 'include',
      });
      if (!r.ok) return { __http: r.status };
      return await r.json();
    }`);
        if (json?.__http) {
            throw new CommandExecutionError(`12306 returned HTTP ${json.__http} for queryMyOrderNoComplete`);
        }
        if (json?.status !== true) {
            throw new CommandExecutionError('12306 queryMyOrderNoComplete returned a failure status');
        }
        const orders = Array.isArray(json?.data?.orderDBList) ? json.data.orderDBList
            : Array.isArray(json?.data?.orderDTODataList) ? json.data.orderDTODataList
            : Array.isArray(json?.data?.orders) ? json.data.orders
            : Array.isArray(json?.data) ? json.data
            : [];
        if (orders.length === 0) {
            throw new EmptyResultError('No in-progress 12306 orders on this account');
        }
        return orders.map((o) => {
            const tickets = Array.isArray(o.tickets) ? o.tickets : [];
            const passengerNames = tickets.map((t) => t.passenger_name || '').filter(Boolean).join(', ');
            return {
                order_id: o.sequence_no || o.order_id || o.sequenceNo || '',
                order_date: o.order_date || '',
                train_code: o.train_code_page || o.station_train_code || o.train_code || '',
                from_station: o.from_station_name_page || o.from_station_name || '',
                to_station: o.to_station_name_page || o.to_station_name || '',
                departure: o.start_train_date_page || o.start_train_date || '',
                passengers: passengerNames,
                status: o.ticket_status_name || o.order_status_name || o.statusName || '',
                amount: o.ticket_total_price_page || o.ticket_total_price || '',
            };
        });
    },
});
