# 贡献指南

详细贡献指南请参考 [英文版本](/developer/contributing)。

## 快速开始

```bash
git clone git@github.com:<your-username>/opencli.git
cd opencli
npm install
npm run build
npx tsc --noEmit
npx vitest run src/
```

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat(twitter): add thread command
fix(browser): handle CDP timeout gracefully
docs: update CONTRIBUTING.md
```
