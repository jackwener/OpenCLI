/**
 * Taobao add-cart SKU selection.
 *
 * The fixes mirror the verified local repair in #2428: group options by their
 * own dimension container (the shared `skuItem--` wrapper spans every
 * dimension) and click one dimension at a time, re-reading the DOM after the
 * panel re-render instead of clicking everything in a single snapshot.
 */
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { selectTaobaoSkuOptions } from './add-cart.js';

const SKU_HTML = `
  <div class="skuWrapper">
    <div class="skuItem--shared">
      <div class="skuItemClipX--color">
        <span class="valueItem--color-1">红色</span>
        <span class="valueItem--color-2">蓝色</span>
      </div>
      <div class="skuItemClipX--size">
        <span class="valueItem--size-1">XL</span>
        <span class="valueItem--size-2">XXL</span>
      </div>
    </div>
  </div>
`;

function createSkuPage(html, { bindClicks = true } = {}) {
  const dom = new JSDOM(html, { url: 'https://item.taobao.com/item.htm?id=1', runScripts: 'outside-only' });
  if (bindClicks) {
    dom.window.document.querySelectorAll('[class*="valueItem--"]').forEach((item) => {
      item.addEventListener('click', () => {
        const group = item.parentElement;
        Array.from(group.querySelectorAll('[class*="valueItem--"]')).forEach((sibling) => {
          sibling.classList.remove('selected');
        });
        item.classList.add('selected');
      });
    });
  }
  const page = {
    evaluate: vi.fn(async (script) => dom.window.eval(script)),
    wait: vi.fn(async () => {}),
  };
  return { dom, page };
}

describe('selectTaobaoSkuOptions', () => {
  it('clicks one dimension at a time and reads the final selection from the DOM (#2428)', async () => {
    const { dom, page } = createSkuPage(SKU_HTML);
    const result = await selectTaobaoSkuOptions(page, ['红色', 'XL']);

    expect(result).toEqual({ selected: ['红色', 'XL'], state: 'complete' });
    // one click per dimension plus the final read
    expect(page.evaluate).toHaveBeenCalledTimes(3);
    expect(page.wait).toHaveBeenCalledTimes(2);
    expect(page.wait).toHaveBeenCalledWith(0.9);
    expect(dom.window.document.querySelector('.valueItem--color-1').className).toContain('selected');
    expect(dom.window.document.querySelector('.valueItem--size-1').className).toContain('selected');
  });

  it('does not collapse sibling dimensions under the shared skuItem wrapper (#2428)', async () => {
    const { dom, page } = createSkuPage(SKU_HTML);
    await selectTaobaoSkuOptions(page, []);
    // Both dimensions are selected, i.e. grouping produced two groups even
    // though `.skuItem--shared` wraps both of them.
    expect(dom.window.document.querySelectorAll('[class*="valueItem--"].selected')).toHaveLength(2);
    expect(page.evaluate).toHaveBeenCalledTimes(3);
  });

  it('falls back to the first enabled option when keywords match nothing', async () => {
    const { page } = createSkuPage(SKU_HTML);
    const result = await selectTaobaoSkuOptions(page, ['不存在的规格']);
    expect(result.state).toBe('complete');
    expect(result.selected).toEqual(['红色', 'XL']);
  });

  it('skips disabled options', async () => {
    const html = SKU_HTML.replace('class="valueItem--color-1"', 'class="valueItem--color-1 disabled"');
    const { page } = createSkuPage(html);
    const result = await selectTaobaoSkuOptions(page, ['红色']);
    expect(result).toEqual({ selected: ['蓝色', 'XL'], state: 'complete' });
  });

  it('reports products without SKU groups without clicking anything', async () => {
    const { page } = createSkuPage('<div class="plain-product"></div>');
    const result = await selectTaobaoSkuOptions(page, ['红色']);
    expect(result).toEqual({ selected: [], state: 'no_groups' });
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(page.wait).not.toHaveBeenCalled();
  });

  it('bounds the walk when clicks never change the page state', async () => {
    const { page } = createSkuPage(SKU_HTML, { bindClicks: false });
    const result = await selectTaobaoSkuOptions(page, ['红色']);
    expect(result.state).toBe('max_steps');
    expect(page.evaluate).toHaveBeenCalledTimes(10);
    expect(page.wait).toHaveBeenCalledTimes(10);
  });
});
