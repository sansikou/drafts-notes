# Drafts iOS（Capacitor）

轻量 WebView 壳，功能与 Windows 版对齐，直连同一 Supabase。签名用你自己的全能签 + 个人 P12。

## 本机（Windows）可做的事

```bash
cd mobile
npm install
npm run build:web
```

浏览器打开 `www/index.html` 可先验证列表/编辑/同步。

`npx cap add ios` / `npm run sync` 生成 Xcode 工程（`ios/`）。**编译 IPA 必须在 Mac 或 GitHub macOS Runner 上。**

## 产出 IPA（给全能签）

### 方式 A：GitHub Actions（推荐）

1. 把仓库推到 GitHub  
2. Actions → **Build iOS IPA** → Run workflow  
3. 下载 artifact `Drafts-ios-unsigned.ipa`  
4. 全能签导入 → 选个人 P12 重签 → 安装

### 方式 B：自己的 Mac

```bash
cd mobile
npm install
bash scripts/build-ipa.sh
```

产物：`release/Drafts-ios-unsigned.ipa`

## 功能对照

- 新建 / 编辑 / 置顶 / 删除 / 回收站 30 天  
- H1–H4、加粗、斜体、引用、列表、待办  
- Markdown 源码切换  
- 搜索、多选删除  
- 本地缓存 + Supabase 同步（与桌面同一项目）  
- 复制纯文本单换行  

桌面专属（悬浮球 / 托盘）在 iOS 上改为：列表首页 + 编辑页返回。
