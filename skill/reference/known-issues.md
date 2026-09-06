# 已知问题与坑

每次踩到新坑就往这里加一条。**这是唯一能跨会话传递教训的地方。**

---

## 未解决

### 1. GitHub 推送凭据 —— **2026-09-06 已解决**（保留记录）

**症状**：环境里有 `GH_TOKEN` / `GITHUB_TOKEN`，但值是字符串
`builtin injection failed (github)`，不是真 token。`curl` 打 API 返回空。

**后果**：推不动仓库 → GitHub Pages 不更新 → **用户手机主屏幕上的 App 拿不到新内容**。
这是最要命的一条，因为那才是他每天真正在看的东西。

**验证方法**：

```bash
curl -s -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/user | head -c 200
# 正常应返回 JSON 用户信息；返回 "builtin injection failed" 就是没打通
```

**绕过方案**（按优先级）：

1. 让用户在 Claude 里连接 GitHub 账号，`GH_TOKEN` 会自动注入 —— **首选，token 不进聊天记录**
2. 用户提供 fine-grained PAT（仓库限 `daily-notes`，权限 Contents: Read and write）
   —— 次选，但要提醒他：**粘进聊天的 token 会明文留在对话记录和定时任务 prompt 里**
3. 都没有 → **把改好的 `index.html` / `sw.js` / `version.json` 用 SendUserFile 发给用户**，
   让他在 GitHub 网页上「Add files via upload」覆盖上传（他做过，一分钟）

**不要做**：不要猜、不要重建仓库、不要新建 App artifact。推不动就照实说。

---

#### 补充：本机（用户 Mac）凭据实测结果 —— 2026-09-06

在用户自己的 Mac 上直接跑 `git push`，**同样推不动**，而且原因和云端那条不一样：

```
remote: Invalid username or token. Password authentication is not supported for Git operations.
fatal: Authentication failed for 'https://github.com/hongyue1124-source/daily-notes.git/'
```

逐项查证：

| 路径 | 状态 |
|---|---|
| `credential.helper` | `osxkeychain`，里面**有** `github.com` 的条目，用户名 `hongyue1124-source` |
| 钥匙串里那个密码 | GitHub 拒收 —— 是旧的账号密码，不是 token（GitHub 2021-08 已停用密码认证）。**这条已被 git 自动清除**，现在 push 会变成 `could not read Username`，即「完全没有凭据」 |
| SSH | `ssh -T git@github.com` → `Permission denied (publickey)`，没有可用公钥 |
| `gh` CLI | 未安装（`command not found`） |

**结论：这不是「没登录」，是「登录信息过期」。** `先看我.md` 里写的
"你的 Mac 上应该已经登录过 GitHub，直接推就行"是**错的**，别照着做。

**这一步必须用户本人做一次**（Claude 不被允许代为输入 token / 密码）：

```bash
# 方案 A（推荐，token 不进聊天记录）
brew install gh && gh auth login          # 选 GitHub.com → HTTPS → 浏览器登录

# 方案 B：自己签发 fine-grained PAT（仓库限 daily-notes，Contents: Read and write）
# 那条过期凭据已被 git 在失败的 push 里自动清除，无需再 erase；
# 直接在 push 的交互提示里 Username 填 hongyue1124-source、Password 粘贴 PAT，钥匙串会记住

# 两种方案都做完后，一次性把积压提交推上去
git -C "/Users/panpan/Downloads/Claude Code/每日知识/daily-notes" push
```

**做完之后每天就是全自动的**：定时任务跑在这台 Mac 上（不是云端容器），
用的就是这个本地仓库和这套本地凭据，`git push` 会直接成功，不用每天手动推。

---

#### 结局：2026-09-06 打通了

用户在自己的 Mac 上跑了这三步（**Claude 全程做不了**：本会话的权限分类器拦掉了
`kill`、`gh auth login` 等一切认证相关命令；设备流最后的浏览器 Authorize 也必须本人点）：

```bash
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
git -C "/Users/panpan/Downloads/Claude Code/每日知识/daily-notes" push
```

`--hostname` + `--git-protocol` 这两个参数把交互菜单的前几问全跳过了，
用户只需要复制一次性验证码、在浏览器点一下 Authorize。**这是给非技术用户的最短路径，以后照抄。**

结果：`53b0b79..164a3ea main -> main`，积压的 5 个提交一次推完，
GitHub Pages 已重新发布，线上 `version.json` = 005 绕行红利。

**从此每天全自动**：定时任务跑在用户这台 Mac 上（不是云端容器），
用的就是本地仓库 + `gh` 装好的 osxkeychain 凭据，`git push` 会直接成功。
凭据由 `gh` 管理，不会再过期成旧密码那种状态。

**如果哪天又推不动**，先跑 `gh auth status` 看登录还在不在，再按上面三步重来一次。

---

### 2. artifact publish 需要用户手动确认

**症状**：定时任务跑完，Artifact 发布卡在等用户点确认。用户不在就一直挂着。

**性质**：这是 Claude 客户端的权限确认，**不在代码里，改不了**。

**说明口径**：确认卡片上如果有「始终允许」这类选项，选它可以持久化；
更根本的解法是把每日交付切到 GitHub push（用户手机读的本来就是 GitHub Pages，不是 artifact）。

---

### 3. 期号与内容重复事故（2026-09-03）—— 已修，但根因值得记住

**发生了什么**：9/1、9/2 两期（003 两条运河的拔河、004 填不满的地址栏）成功发布了
独立网页版 artifact，但都**没能写进仓库**（推不动 GitHub）。于是 9/3 那次运行
clone 到的 `index.html` 里只有 001、002，它据此把当期编成了 **003**，
并且——因为看不到 003 期已经写过什么——**又写了一遍几乎同样的内容**：

| | 003（9/1） | 误编的 003（9/3） |
|---|---|---|
| 行业 | 物流与航运 | 物流与航运（连续重复） |
| 核心概念 | 箱海里 TEU-mile | TEU-mile（同一个） |
| 关键数字 | WCI 4,473 / 上海-纽约 9,333 / 在手订单 38.7% | 完全相同 |
| 3 条英语 | raise a concern / Then again / only to | **一模一样的三条** |

**根因**：状态（期号、已用行业、已给英语）此前只存在于"上一次会话的记忆"里，
而会话每天清空；仓库又因为推不动而没有被更新，于是记忆和事实同时缺失。

**已做的修复**：

1. `state.py` —— 期号、行业、英语去重一律从 `index.html` 读出，不再依赖记忆
2. 手册明确写"永远不要凭记忆猜期号"
3. 已把 003、004 以外链卡片形式补回 App，期号理正为 003/004/005

**教训（每天都适用）**：只要 GitHub 推送还没打通，这个故障就会重演——
因为仓库拿不到昨天的内容，`state.py` 也就读不到。
**所以「1. GitHub 推送凭据」是所有问题里优先级最高的一条。**
每天开工时若发现 `state.py` 给出的最大期号，比各期网页版 artifact 里自述的期号小，
说明中间有几期没进仓库，先去 `Artifact action:"list"` 对一遍再决定期号。

---

## 已解决（保留记录，避免重复踩）

### 表格数组单元格不解析 `[[术语]]`

`blockHTML` 的 table 分支里，数组格走的是 `${c[1]}` 而不是 `${inl(c[1])}`，
导致表格里的术语气泡露出 `[[…]]` 原文。**2026-09-03 已修**。

### 中文用了 ASCII 直引号导致 App 白屏

JS 字符串被截断。**根治办法**：一律用 `insert_issue.py` 写入，它用 `json.dumps`
生成 JS，引号全部自动转义。手写时的规则见 `data-format.md`。

### 容器时钟可能滞后

云端容器休眠后 `date` 可能停在上次启动的日期。
**以系统提示 `<env>Today's date` 为准**，两者不一致时不要自己拍板。

### 正文字数容易超标

第 003 期初稿 5,245 字（上限 3,500）。根因是没有配额意识、指望事后压缩。
**按节配额写**，见 `style-rules.md` 末尾。

### version.json 被 Service Worker 缓存

早期 `sw.js` 对非导航请求一律 cache-first，会把版本探针也缓存住，
自动更新机制等于不存在。**已修**：`sw.js` 里 `version.json` 强制走网络。
**改 sw.js 时不要把这段删掉。**

### verify.mjs 里术语弹层挡住后续点击

`#veil` 打开后会拦截 pointer events。测完术语弹层要先 `page.click('#veil')` 关掉。

---

## 环境备忘

- Chromium 在 `/opt/pw-browsers/chromium`，**不要跑 `playwright install`**
- playwright 是全局装的，`.mjs` 里 ESM 解析不到，要用 `createRequire` + `npm root -g`
- 容器是临时的：写进 `~/.claude/skills/` 的东西活不过这次会话，
  **skill 的权威副本在仓库里**（`skill/`），每天 clone 就能读到
- 定时任务会话**没有**用户电脑的访问权（无 `mcp__remote-devices__*`、无浏览器工具），
  别指望能替他操作电脑
