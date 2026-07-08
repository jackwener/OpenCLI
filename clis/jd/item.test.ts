import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { __test__ } from './item.js';

const originalPerformance = globalThis.performance;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

function restoreGlobals() {
  globalThis.performance = originalPerformance;
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
}

describe('jd item image helpers', () => {
  it('normalizes JD item URL input to a SKU before building selectors', () => {
    expect(__test__.normalizeJdSkuInput('100328272886')).toBe('100328272886');
    expect(__test__.normalizeJdSkuInput('https://item.jd.com/100328272886.html?purchasetab=gfgm')).toBe('100328272886');
    expect(__test__.normalizeJdSkuInput('skuId=10218494560141')).toBe('10218494560141');
  });

  it('normalizes protocol-relative and thumbnail-sized JD image URLs', () => {
    expect(__test__.normalizeJdImageUrl('//img10.360buyimg.com/imgzone/jfs/a.jpg.avif')).toBe('https://img10.360buyimg.com/imgzone/jfs/a.jpg.avif');
    expect(__test__.normalizeJdImageSize('https://img10.360buyimg.com/pcpubliccms/s228x228_jfs/t1/a.jpg.avif')).toBe('https://img10.360buyimg.com/pcpubliccms/jfs/t1/a.jpg.avif');
    expect(__test__.normalizeJdImageSize('https://img10.360buyimg.com/n1/s450x450_jfs/t1/a.jpg.avif')).toBe('https://img10.360buyimg.com/n1/jfs/t1/a.jpg.avif');
  });

  it('accepts only product main images for mainImages', () => {
    expect(__test__.isJdMainImage('https://img10.360buyimg.com/pcpubliccms/jfs/t1/main.jpg.avif')).toBe(true);
    expect(__test__.isJdMainImage('https://img10.360buyimg.com/pcpubliccms/s228x228_jfs/t1/main.jpg.avif')).toBe(true);
    expect(__test__.isJdMainImage('https://img10.360buyimg.com/n1/jfs/t1/main.jpg.avif')).toBe(true);

    expect(__test__.isJdMainImage('https://img10.360buyimg.com/imgzone/jfs/t1/detail.jpg.avif')).toBe(false);
    expect(__test__.isJdMainImage('https://img10.360buyimg.com/shaidan/jfs/t1/user.jpg.avif')).toBe(false);
    expect(__test__.isJdMainImage('https://img10.360buyimg.com/babel/jfs/t1/recommend.jpg.avif')).toBe(false);
  });

  it('accepts only detail-area image CDN paths for detailImages', () => {
    expect(__test__.isJdDetailImage('https://img10.360buyimg.com/imgzone/jfs/t1/detail.jpg.avif')).toBe(true);
    expect(__test__.isJdDetailImage('https://img10.360buyimg.com/jdcms/jfs/t1/detail.jpg.avif')).toBe(true);
    expect(__test__.isJdDetailImage('https://img10.360buyimg.com/babel/jfs/t1/detail.jpg.avif')).toBe(true);

    expect(__test__.isJdDetailImage('https://img10.360buyimg.com/pcpubliccms/jfs/t1/main.jpg.avif')).toBe(false);
    expect(__test__.isJdDetailImage('https://img10.360buyimg.com/pcpubliccms/s228x228_jfs/t1/thumb.jpg.avif')).toBe(false);
    expect(__test__.isJdDetailImage('https://img10.360buyimg.com/n1/jfs/t1/main.jpg.avif')).toBe(false);
    expect(__test__.isJdDetailImage('https://img10.360buyimg.com/sku/jfs/t1/color-option.gif')).toBe(false);
    expect(__test__.isJdWareGraphicDetailImage('https://img10.360buyimg.com/sku/jfs/t1/ware-graphic.jpg')).toBe(true);
    expect(__test__.isJdWareGraphicDetailImage('https://img10.360buyimg.com/sku/s228x228_jfs/t1/thumb.jpg')).toBe(false);
    expect(__test__.isJdDetailImage('https://img10.360buyimg.com/shaidan/jfs/t1/user.jpg.avif')).toBe(false);
  });

  it('keeps legacy avifImages restricted to detail images only', () => {
    expect(__test__.extractAvifImages([
      'https://img10.360buyimg.com/pcpubliccms/jfs/t1/main.jpg.avif',
      'https://img10.360buyimg.com/imgzone/jfs/t1/detail.jpg.avif',
      'https://img10.360buyimg.com/shaidan/jfs/t1/user.jpg.avif',
      'https://img10.360buyimg.com/imgzone/jfs/t1/detail.gif',
    ], 10)).toEqual([
      'https://img10.360buyimg.com/imgzone/jfs/t1/detail.jpg.avif',
    ]);
  });

  it('prioritizes JPG detail images before PNG banners and GIFs when limiting detailImages', () => {
    expect(__test__.orderJdDetailImages([
      'https://img10.360buyimg.com/imgzone/jfs/t1/hero-a.gif',
      'https://img11.360buyimg.com/imgzone/jfs/t1/banner.png.avif',
      'https://img12.360buyimg.com/imgzone/jfs/t1/326893/25/18592/117159/68c264f5F9a41addf/2c9ad60b7f390339.jpg.avif',
      'https://img12.360buyimg.com/imgzone/jfs/t1/330152/17/11906/130964/68c264f2Ffcf6e5c1/c2ccb28722dc47ce.jpg.avif',
      'https://img11.360buyimg.com/cms/jfs/t1/banner.gif',
    ])).toEqual([
      'https://img12.360buyimg.com/imgzone/jfs/t1/326893/25/18592/117159/68c264f5F9a41addf/2c9ad60b7f390339.jpg.avif',
      'https://img12.360buyimg.com/imgzone/jfs/t1/330152/17/11906/130964/68c264f2Ffcf6e5c1/c2ccb28722dc47ce.jpg.avif',
      'https://img11.360buyimg.com/imgzone/jfs/t1/banner.png.avif',
      'https://img10.360buyimg.com/imgzone/jfs/t1/hero-a.gif',
      'https://img11.360buyimg.com/cms/jfs/t1/banner.gif',
    ]);
  });

  it('extracts valid JD price payload values', () => {
    expect(__test__.extractPriceFromPayload([{ id: 'J_100291143898', p: '6999.00' }])).toBe('6999.00');
    expect(__test__.extractPriceFromPayload([{ id: 'J_100291143898', p: '-1.00', op: '7299.00' }])).toBe('7299.00');
    expect(__test__.extractPriceFromPayload([])).toBe('');
  });

  it('extracts visible JD price text from DOM', () => {
    const dom = new JSDOM(`
      <div>
        <span>预售价</span>
        <span><span>¥</span><span>12221</span></span>
      </div>
    `);
    const previousDocument = globalThis.document;
    globalThis.document = dom.window.document;

    try {
      expect(__test__.normalizePriceText('¥ 12221')).toBe('12221');
      expect(__test__.extractPriceFromDom('100291143898')).toBe('12221');
    }
    finally {
      globalThis.document = previousDocument;
    }
  });

  it('extracts only gallery main images and detail-container images from DOM', () => {
    const dom = new JSDOM(`
      <div class="_gallery_116km_1">
        <img src="https://img10.360buyimg.com/pcpubliccms/s228x228_jfs/t1/main-a.jpg.avif" />
        <img data-src="//img10.360buyimg.com/n1/s450x450_jfs/t1/main-b.jpg.avif" />
        <img src="https://img10.360buyimg.com/imgzone/jfs/t1/wrong-detail-in-gallery.jpg.avif" />
      </div>
      <div class="recommend">
        <img src="https://img10.360buyimg.com/babel/jfs/t1/recommend.jpg.avif" />
        <img src="https://img10.360buyimg.com/pcpubliccms/jfs/t1/recommend-main-like.jpg.avif" />
      </div>
      <h2 id="SPXQ-title">商品详情</h2>
      <div class="detail-content-wrap">
        <img src="https://img10.360buyimg.com/imgzone/jfs/t1/detail-hero.gif" />
        <img src="https://img10.360buyimg.com/imgzone/jfs/t1/detail-a.jpg.avif" />
        <source srcset="https://img11.360buyimg.com/imgzone/jfs/t1/detail-source.jpg.avif 1x" />
        <img src="https://img10.360buyimg.com/pcpubliccms/jfs/t1/wrong-main-in-detail.jpg.avif" />
        <img src="https://img10.360buyimg.com/shaidan/jfs/t1/wrong-user.jpg.avif" />
      </div>
      <div id="spec-list">
        <img src="https://img10.360buyimg.com/pcpubliccms/s48x48_jfs/t1/wrong-sku-option.jpg.avif" />
      </div>
    `);
    const previousDocument = globalThis.document;
    globalThis.document = dom.window.document;

    try {
      expect(__test__.extractMainImages(10)).toEqual([
        'https://img10.360buyimg.com/pcpubliccms/jfs/t1/main-a.jpg.avif',
        'https://img10.360buyimg.com/n1/jfs/t1/main-b.jpg.avif',
      ]);
      expect(__test__.extractDetailImagesFromDom(10)).toEqual([
        'https://img10.360buyimg.com/imgzone/jfs/t1/detail-a.jpg.avif',
        'https://img11.360buyimg.com/imgzone/jfs/t1/detail-source.jpg.avif',
        'https://img10.360buyimg.com/imgzone/jfs/t1/detail-hero.gif',
      ]);
    }
    finally {
      globalThis.document = previousDocument;
    }
  });

  it('collects JD detail images from computed background images', () => {
    const dom = new JSDOM(`
      <div id="J-detail">
        <div class="ssd-module computed-bg"></div>
        <div class="ssd-module ignored-bg"></div>
      </div>
    `);
    const previousDocument = globalThis.document;
    const previousGetComputedStyle = globalThis.getComputedStyle;
    globalThis.document = dom.window.document;
    globalThis.getComputedStyle = ((element: Element) => ({
      background: '',
      backgroundImage: element.classList.contains('computed-bg')
        ? 'url("//img10.360buyimg.com/imgzone/jfs/t1/computed-detail.jpg.avif")'
        : 'none',
    })) as typeof getComputedStyle;

    try {
      expect(__test__.extractDetailImagesFromDom(10)).toEqual([
        'https://img10.360buyimg.com/imgzone/jfs/t1/computed-detail.jpg.avif',
      ]);
    }
    finally {
      globalThis.document = previousDocument;
      globalThis.getComputedStyle = previousGetComputedStyle;
    }
  });

  it('collects JD detail images from inline JSON-like script text', () => {
    const dom = new JSDOM(`
      <h2 id="SPXQ-title">商品详情</h2>
      <script>
        window.__DETAIL_DATA__ = {
          images: [
            "https://img10.360buyimg.com/imgzone/jfs/t1/script-detail-a.jpg.avif",
            "//img11.360buyimg.com/imgzone/jfs/t1/script-detail-b.gif"
          ]
        };
      </script>
    `);
    const previousDocument = globalThis.document;
    globalThis.document = dom.window.document;

    try {
      expect(__test__.extractDetailImagesFromDom(10)).toEqual([
        'https://img10.360buyimg.com/imgzone/jfs/t1/script-detail-a.jpg.avif',
        'https://img11.360buyimg.com/imgzone/jfs/t1/script-detail-b.gif',
      ]);
    }
    finally {
      globalThis.document = previousDocument;
    }
  });

  it('collects JD detail images from same-origin iframe content', () => {
    const dom = new JSDOM(`
      <h2 id="SPXQ-title">商品详情</h2>
      <iframe id="detail-frame"></iframe>
    `, { url: 'https://item.jd.com/100328272886.html' });
    const frameDom = new JSDOM(`
      <div id="J-detail">
        <img src="https://img10.360buyimg.com/imgzone/jfs/t1/frame-detail-a.jpg.avif" />
        <div style="background-image:url(//img11.360buyimg.com/cms/jfs/t1/frame-detail-b.jpg.avif)"></div>
      </div>
    `, { url: 'https://item.jd.com/detail-frame.html' });
    const iframe = dom.window.document.getElementById('detail-frame') as HTMLIFrameElement;
    Object.defineProperty(iframe, 'contentDocument', { value: frameDom.window.document, configurable: true });
    Object.defineProperty(iframe, 'contentWindow', { value: frameDom.window, configurable: true });

    const previousDocument = globalThis.document;
    globalThis.document = dom.window.document;

    try {
      expect(__test__.extractDetailImagesFromDom(10)).toEqual([
        'https://img10.360buyimg.com/imgzone/jfs/t1/frame-detail-a.jpg.avif',
        'https://img11.360buyimg.com/cms/jfs/t1/frame-detail-b.jpg.avif',
      ]);
    }
    finally {
      globalThis.document = previousDocument;
    }
  });

  it('collects JD detail images from page data objects', async () => {
    const dom = new JSDOM(`
      <h2 id="SPXQ-title">商品详情</h2>
    `);
    globalThis.document = dom.window.document;
    globalThis.window = dom.window as unknown as Window;
    (globalThis as typeof globalThis & { __PAGE_DATA__?: unknown }).__PAGE_DATA__ = {
      detail: {
        images: [
          'https://img10.360buyimg.com/imgzone/jfs/t1/page-data-a.jpg.avif',
          { src: '//img11.360buyimg.com/imgzone/jfs/t1/page-data-b.webp' },
        ],
      },
    };

    try {
      await expect(__test__.extractDetailImagesFromPage(10)).resolves.toEqual([
        'https://img10.360buyimg.com/imgzone/jfs/t1/page-data-a.jpg.avif',
        'https://img11.360buyimg.com/imgzone/jfs/t1/page-data-b.webp',
      ]);
    }
    finally {
      delete (globalThis as typeof globalThis & { __PAGE_DATA__?: unknown }).__PAGE_DATA__;
      restoreGlobals();
    }
  });

  it('collects JD detail images from network resource text', async () => {
    const dom = new JSDOM(`
      <h2 id="SPXQ-title">商品详情</h2>
    `);
    const previousFetch = globalThis.fetch;
    globalThis.document = dom.window.document;
    globalThis.window = dom.window as unknown as Window;
    const fakePerformance = {
      getEntriesByType: () => [{ name: 'https://cdn.jd.com/detail/data.json' }],
      now: () => 0,
    } as Performance;
    globalThis.performance = fakePerformance;
    globalThis.fetch = (async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({
        detail: {
          imgs: ['https://img10.360buyimg.com/imgzone/jfs/t1/network-detail-a.jpg.avif'],
        },
      }),
    })) as typeof fetch;

    try {
      await expect(__test__.extractDetailImagesFromPage(10)).resolves.toEqual([
        'https://img10.360buyimg.com/imgzone/jfs/t1/network-detail-a.jpg.avif',
      ]);
    }
    finally {
      globalThis.fetch = previousFetch;
      restoreGlobals();
    }
  });

  it('collects JD detail images from WareGraphic graphicContent', async () => {
    const dom = new JSDOM(`
      <h2 id="SPXQ-title">商品详情</h2>
    `);
    const previousFetch = globalThis.fetch;
    globalThis.document = dom.window.document;
    globalThis.window = dom.window as unknown as Window;
    globalThis.performance = {
      getEntriesByType: () => [
        { name: 'https://api.m.jd.com/client.action?functionId=pc_item_getWareGraphic&skuId=100328272886' },
      ],
      now: () => 0,
    } as Performance;
    globalThis.fetch = (async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({
        data: {
          graphicContent: `
            <div style="background-image:url(//img30.360buyimg.com/sku/jfs/t1/ware-a.jpg)"></div>
            <img src="https://img30.360buyimg.com/sku/jfs/t1/ware-b.png" />
            <a href="https://item.jd.com/100328272886.html">not image</a>
          `,
        },
      }),
    })) as typeof fetch;

    try {
      await expect(__test__.extractDetailImagesFromPage(10)).resolves.toEqual([
        'https://img30.360buyimg.com/sku/jfs/t1/ware-a.jpg',
        'https://img30.360buyimg.com/sku/jfs/t1/ware-b.png',
      ]);
    }
    finally {
      globalThis.fetch = previousFetch;
      restoreGlobals();
    }
  });

  it('collects images from every repeated JD detail module', () => {
    const dom = new JSDOM(`
      <h2 id="SPXQ-title">商品详情</h2>
      <div class="ssd-module-wrap">
        <img src="https://img10.360buyimg.com/imgzone/jfs/t1/detail-a.jpg.avif" />
      </div>
      <div class="ssd-module-wrap">
        <img src="https://img11.360buyimg.com/imgzone/jfs/t1/detail-b.jpg.avif" />
      </div>
      <div class="ssd-module-wrap">
        <img src="https://img12.360buyimg.com/imgzone/jfs/t1/detail-c.gif" />
      </div>
    `);
    const previousDocument = globalThis.document;
    globalThis.document = dom.window.document;

    try {
      expect(__test__.extractDetailImagesFromDom(10)).toEqual([
        'https://img10.360buyimg.com/imgzone/jfs/t1/detail-a.jpg.avif',
        'https://img11.360buyimg.com/imgzone/jfs/t1/detail-b.jpg.avif',
        'https://img12.360buyimg.com/imgzone/jfs/t1/detail-c.gif',
      ]);
    }
    finally {
      globalThis.document = previousDocument;
    }
  });

  it('reports detail scroll progress so lazy-loaded detail images can stabilize', () => {
    const dom = new JSDOM(`
      <h2 id="SPXQ-title">商品详情</h2>
      <div class="detail-content-wrap">
        <img src="https://img10.360buyimg.com/imgzone/jfs/t1/detail-a.jpg.avif" />
        <img src="https://img10.360buyimg.com/imgzone/jfs/t1/detail-b.jpg.avif" />
      </div>
    `);
    const previousDocument = globalThis.document;
    const previousWindow = globalThis.window;
    globalThis.document = dom.window.document;
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    Object.defineProperty(dom.window, 'scrollY', { value: 1800, configurable: true });
    Object.defineProperty(dom.window, 'innerHeight', { value: 900, configurable: true });
    Object.defineProperty(dom.window.document.documentElement, 'scrollHeight', { value: 2600, configurable: true });

    try {
      expect(__test__.getJdDetailScrollSnapshot(10)).toMatchObject({
        detailImageCount: 2,
        scrollY: 1800,
        viewportHeight: 900,
        scrollHeight: 2600,
        nearBottom: true,
      });
    }
    finally {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
    }
  });

  it('parses structured specs without pairing unrelated body text', () => {
    expect(__test__.extractSpecsFromText([
      '品牌：美的（Midea）',
      '商品编号',
      '100291143898',
      '洗涤容量',
      '能效等级',
      '一级能效',
      '类型',
      '加入购物车',
    ].join('\n'))).toEqual({
      品牌: '美的（Midea）',
      商品编号: '100291143898',
      能效等级: '一级能效',
    });
  });

  it('extracts selected specs from the newer JD spec-list DOM', () => {
    const dom = new JSDOM(`
      <div id="spec-list" class="page-right-spec">
        <div class="horizontal-layout specification-series-layout">
          <div class="layout-label">系列品</div>
          <div class="layout-content">
            <div class="specification-series-item specification-series-item--selected">
              <span class="specification-series-item-text">【年度新品】玉兔3.0pro 12kg</span>
            </div>
            <div class="specification-series-item"><span class="specification-series-item-text">其他系列</span></div>
          </div>
        </div>
        <div class="specifications-panel-content">
          <div class="specification-group">
            <div class="specification-group-label">款式</div>
            <div class="specification-group-content">
              <div class="specification-item-sku has-image specification-item-sku--selected" title="">
                <img class="specification-item-sku-image" alt="洗烘套装" src="https://img13.360buyimg.com/pcpubliccms/s48x48_jfs/t1/spec.jpg.avif" />
                <span class="specification-item-sku-text">洗烘套装</span>
              </div>
              <div class="specification-item-sku has-image"><span class="specification-item-sku-text">滚筒单洗</span></div>
            </div>
          </div>
        </div>
      </div>
    `);
    const previousDocument = globalThis.document;
    globalThis.document = dom.window.document;

    try {
      expect(__test__.extractSpecs()).toEqual({
        系列品: '【年度新品】玉兔3.0pro 12kg',
        款式: '洗烘套装',
      });
    }
    finally {
      globalThis.document = previousDocument;
    }
  });

  it('detects whether the loaded page is the expected JD product page', () => {
    const dom = new JSDOM(`
      <html>
        <head><title>京东</title></head>
        <body><div>请登录</div><div class="sku-title">商品标题</div><div id="spec-list"></div></body>
      </html>
    `, { url: 'https://item.jd.com/100291143898.html' });
    const previousDocument = globalThis.document;
    const previousLocation = globalThis.location;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;

    try {
      expect(__test__.detectJdPageState('100291143898')).toMatchObject({
        isProductPage: true,
        hasProductMarker: true,
        onExpectedItemUrl: true,
        looksBlocked: false,
        isLoginPage: false,
        hasSecurityChallenge: false,
      });
      document.body.innerHTML = '<div>请登录后完成安全验证</div>';
      expect(__test__.detectJdPageState('100291143898')).toMatchObject({
        isProductPage: false,
        looksBlocked: true,
        hasSecurityChallenge: true,
      });
      const riskDom = new JSDOM(`
        <html>
          <head><title>京东验证</title></head>
          <body><div>京东验证</div></body>
        </html>
      `, { url: 'https://cfe.m.jd.com/privatedomain/risk_handler/03101900/?returnurl=https%3A%2F%2Fitem.jd.com%2F100291143898.html' });
      globalThis.document = riskDom.window.document;
      globalThis.location = riskDom.window.location;
      expect(__test__.detectJdPageState('100291143898')).toMatchObject({
        isProductPage: false,
        looksBlocked: true,
        hasSecurityChallenge: true,
      });
    }
    finally {
      globalThis.document = previousDocument;
      globalThis.location = previousLocation;
    }
  });

  it('does not treat JD login page as a product page', () => {
    const dom = new JSDOM(`
      <html>
        <head><title>京东-欢迎登录</title></head>
        <body><img src="https://img10.360buyimg.com/img/jfs/login.png" /></body>
      </html>
    `, { url: 'https://passport.jd.com/new/login.aspx?ReturnUrl=https%3A%2F%2Fitem.jd.com%2F100291143898.html' });
    const previousDocument = globalThis.document;
    const previousLocation = globalThis.location;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;

    try {
      expect(__test__.detectJdPageState('100291143898')).toMatchObject({
        isProductPage: false,
        hasProductMarker: false,
        onExpectedItemUrl: false,
        looksBlocked: true,
        isLoginPage: true,
      });
    }
    finally {
      globalThis.document = previousDocument;
      globalThis.location = previousLocation;
    }
  });
});
