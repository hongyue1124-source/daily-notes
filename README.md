# 每日行业笔记

一个每天更新的个人阅读 App：一期产业笔记 + 3 条英语口语。
由一个每天早上 8 点（新加坡时间）运行的定时任务自动写入。

- `index.html` — 整个 App（内容以 `ISSUES` / `ENGLISH` 两个数组内嵌在页面里）
- `sw.js` — Service Worker，负责离线；每次更新内容要把 `BUILD` 改成当天日期
- `manifest.webmanifest` / `icons/` — 装到手机主屏幕用的清单和图标

## 装到 iPhone

用 Safari 打开 Pages 地址 → 分享 → 添加到主屏幕。
之后是全屏运行、有独立图标、可离线。

## 每天更新的方式

定时任务克隆本仓库 → 在 `index.html` 的 `ISSUES` 和 `ENGLISH` 数组最前面插入当天内容
→ 更新 `sw.js` 的 `BUILD` 日期 → `node --check` 校验 → 提交推送。
