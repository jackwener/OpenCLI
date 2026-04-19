# 99csw.com OpenCli 适配器设计文档

## 网站分析

### 网站特性
- **网站**: 九九藏书网 (99csw.com) - 在线电子书阅读平台
- **内容类型**: 文学作品、科普书籍、经典著作
- **访问方式**: 无需登录即可阅读

### URL 架构
```
- 书籍索引页: /book/{bookId}/index.htm
- 章节内容页: /book/{bookId}/{chapterId}.htm
- 搜索页: /book/search.php
```

### 页面结构分析

#### 1. 索引页面 (`/book/9210/index.htm`)
包含：
- 书籍基本信息（标题、作者、翻译者、封面）
- 书籍描述和标签
- 完整目录（所有章节链接）
- 书评和笔记

#### 2. 内容页面 (`/book/9210/328790.htm`)
包含：
- 当前章节标题
- 完整的章节文本内容
- 导航信息（前/后章节）

### 网络请求分析
- 页面内容是**服务端渲染（SSR）**的
- HTML 中直接包含内容，无额外 API 调用
- 不需要处理复杂的 JavaScript 加载

## 认证策略
- **策略**: `PUBLIC` (完全公开，无需认证)
- **浏览器**: 不需要（`browser: false`）
- **性能**: 快速，无需启动浏览器

## 适配器设计

### 命令规划
```
# 1. 获取书籍目录和元数据
opencli 99csw meta <book_id>

# 2. 获取单个章节内容
opencli 99csw content <book_id> <chapter_id>

# 3. 获取完整书籍内容
opencli 99csw full <book_id>

# 4. 列出书籍的所有章节
opencli 99csw list-chapters <book_id>
```

### 数据提取方法

#### 方法 1: DOM 解析 (使用 JavaScript 在浏览器中)
```javascript
// 提取目录
const chapters = Array.from(document.querySelectorAll('a[href*="/book/"]'))
  .filter(a => /\/book\/\d+\/\d+\.htm/.test(a.href))
  .map(a => ({
    title: a.textContent,
    id: a.href.split('/')[4].split('.')[0]
  }))
```

#### 方法 2: 正则表达式 (解析 HTML 字符串)
从 HTML 中使用正则表达式提取目录和内容

#### 方法 3: 混合方法
- 使用浏览器提取目录结构和目录
- 对内容页使用简单的 HTML 字符串解析

## 推荐实现

使用 **Tier 1 (PUBLIC) + 正则/正文提取** 方案：
1. 使用 `fetch` 获取 HTML
2. 用正则或简单字符串操作提取内容
3. 不需要浏览器，速度快，开销小

示例提取逻辑：
```typescript
// 获取HTML
const html = await fetch(url).then(r => r.text());

// 提取章节标题
const title = html.match(/<h\d[^>]*>([^<]+)<\/h\d>/)?.[1];

// 提取内容（在 <div class="content"> 或类似的容器中）
const content = html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
```

## 实现计划

- ✅ 分析网页结构
- [ ] 编写 TypeScript 适配器
  - [ ] 实现 `list-chapters` 命令
  - [ ] 实现 `content` 命令  
  - [ ] 实现 `full` 命令
- [ ] 本地测试
- [ ] 集成到项目

