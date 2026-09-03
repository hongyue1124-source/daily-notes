# 每日行业笔记

一个每天更新的个人阅读 App：一期产业笔记 + 3 条英语口语。
由每天早上 8 点（新加坡时间）运行的定时任务自动写入。

**线上地址**：https://hongyue1124-source.github.io/daily-notes/
用 Safari 打开 → 分享 → 添加到主屏幕，之后全屏运行、有独立图标、可离线。

---

## 给每天跑这个任务的 Claude

聊天记录每天清空，**所有操作说明都在 [`skill/SKILL.md`](skill/SKILL.md) 里**。

```bash
git clone https://github.com/hongyue1124-source/daily-notes.git && cd daily-notes
cat skill/SKILL.md              # 操作手册
python3 skill/scripts/state.py  # 先取状态：本期期号、避开哪些行业、哪些英语给过了
```

**不要凭记忆猜期号或已用行业**——仓库是唯一事实来源。

---

## 文件

| 路径 | 是什么 |
|---|---|
| `index.html` | 整个 App。内容以 `ISSUES` / `ENGLISH` 两个数组内嵌在页面里 |
| `sw.js` | Service Worker，负责离线；`BUILD` 每次更新要改成当天日期 |
| `version.json` | 版本探针。手机 App 靠它发现新一期，**不能被缓存** |
| `manifest.webmanifest`、`icons/` | 装到主屏幕用的清单和图标 |
| `skill/SKILL.md` | 操作手册（权威） |
| `skill/reference/` | 数据格式、写作细则、网页版视觉规格、已知问题 |
| `skill/scripts/` | 状态、插入、字数、验证四个脚本 |

## 每天的流程

```bash
python3 skill/scripts/state.py          # 1. 取状态
                                        # 2. 调研 + 写作 + 发布网页版 artifact
python3 skill/scripts/wordcount.py p.json   # 3. 核字数（2500–3500）
python3 skill/scripts/insert_issue.py p.json # 4. 校验 + 插入 + 改 BUILD + node --check
node skill/scripts/verify.mjs           # 5. 390x844 手机视口验证
git add -A && git commit -m "第 0NN 期：…" && git push
                                        # 6. PushNotification 推送全文
```

## 手机端怎么自动更新

`index.html` 内嵌 `BUILD` 常量，在**启动 / 从后台切回前台 / bfcache 恢复 / 每 30 分钟**
四个时机去读 `version.json`。发现 `build` 不一致：

- 没在读文章 → 清缓存后静默刷新
- 正在读文章 → 顶部弹一条「有新一期 · 点这里更新」，不打断阅读

同一版本每次会话只自动刷新一次，避免 CDN 延迟造成反复重载。
「我的」页有手动的「检查更新」入口。
