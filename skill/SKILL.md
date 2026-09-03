---
name: daily-industry-note
description: 为用户 PPPP 生成每天一期的《每日行业笔记》（一篇中文产业长文 + 3 条英语表达），并发布到网页版 artifact、手机 App（GitHub Pages / claude.ai artifact），最后用 PushNotification 把当天全部内容推送出去。当被要求「写今天的行业笔记」「跑每日笔记」「daily industry note」，或由每日定时任务触发时使用。
---

# 每日行业笔记 · 操作手册

每天一期，两个产出：一篇 2500–3500 字的中文产业长文，外加 3 条英语表达。
读者是 **PPPP**：新加坡 NTU 大三在读，母语中文，时区 Asia/Singapore。

> **这份文档是唯一权威。** 聊天记录每天清空，不要依赖任何"我记得昨天……"。
> 所有状态（期号、日期、已用行业、已给过的英语）都从仓库里**读出来**，不要凭记忆。

---

## 0. 开工前：先取状态（不可跳过）

```bash
git clone https://github.com/hongyue1124-source/daily-notes.git
cd daily-notes
```

然后**从 `index.html` 里读出**下面四件事。跑一次脚本就行：

```bash
python3 skill/scripts/state.py          # 打印期号、日期、已用行业、已给过的英语
```

它会告诉你：

| 要素 | 怎么定 |
|---|---|
| **本期期号** | `已有 id 的最大值 + 1`，补零成三位（`003`、`004`…）。**永远不要凭记忆猜期号。** |
| **本期日期** | 今天的新加坡日期，`YYYY-MM-DD` |
| **行业轮换** | 脚本会列出已用过的 sector，**不要和最近两期重复** |
| **英语去重** | 脚本会列出所有已给过的 `en` 字段，**新的三条不得与之重复** |

### 日期怎么取（有坑）

```bash
TZ=Asia/Singapore date +%F
```

**但是**：这个会话跑在云端容器里，容器休眠后时钟可能滞后。
如果 `date` 的结果和系统提示 `<env>Today's date` 不一致，**以系统提示为准**。
两个都拿不准时，宁可问用户，也不要写错日期——日期错了整期都要返工。

### 期号和日期不必一一对应

历史上有跳过的日子（001=8/29，002=8/30，003=9/3）。
**期号只管连续递增，日期只管写今天**，两者不需要能对上。

---

## 1. 写作清晰度 · 最高优先级

用户明确抱怨过一个真实的毛病，这是本任务最容易出错的地方：

> **把两个事实用"但/然而"并列，却不写出中间的推理，读者看不出它们为什么矛盾。**

反面例子（第 002 期真实犯过的错）：

> ✗「锂价涨了 87%，但中国的电动车少卖了 13%。」
> 读者会理解成"因为锂涨价 → 车变贵 → 所以卖得少"，那是**因果**关系，意思正好反了。

正确写法（把链条补全）：

> ✓「电动车是锂最大的用途。上半年中国电动车少卖了 13%——最大的买家在收缩，照常理锂价该跌。可过去 12 个月锂价反倒涨了 87%。这就是本期要解释的反常：车卖少了，那是谁在买锂？」

### 七条硬性规则

1. **凡是提出"反常/矛盾/意外"，四步必须写全**：① 事实 A ② 按常理该推出什么 ③ 实际却是 C ④ 所以问题是"为什么"。缺任何一步都不合格。用 `chain` 块把四步显式列出来。
2. **连接词必须准确反映真实逻辑**。"但 / 然而 / 却 / 反而"只能用于"与前文**已经明确写出**的预期相反"。成稿后逐个检查每个转折词：它转折的是哪个预期？那个预期我在前面写出来了吗？没写就改。
3. **推理链超过两步时显式写出**，用 `flow` 块（箭头）或分点。
4. **每节开头点明本节要回答什么问题**（写进 section 的 `q` 字段），结尾给出答案。`q` 不能省。
5. **数字后面紧跟一句"这意味着什么"**，或它和上一个数字的关系。不要让数字裸奔。
6. **先给背景再给结论**，不在读者还没有前提时抛判断。
7. **难度不要降低**。用户水平足够，要提高的是逻辑的显性程度和讲解的清晰度，不是把内容变浅。

细节和更多正反例见 `reference/style-rules.md`。

---

## 2. 任务 A：产业笔记

### 选题

用 WebSearch / WebFetch 找**最近 7 天内真实发生**的一条重要产业新闻。

- **行业要轮换**，不要连续两天同一行业（已用清单由 `state.py` 给出）。
  可选范围：AI/半导体、能源与电力、生物科技与制药、航空航天与国防、金融科技与支付、汽车与电池、消费与零售、材料与制造、农业与食品、医疗服务、物流与航运、房地产与基建。
- **视角偏商业与投资**：产业格局、商业模式、钱从哪来到哪去、谁在赚钱、谁承担风险。不要写成纯技术科普。
- **必须核实关键数字和日期**，全部来自可引用的公开来源。
- **区分"已确认的事实"和"你的解读"**：作者推断处必须加 `<span class="flag">我的解读</span>`（或 我的粗算 / 我的换算）。

### 结构（六节，固定）

| 节 | tag | 要干什么 |
|---|---|---|
| §1 | 问题 | 建立最基础的直觉，为什么这件事所在的领域值得关心 |
| §2 | 缺口/背景 | 讲清楚矛盾或约束条件 |
| §3 | 本周事件 | 这周到底发生了什么、机制怎么运作；**本期的"反常四步"通常放这里**；必须配一个 `risk` 块（"但请注意"） |
| §4 | 另一条腿 | 牵连的第二个维度（供应链、监管、地缘、成本转嫁等） |
| §5 | 历史 | 一个真实的历史类比，**同时诚实写出"相似之处"和"不同之处"**，不下断言 |
| §6 | 拿走 | 一个 `takeaway` 块（能跟人聊的一句话）+ 一个 `watch` 块（三个可观察指标） |

外加：本期术语表 6–8 个词（中文 + 英文 + 一句话解释）、明日预告。

### 字数

**六节正文 2500–3500 字**（只数汉字）。写完用脚本核：

```bash
python3 skill/scripts/wordcount.py <你的html或json>
```

历史教训：第 003 期初稿 5,245 字，压了三轮才到 3,960，仍然超标。
**建议一开始就按每节配额写**：§1 450 / §2 550 / §3 900 / §4 650 / §5 600 / §6 350。

---

## 3. 任务 B：每天 3 条英语

### 水平线（唯一合格标准）

用户两年前雅思 7.5（听 8 / 说 6.5 / 读 8.5 / 写 6.5），已在全英文环境生活学习多年。
**被动词汇量很大，一眼就懂的东西对他毫无价值。**

> 合格线只有一条：**他看到会想"这个我听得懂，但我自己从来不会说 / 我会说但说得不地道"。**

### 禁止再出的简单档

`I mean` / `you know` / `kind of` / `sort of` / `actually` / `basically` / `by the way` /
`no worries` / `catch up` / `fair enough` / `to be honest` / `that makes sense` / `on the other hand`

### 3 条里至少 1 条必须是「固定搭配」（collocation）

这是他点名要的：意思他表达得出来，但词配错了，一听就是中式英语。
这类**必须写清三样**：母语者的固定说法、中国学生会用的那个错误搭配、为什么错的那个不自然。

方向参考：

- **学业**：sit / take an exam（不是 join）、take a module（不是 learn）、hand in / submit（不是 give）、**meet** a deadline（不是 finish/catch）、pull an all-nighter、cram for、fall behind on、be swamped with
- **讨论**：**raise** a concern（不是 propose）、**make** a case for、**draw** a distinction、bring up、touch on、flesh out、hash out
- **状态**：**under** a lot of pressure、**run** late、be **on top of** things、lose track of、a fair bit of、nowhere near
- **典型错配**：make an experiment ×（do/run）、open the light ×（turn on）、very like ×（really like）、say the truth ×（tell）、learn knowledge ×（gain）、improve my English level ×（improve my English）

### 另外两条从这几类选

话语标记与逻辑反转（that said / for what it's worth / granted）；精确化与分裂句（What gets me is… / The thing with X is…）；校准过的分歧与让步（I'll give you that, but… / I wouldn't go that far / I'm not sold on…）；英式与新加坡校园口语（faff about / give it a miss / be knackered）；中国学生不产出的语法（only to + 动词 / 口语里的 would have + 过去分词 / 倒装强调）。

### 每条必须带连读弱读吞音提示

直接服务听力。写进 `say` 字段，用 `<code>…</code>` 包住音块。

### 去重

`state.py` 会列出所有已给过的 `en`。**新的三条不得与之重复。**

---

## 4. 数据格式

完整 schema、块类型、语法禁忌 → **`reference/data-format.md`（写数据前必读）**

最容易踩的两个坑，这里先警告：

1. **中文引号一律用全角 “ ” ‘ ’ 或 「 」，绝不能用 ASCII 直引号 `"`**，否则 JS 字符串断裂、App 白屏。
   英文撇号用 ASCII `'`（it's、I've）。HTML 属性（`class="flag"`）保持 ASCII 引号。
2. **`ISSUES` 用单引号 JS 字符串**（内含 `class="flag"` 这类属性）；
   **`ENGLISH` 用双引号 JS 字符串**（内含 `don't` 这类撇号）。写反了就报错。

---

## 5. 发布

### 第一步：网页版 artifact（必做，这一步一定成功）

用 Artifact 工具发布成**新** artifact（不覆盖旧期）。视觉规格 → `reference/web-template.md`。

要点：深墨绿 `#1E5D4B` 为强调色的报纸/金融文档风格，Newsreader + IBM Plex Mono 字体，
左侧 § 编号栏 + 主栏 + 右侧术语边注的三栏网格，数字表格、风险提示框、takeaway 卡片、术语表、来源列表。
标题用当期主题的**短名词短语**，favicon `📓`。

**把返回的 URL 记下来**，它要填进当期数据的 `web` 字段。

### 第二步：写进 App

App 有两个副本，**两个都要更新**：

| 副本 | 地址 | 怎么更新 |
|---|---|---|
| **GitHub Pages**（用户手机主屏幕装的就是这个，**优先级最高**） | https://hongyue1124-source.github.io/daily-notes/ | 改仓库文件后 `git push` |
| claude.ai artifact | https://claude.ai/code/artifact/82981c0d-d783-42fb-b5c7-f8406aa13f8b | Artifact 工具带 `url` 参数原地发布 |

**更新仓库的标准做法**（不要手改，用脚本）：

```bash
# 1. 把当期内容写成 JSON（格式见 reference/data-format.md）
#    payload.json = { "issue": {...}, "english": {...} }

# 2. 插入 + 更新 BUILD + 写 version.json + 语法校验，一步到位
python3 skill/scripts/insert_issue.py payload.json

# 3. 手机视口验证
node skill/scripts/verify.mjs

# 4. 提交推送
git add -A && git commit -m "第 0NN 期：<标题>（<行业>）" && git push
```

`insert_issue.py` 会自己做这些事，失败会大声报错而不是默默写坏：
把新一期插到 `ISSUES` 最前、新英语插到 `ENGLISH` 最前、把 `sw.js` 和 `index.html` 里的 `BUILD` 改成今天、重写 `version.json`、抽出 `<script>` 跑 `node --check`。

**claude.ai artifact 那份**：先 `action:"read"` 读到当前版本（必须把返回文件**整个读完**才允许发布），
把同样的两段数据插进去，再带 `url` 参数发布。

### 如果推不动 GitHub

见 `reference/known-issues.md` 的「GitHub 凭据」一节。
**推不动就跳过这一步，不要猜、不要重建、不要新建 App artifact**，在通知里说明原因，
并把当天两个数据对象的完整原文放进结果，方便用户手动补。

---

## 6. 校验（发布前）

```bash
python3 skill/scripts/insert_issue.py payload.json   # 内含 node --check
node skill/scripts/verify.mjs                        # 390x844 手机视口
```

`verify.mjs` 会自动检查并打印：期数、今日标题、英语条目、`q` 块数量、
`flow`/`chain`/表格数量、术语气泡、有没有残留未渲染的 `[[`、有没有 JS 报错。
**任何一项不对就修完再发。**

---

## 7. 推送 · 这是每天的主要交付

不管 App 有没有更新成功，用户都必须能**只看这条通知**就读到当天的东西。
用 `PushNotification`，全部内容放进 `<routine_summary>` 标签：

1. **第一句**（手机横幅）：当期标题 + 最核心的一个反差或数字，一句话说完。
2. **产业笔记摘要**：150 字以内，按"前提 → 常理该推出什么 → 实际却相反 → 原因是什么"的顺序写，不要只堆数字。
3. **今天 3 条英语的完整内容**，每条都要有：表达本身、一句话中文意思、一个例句、中式英语对照那一句。
   **这部分不要压缩**——邮件正文没有长度限制，用户很可能就靠这条通知学当天的英语。
4. **最后**：当期网页版链接；以及一行 App 状态（已更新 / 未更新及原因）。

---

## 8. 质量自查 · 不合格就改完再发

**写作**
- [ ] 每个转折词转折的预期，是否都在前文写出来了？
- [ ] 每个"反常"是否四步写全？
- [ ] 每节的 `q` 是否都写了、正文是否真的回答了它？
- [ ] 数字有没有裸奔（后面没跟"这意味着什么"）？

**产业笔记**
- [ ] 每个数字有来源？
- [ ] 每个专有名词第一次出现时解释过？有没有未加解释的英文缩写？
- [ ] §5 类比是否既讲了像、也讲了不像？
- [ ] 六节正文 2500–3500 字？（跑 `wordcount.py`）
- [ ] 作者推断处都加了 `<span class="flag">` ？

**英语**
- [ ] 三条是否都过了"听得懂但说不出/说不地道"这条线？
- [ ] 是否至少一条固定搭配，并**点名了错误搭配**？
- [ ] 是否都带连读提示？
- [ ] 有没有和已有条目重复？（跑 `state.py`）

**发布**
- [ ] `node --check` 过了？
- [ ] `verify.mjs` 全绿？
- [ ] 当期 `web` 字段填了真实 URL（不是空字符串）？
- [ ] `version.json` 和 `sw.js` 的 BUILD 都是今天？

**通知**
- [ ] 3 条英语是否都完整写进去了？只看通知能不能学？

---

## 9. 已知问题

→ **`reference/known-issues.md`**（每次遇到新坑就往里加）

现在挂着的：GitHub 推送凭据未打通、artifact publish 需要用户手动确认。
