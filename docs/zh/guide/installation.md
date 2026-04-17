# 安装

## 系统要求

- **Node.js**: >= 21.0.0
- **Chrome** 已运行并登录目标网站（浏览器命令需要）

## 通过 npm 安装（推荐）

```bash
npm install -g @jackwener/opencli
```

## 从源码安装

```bash
git clone git@github.com:jackwener/opencli.git
cd opencli
npm install
npm run build
npm link
opencli list
```

## 更新

```bash
npm install -g @jackwener/opencli@latest
```

## 验证安装

```bash
opencli --version
opencli list
opencli doctor
```
