import actionCodeModule from './action_code.js';

// 将函数转换为字符串并提取函数体
const functionString = actionCodeModule.toString();
const functionMatch = functionString.match(/async\s+function[^{]*\{([\s\S]*)\}/);
const actionCode = functionMatch ? functionMatch[1].trim() : functionString;

const extractProductDetailFromShopee = {
  "id": "2a5f130b-adf8-42a2-94ce-c3708016a1aa",
  "icon": "https://deo.shopeemobile.com/shopee/shopee-pcmall-live-sg/assets/icon_favicon_1_32.9cd61b2e90c0f104.png",
  "name": "Shopee Product Details with shopdora",
  "description": "Extracts detailed information about a product listed on Shopee, including its title, pricing, ratings, sales data, seller information, and product specifications. This template is suitable for e-commerce analysis and competitor research on Shopee.",
  "extract_template": {
    "name": "Shopee Product Detail with shopdora",
    "description": "Extracts detailed information about a product listed on Shopee, including its title, pricing, ratings, sales data, seller information, and product specifications. This template is suitable for e-commerce analysis and competitor research on Shopee.",
    "baseSelector": "div.page-product > div.container",
    "fields": [
      {
        "name": "title",
        "selector": "h1.vR6K3w > span",
        "type": "text",
        "function": ""
      },
      {
        "name": "rating_score",
        "selector": "div.F9RHbS.dQEiAI",
        "type": "text",
        "function": ""
      },
      {
        "name": "rating_count_text",
        "selector": "button.flex.e2p50f:nth-of-type(2) > .F9RHbS",
        "type": "text",
        "function": ""
      },
      {
        "name": "sold_count_text",
        "selector": ".aleSBU > .AcmPRb",
        "type": "text",
        "function": ""
      },
      {
        "name": "shopdora_login_message",
        "selector": ".shopdoraLoginPage, .pageDetailLoginTitle",
        "type": "text",
        "function": "function $(text) { return text ? 'Shopdora 未登录' : ''; }"
      },
      {
        "name": "current_price_range",
        "selector": ".shopdoraPirceList span",
        "type": "text",
        "function": ""
      },
      {
        "name": "shopee_price",
        "selector": ".jRlVo0 .IZPeQz.B67UQ0",
        "type": "text",
        "function": ""
      },
      {
        "name": "shopdora_price",
        "selector": ".shopdoraPirceList span",
        "type": "text",
        "function": ""
      },
      {
        "name": "original_price",
        "selector": ".jRlVo0 .ZA5sW5",
        "type": "text",
        "function": ""
      },
      {
        "name": "discount_percentage",
        "selector": ".jRlVo0 .vms4_3",
        "type": "text",
        "function": ""
      },
      {
        "name": "main_image_url",
        "selector": ".UdI7e2 picture img.fMm3P2, .UdI7e2 picture img",
        "type": "attribute",
        "attribute": "src",
        "function": ""
      },
      {
        "name": "thumbnail_url",
        "selector": ".airUhU .UBG7wZ .YM40Nc picture img.raRnQV, .airUhU .UBG7wZ .YM40Nc picture img",
        "type": "list",
        "fields": [
          {
            "name": "thumbnail_url",
            "selector": "",
            "type": "attribute",
            "attribute": "src",
            "function": ""
          }
        ]
      },
      {
        "name": "product_id",
        "selector": ".detail-info > .detail-info-list:nth-child(1) > .detail-info-item:nth-child(1) .detail-info-item-main, .detail-info > .detail-info-list:nth-child(1) > .detail-info-item:nth-child(1) .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "product_title",
        "selector": ".detail-info > .detail-info-list:nth-child(1) > .detail-info-item:nth-child(2) .detail-info-item-main, .detail-info > .detail-info-list:nth-child(1) > .detail-info-item:nth-child(2) .item-main.cursor, .detail-info > .detail-info-list:nth-child(1) > .detail-info-item:nth-child(2) .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "brand",
        "selector": ".detail-info > .detail-info-list:nth-child(1) > .detail-info-item:nth-child(3) .detail-info-item-main, .detail-info > .detail-info-list:nth-child(1) > .detail-info-item:nth-child(3) .item-main.cursor, .detail-info > .detail-info-list:nth-child(1) > .detail-info-item:nth-child(3) .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "category",
        "selector": ".detail-info > .detail-info-list:nth-child(2) > .detail-info-item:nth-child(1) .detail-info-item-main, .detail-info > .detail-info-list:nth-child(2) > .detail-info-item:nth-child(1) .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "listing_date2",
        "selector": ".detail-info > .detail-info-list:nth-child(2) > .detail-info-item:nth-child(2) .detail-info-item-main, .detail-info > .detail-info-list:nth-child(2) > .detail-info-item:nth-child(2) .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "sales_1d_7d_2",
        "selector": ".detail-info > .detail-info-list:nth-child(4) > .detail-info-item:nth-child(1) .detail-info-item-main, .detail-info > .detail-info-list:nth-child(4) > .detail-info-item:nth-child(1) .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "sales_30d",
        "selector": ".detail-info > .detail-info-list:nth-child(5) > .detail-info-item.itemTwo.en_detail-info-item.en_MaxWidth .detail-info-item-main, .detail-info > .detail-info-list:nth-child(5) > .detail-info-item.itemTwo.en_detail-info-item.en_MaxWidth .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "gmv_30d",
        "selector": ".detail-info > .detail-info-list:nth-child(5) > .detail-info-item.MaxWidth.en_detail-info-item.en_MaxWidth .detail-info-item-main, .detail-info > .detail-info-list:nth-child(5) > .detail-info-item.MaxWidth.en_detail-info-item.en_MaxWidth .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "total_sales",
        "selector": ".detail-info > .detail-info-list:nth-child(6) > .detail-info-item.itemTwo.en_detail-info-item.en_MaxWidth .detail-info-item-main, .detail-info > .detail-info-list:nth-child(6) > .detail-info-item.itemTwo.en_detail-info-item.en_MaxWidth .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "total_gmv",
        "selector": ".detail-info > .detail-info-list:nth-child(6) > .detail-info-item.MaxWidth.en_detail-info-item.en_MaxWidth .detail-info-item-main, .detail-info > .detail-info-list:nth-child(6) > .detail-info-item.MaxWidth.en_detail-info-item.en_MaxWidth .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "first_variant_name",
        "selector": ".j7HL5Q button:has(img):first-of-type .ZivAAW",
        "type": "text",
        "function": ""
      },
      {
        "name": "first_variant_image_url",
        "selector": ".j7HL5Q button:has(img):first-of-type img",
        "type": "attribute",
        "attribute": "src",
        "function": ""
      },
      {
        "name": "color_options",
        "selector": ".j7HL5Q button:has(img)",
        "type": "list",
        "fields": [
          {
            "name": "name",
            "selector": ".ZivAAW",
            "type": "text"
          },
          {
            "name": "label",
            "selector": "",
            "type": "attribute",
            "attribute": "aria-label"
          },
          {
            "name": "image_url",
            "selector": "img",
            "type": "attribute",
            "attribute": "src"
          },
          {
            "name": "is_disabled",
            "selector": "",
            "type": "attribute",
            "attribute": "aria-disabled"
          },
          {
            "name": "is_selected",
            "selector": "",
            "type": "attribute",
            "attribute": "class",
            "function": "function $(value) { return /selection-box-selected/.test(value || '') ? 'true' : 'false'; }"
          }
        ]
      },
      {
        "name": "size_options",
        "selector": ".j7HL5Q button:not(:has(img))",
        "type": "list",
        "fields": [
          {
            "name": "name",
            "selector": ".ZivAAW",
            "type": "text"
          },
          {
            "name": "label",
            "selector": "",
            "type": "attribute",
            "attribute": "aria-label"
          },
          {
            "name": "is_disabled",
            "selector": "",
            "type": "attribute",
            "attribute": "aria-disabled"
          },
          {
            "name": "is_selected",
            "selector": "",
            "type": "attribute",
            "attribute": "class",
            "function": "function $(value) { return /selection-box-selected/.test(value || '') ? 'true' : 'false'; }"
          }
        ]
      },
      {
        "name": "first_sku_price",
        "selector": ".t-table__body tr:first-child td:nth-child(2) p",
        "type": "text",
        "function": ""
      },
      {
        "name": "shop_name",
        "selector": "#sll2-pdp-product-shop .fV3TIn",
        "type": "text",
        "function": ""
      },
      {
        "name": "shop_url",
        "selector": "#sll2-pdp-product-shop a.lG5Xxv",
        "type": "attribute",
        "attribute": "href",
        "function": "function $(url) { return url && url.indexOf('/') === 0 ? 'https://shopee.sg' + url : url; }"
      },
      {
        "name": "shop_logo_url",
        "selector": "#sll2-pdp-product-shop .uLQaPg picture img.Qm507c, #sll2-pdp-product-shop .uLQaPg picture img",
        "type": "attribute",
        "attribute": "src",
        "function": ""
      },
      {
        "name": "shop_last_active",
        "selector": "#sll2-pdp-product-shop .mMlpiZ .Fsv0YO",
        "type": "text",
        "function": ""
      },
      {
        "name": "shop_rating_count",
        "selector": "#sll2-pdp-product-shop .NGzCXN > :nth-child(1) .Cs6w3G",
        "type": "text",
        "function": ""
      },
      {
        "name": "shop_chat_response_rate",
        "selector": "#sll2-pdp-product-shop .NGzCXN > :nth-child(2) .Cs6w3G",
        "type": "text",
        "function": ""
      },
      {
        "name": "shop_joined_time",
        "selector": "#sll2-pdp-product-shop .NGzCXN > :nth-child(3) .Cs6w3G",
        "type": "text",
        "function": ""
      },
      {
        "name": "shop_product_count",
        "selector": "#sll2-pdp-product-shop .NGzCXN > :nth-child(4) .Cs6w3G",
        "type": "text",
        "function": ""
      },
      {
        "name": "shop_product_list_url",
        "selector": "#sll2-pdp-product-shop .NGzCXN a.aArpoe",
        "type": "attribute",
        "attribute": "href",
        "function": "function $(url) { return url && url.indexOf('/') === 0 ? 'https://shopee.sg' + url : url; }"
      },
      {
        "name": "shop_response_speed",
        "selector": "#sll2-pdp-product-shop .NGzCXN > :nth-child(5) .Cs6w3G",
        "type": "text",
        "function": ""
      },
      {
        "name": "shop_follower_count",
        "selector": "#sll2-pdp-product-shop .NGzCXN > :nth-child(6) .Cs6w3G",
        "type": "text",
        "function": ""
      },
      {
        "name": "product_id",
        "selector": ".detail-info > .detail-info-list:nth-child(1) > .detail-info-item:nth-child(1) .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "seller_name",
        "selector": ".detail-info > .detail-info-list:nth-child(1) > .detail-info-item:nth-child(2) .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "seller_source",
        "selector": ".detail-info > .detail-info-list:nth-child(1) > .detail-info-item:nth-child(2) .sellerSourceTips",
        "type": "text",
        "function": ""
      },
      {
        "name": "brand_name",
        "selector": ".detail-info > .detail-info-list:nth-child(1) > .detail-info-item:nth-child(3) .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "category",
        "selector": ".detail-info > .detail-info-list:nth-child(2) > .detail-info-item:nth-child(1) .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "category_sales_rank",
        "selector": ".detail-info > .detail-info-list:nth-child(2) > .detail-info-item:nth-child(1) .tem-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "listing_date",
        "selector": ".detail-info > .detail-info-list:nth-child(2) > .detail-info-item:nth-child(2) .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "sales_1d_7d",
        "selector": ".detail-info > .detail-info-list:nth-child(4) > .detail-info-item:nth-child(1) .detail-info-item-main, .detail-info > .detail-info-list:nth-child(4) > .detail-info-item:nth-child(1) .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "sales_growth_30d",
        "selector": ".detail-info > .detail-info-list:nth-child(4) > .detail-info-item:nth-child(2) .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "sales_30d",
        "selector": ".detail-info > .detail-info-list:nth-child(5) > .detail-info-item.itemTwo.en_detail-info-item.en_MaxWidth .detail-info-item-main, .detail-info > .detail-info-list:nth-child(5) > .detail-info-item.itemTwo.en_detail-info-item.en_MaxWidth .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "gmv_30d",
        "selector": ".detail-info > .detail-info-list:nth-child(5) > .detail-info-item.MaxWidth.en_detail-info-item.en_MaxWidth .detail-info-item-main, .detail-info > .detail-info-list:nth-child(5) > .detail-info-item.MaxWidth.en_detail-info-item.en_MaxWidth .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "total_sales",
        "selector": ".detail-info > .detail-info-list:nth-child(6) > .detail-info-item.itemTwo.en_detail-info-item.en_MaxWidth .detail-info-item-main, .detail-info > .detail-info-list:nth-child(6) > .detail-info-item.itemTwo.en_detail-info-item.en_MaxWidth .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "total_gmv",
        "selector": ".detail-info > .detail-info-list:nth-child(6) > .detail-info-item.MaxWidth.en_detail-info-item.en_MaxWidth .detail-info-item-main, .detail-info > .detail-info-list:nth-child(6) > .detail-info-item.MaxWidth.en_detail-info-item.en_MaxWidth .item-main",
        "type": "text",
        "function": ""
      },
      {
        "name": "stock",
        "selector": ".detail-info > .detail-info-list:nth-child(7) > .detail-info-item.MaxWidth.en_detail-info-item.en_MaxWidth .detail-info-item-main, .detail-info > .detail-info-list:nth-child(7) > .detail-info-item.MaxWidth.en_detail-info-item.en_MaxWidth .item-main",
        "type": "text",
        "function": ""
      }
    ],
    "pattern_url": "https://shopee\\.sg/.*-i\\.\\d+\\.\\d+",
    "unique_key": [
      "product_id"
    ]
  },
  "action_template": {
    "action_code": actionCode
  },
  "pattern_url": "https://shopee\\.sg/.*-i\\.\\d+\\.\\d+",
  "scope": "private",
  "selector_type": "CSS",
  "status": "active",
  "tags": [],
  "unique_key": [
    "product_id"
  ],
  "url": "https://shopee.sg/Jeep-EW121-True-Wireless-Bluetooth-5.4-Earbuds-Touch-Control-Noise-Reduction-Earphones-For-Android-Iphone-i.1058254930.25483790400",
  "user_id": "6825c07a606c04a8bf5dc6e4",
  "score": 50,
  "mcp_tool_name": null
}

export default extractProductDetailFromShopee;
