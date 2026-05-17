import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
    buildChatUrl,
    buildExtractChatStateEvaluate,
    buildExtractInboxEvaluate,
    buildSendMessageEvaluate,
    normalizeLimit,
} from './im.js';
import './reply.js';
import { getRegistry } from '@jackwener/opencli/registry';

async function runBrowserScript(html, script, { url = 'https://www.goofish.com/im', beforeEval } = {}) {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    beforeEval?.(dom.window);
    return dom.window.eval(script);
}

describe('xianyu im shared helpers', () => {
    it('normalizes limits with an explicit upper bound', () => {
        expect(normalizeLimit(undefined, 20, 100)).toBe(20);
        expect(normalizeLimit(0, 20, 100)).toBe(1);
        expect(normalizeLimit(3.8, 20, 100)).toBe(3);
        expect(normalizeLimit(999, 20, 100)).toBe(100);
    });

    it('extracts recent inbox conversations from visible IM rows', async () => {
        const result = await runBrowserScript(`
            <main>
              <a href="/im?itemId=10001&peerUserId=90001" class="conversation unread">
                <div class="name">张三</div>
                <div class="title">MacBook Pro 14</div>
                <div class="money">¥5999</div>
                <div class="message">还在吗？</div>
                <span class="badge">2</span>
              </a>
              <a href="https://www.goofish.com/im?itemId=10002&peerUserId=90002" class="conversation">
                <div class="name">李四</div>
                <div class="title">iPhone 15</div>
                <div class="message">明天能发货</div>
              </a>
            </main>
        `, buildExtractInboxEvaluate(10));

        expect(result.requiresAuth).toBe(false);
        expect(result.items).toEqual([
            {
                peer_name: '张三',
                peer_user_id: '90001',
                item_id: '10001',
                item_title: 'MacBook Pro 14',
                price: '¥5999',
                last_message: '还在吗？',
                unread: true,
                unread_count: 2,
                url: 'https://www.goofish.com/im?itemId=10001&peerUserId=90001',
                row_index: 0,
            },
            {
                peer_name: '李四',
                peer_user_id: '90002',
                item_id: '10002',
                item_title: 'iPhone 15',
                price: '',
                last_message: '明天能发货',
                unread: false,
                unread_count: 0,
                url: 'https://www.goofish.com/im?itemId=10002&peerUserId=90002',
                row_index: 1,
            },
        ]);
    });

    it('extracts inbox conversations from the real virtualized conversation row shape', async () => {
        const result = await runBrowserScript(`
            <main>
              <div id="conv-list-scrollable">
                <div class="rc-virtual-list">
                  <div class="rc-virtual-list-holder">
                    <div class="rc-virtual-list-holder-inner">
                      <div class="conversation-item--abc">
                        <div>
                          <div><span><sup title="3"><span>3</span></sup></span></div>
                          <div>
                            <div><div>通知消息</div></div>
                            <div>订单即将自动确认收货</div>
                            <div>3小时前</div>
                          </div>
                        </div>
                      </div>
                      <div class="conversation-item--abc">
                        <div>
                          <div>
                            <div><div>隔壁猫小小</div></div>
                            <div>亲，喜欢可以拍下，有问题留言哦～会尽快回复</div>
                            <div>21小时前</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </main>
        `, buildExtractInboxEvaluate(10));

        expect(result.items).toEqual([
            expect.objectContaining({
                peer_name: '通知消息',
                last_message: '订单即将自动确认收货',
                unread: true,
                unread_count: 3,
            }),
            expect.objectContaining({
                peer_name: '隔壁猫小小',
                last_message: '亲，喜欢可以拍下，有问题留言哦～会尽快回复',
                unread: false,
            }),
        ]);
    });

    it('extracts all visible messages for a specific chat', async () => {
        const state = await runBrowserScript(`
            <main>
              <textarea></textarea>
              <button>发送</button>
              <div class="message-topbar"><span class="text1">张三</span><span class="text2">(90001)</span></div>
              <a href="/item?id=10001"><span class="title">MacBook Pro 14</span><span class="money">¥5999</span></a>
              <div id="message-list-scrollable">
                <div class="bubble">你好</div>
                <div class="message">还在吗？</div>
                <div class="msg">在的</div>
              </div>
            </main>
        `, buildExtractChatStateEvaluate());

        expect(state.peer_name).toBe('张三');
        expect(state.peer_masked_id).toBe('90001');
        expect(state.item_title).toBe('MacBook Pro 14');
        expect(state.messages).toEqual([
            { index: 1, text: '你好' },
            { index: 2, text: '还在吗？' },
            { index: 3, text: '在的' },
        ]);
        expect(state.visible_messages).toEqual(['你好', '还在吗？', '在的']);
    });

    it('extracts messages from the real Xianyu message-row shape', async () => {
        const state = await runBrowserScript(`
            <main>
              <textarea></textarea>
              <button>发 送</button>
              <div id="message-list-scrollable">
                <div class="message-list-reverse--x">
                  <div class="message-row--a">
                    <div class="ant-dropdown-trigger message-content--b">
                      <div class="message-text--c message-text-right--d"><span>我发出的消息</span></div>
                      <div class="read-status-text--e">已读</div>
                    </div>
                  </div>
                  <div class="message-row--a">
                    <div class="ant-dropdown-trigger message-content--b">
                      <div class="message-text--c message-text-left--d"><span>对方回复</span></div>
                    </div>
                  </div>
                </div>
              </div>
            </main>
        `, buildExtractChatStateEvaluate());

        expect(state.can_send).toBe(true);
        expect(state.messages).toEqual([
            { index: 1, text: '我发出的消息' },
            { index: 2, text: '对方回复' },
        ]);
    });


    it('registers reply as an explicit write command', () => {
        const command = getRegistry().get('xianyu/reply');
        expect(command?.access).toBe('write');
        expect(command?.columns).toEqual(['status', 'peer_name', 'item_title', 'price', 'location', 'message']);
    });

    it('builds chat URLs and can send through the shared helper', async () => {
        expect(buildChatUrl('10001', '90001')).toBe('https://www.goofish.com/im?itemId=10001&peerUserId=90001');

        let clicked = false;
        const result = await runBrowserScript('<textarea></textarea><button>发送</button>', buildSendMessageEvaluate('你好'), {
            beforeEval(window) {
                window.document.querySelector('button').addEventListener('click', () => {
                    clicked = true;
                });
            },
        });

        expect(result).toEqual({ ok: true });
        expect(clicked).toBe(true);
    });
});
