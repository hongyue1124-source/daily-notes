/* 发布前的手机视口验证。用法：
 *     node skill/scripts/verify.mjs
 *
 * 起一个本地 HTTP 服务（Service Worker 必须 http/localhost，file:// 不行），
 * 用 390x844 打开，检查最新一期渲染是否正常、自动更新机制是否还工作。
 * 任何一项 FAIL 就不要发布。
 *
 * Chromium 在 /opt/pw-browsers/chromium，不要跑 playwright install。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/* playwright 通常是全局装的，ESM 从仓库目录解析不到，用 CommonJS 解析绕开。
   两个运行环境要都能跑：
     · 云端容器 —— playwright 全局装，浏览器在 /opt/pw-browsers/chromium
     · 用户的 Mac —— 没有全局 playwright（npm 走的代理还是死的），但 npx 缓存里有一份，
                     浏览器用系统装的 Google Chrome
   所以模块和浏览器都按候选列表逐个试，全找不到才装，装不上才退出。 */
const require_ = createRequire(import.meta.url);

const moduleCandidates = () => {
  const out = [];
  try { out.push(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch {}
  out.push('playwright');
  try {
    const npx = path.join(process.env.HOME || '', '.npm/_npx');
    for (const d of fs.readdirSync(npx)) {
      const p = path.join(npx, d, 'node_modules/playwright');
      if (fs.existsSync(p)) out.push(p);
    }
  } catch {}
  return out;
};

let chromium;
for (const attempt of [0, 1]) {
  for (const m of moduleCandidates()) {
    try { chromium = require_(m).chromium; break; } catch {}
  }
  if (chromium) break;
  if (attempt) { console.error('✗ 装不上 playwright，跳过手机视口验证'); process.exit(1); }
  console.log('安装 playwright…');
  try {
    execSync('PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install -g playwright', { stdio: 'inherit' });
  } catch {
    console.error('✗ npm install 失败（本机 npm 代理不通？），也没找到任何一份 playwright');
    process.exit(1);
  }
}

/* 浏览器可执行文件：容器路径 → Mac 上的 Chrome → 交给 playwright 自己找 */
const BROWSER = [
  '/opt/pw-browsers/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find(p => fs.existsSync(p));
const LAUNCH = BROWSER ? { executablePath: BROWSER } : {};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); return res.end('404');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream',
                       'Cache-Control': 'no-cache' });
  res.end(fs.readFileSync(f));
});

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? '  ' + extra : ''}`);
};

/* 端口交给系统分配：写死端口会被本机其他服务占掉，整个校验直接崩在这一行 */
await new Promise(r => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) errs.push('CONSOLE: ' + m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(2500);

const meta = await page.evaluate(() => ({
  build: BUILD,
  ids: ISSUES.map(i => i.id),
  top: ISSUES[0],
  engDates: ENGLISH.map(d => d.date),
  engCount: ENGLISH[0].items.length,
  psychIds: typeof PSYCH === 'undefined' ? [] : PSYCH.map(p => p.id),
  psychTop: typeof PSYCH === 'undefined' ? null : (PSYCH[0] || null),
}));
const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
/* BUILD 跟的是「最新内容」的日期——产业长文和心理学实验各自更新，取两者里更晚的那个 */
const newest = [meta.top.date, meta.psychTop && meta.psychTop.date].filter(Boolean).sort().pop();

console.log(`\n【最新一期】${meta.top.id} · ${meta.top.date} · ${meta.top.sector} · ${meta.top.title}`);
console.log(`【全部期号】${meta.ids.join(', ')}`);
console.log(meta.psychTop
  ? `【最新实验】${meta.psychTop.id} · ${meta.psychTop.date} · ${meta.psychTop.field} · ${meta.psychTop.name}（${meta.psychTop.en}）\n`
  : '【最新实验】（还没有条目）\n');

console.log('数据一致性');
check('BUILD 与最新内容日期一致', meta.build === newest, `${meta.build} / ${newest}`);
check('version.json 与最新内容一致', ver.build === newest && ver.issue === meta.top.id, JSON.stringify(ver));
check('英语日期与当期一致', meta.engDates[0] === meta.top.date, meta.engDates[0]);
check('今日英语 3 条', meta.engCount === 3);
check('往期都在（未丢失历史）', meta.ids.length >= 3, meta.ids.length + ' 期');
check('当期 web 链接非空', !!meta.top.web && meta.top.web.startsWith('http'));

console.log('\n今日页 / 英语页');
check('今日标题正确', (await page.textContent('#todayBody h2')).trim() === meta.top.title);
await page.click('[data-go="english"]'); await page.waitForTimeout(400);
const types = await page.$$eval('#engBody .etype', n => n.map(x => x.textContent));
check('英语卡片渲染 3 张', types.length === 3, types.join(' / '));
check('含固定搭配条目', types.some(t => t.includes('搭配')));

console.log('\n阅读器');
await page.click('[data-go="today"]'); await page.waitForTimeout(300);
await page.click(`[data-open="${meta.top.id}"]`); await page.waitForTimeout(700);
const r = await page.evaluate(() => ({
  q: document.querySelectorAll('#rBody .secq').length,
  sec: document.querySelectorAll('#rBody .sec').length,
  flow: document.querySelectorAll('#rBody .flowline').length,
  chain: document.querySelectorAll('#rBody .chain li').length,
  tbl: document.querySelectorAll('#rBody .tbl table').length,
  risk: document.querySelectorAll('#rBody .risk').length,
  tkw: document.querySelectorAll('#rBody .tkw').length,
  watch: document.querySelectorAll('#rBody .watch').length,
  terms: [...new Set([...document.querySelectorAll('#rBody .term')].map(x => x.dataset.term))],
  raw: document.getElementById('rBody').textContent.includes('[['),
}));
check('六节全部渲染', r.sec === 7, `${r.sec} 个 section（六节 + 术语表）`);
check('每节都有「本节回答」', r.q === 6, r.q + ' 个');
check('有风险提示框', r.risk >= 1);
check('有 takeaway 卡片', r.tkw >= 1);
check('有 watch 指标', r.watch >= 3);
check('术语气泡可点', r.terms.length >= 3, r.terms.join('、'));
check('没有残留未渲染的 [[', !r.raw);
await page.click('#rBody .term'); await page.waitForTimeout(400);
check('术语弹层能打开', !!(await page.textContent('#sheet .zh')));
await page.click('#veil'); await page.waitForTimeout(350);   // 关掉弹层，否则挡住下面的点击
await page.click('#rClose'); await page.waitForTimeout(400);

console.log('\n底部导航');
const tabs = await page.$$eval('.tabs .tab', ns => ns.map(n => ({
  go: n.dataset.go, txt: n.textContent.trim(),
  w: n.getBoundingClientRect().width, h: n.getBoundingClientRect().height,
  /* 文字节点单独量：换行了 scrollWidth 会小于文字的真实排版宽度、高度会顶起来 */
  over: n.scrollWidth > Math.ceil(n.clientWidth) + 1,
})));
check('6 个 tab 都在', tabs.length === 6, tabs.map(t => t.go).join(' / '));
check('tab 文字没有换行或溢出（390px）',
  tabs.every(t => !t.over && t.h <= 62), tabs.map(t => `${t.txt}:${t.w.toFixed(0)}x${t.h.toFixed(0)}`).join(' '));

console.log('\n心理页');
await page.click('[data-go="psych"]'); await page.waitForTimeout(450);
check('心理 tab 能点开', await page.evaluate(() => document.getElementById('s-psych').classList.contains('on')));
if (meta.psychTop) {
  check('今日实验标题正确', (await page.textContent('#psyBody h2')).trim() === meta.psychTop.name,
    meta.psychTop.name);
  check('历史条目折叠成行', (await page.$$('#psyBody .row')).length === meta.psychIds.length,
    meta.psychIds.length + ' 条');
  await page.click(`[data-openpsych="${meta.psychTop.id}"]`); await page.waitForTimeout(700);
  const p = await page.evaluate(() => ({
    sec: document.querySelectorAll('#rBody .sec').length,
    q: document.querySelectorAll('#rBody .secq').length,
    chain: document.querySelectorAll('#rBody .chain li').length,
    tbl: document.querySelectorAll('#rBody .tbl table').length,
    risk: document.querySelectorAll('#rBody .risk').length,
    tkw: document.querySelectorAll('#rBody .tkw').length,
    watch: document.querySelectorAll('#rBody .watch').length,
    gitem: document.querySelectorAll('#rBody .gitem').length,
    src: document.querySelectorAll('#rBody .srcs a').length,
    meta: document.querySelector('#rBody .rhead .bmeta') ? document.querySelector('#rBody .rhead .bmeta').textContent : '',
    terms: [...new Set([...document.querySelectorAll('#rBody .term')].map(x => x.dataset.term))],
    raw: document.getElementById('rBody').textContent.includes('[['),
  }));
  check('六节全部渲染', p.sec === 7, `${p.sec} 个 section（六节 + 术语表）`);
  check('每节都有「本节回答」', p.q === 6, p.q + ' 个');
  check('§4 有反直觉四步 chain', p.chain >= 4, p.chain + ' 步');
  check('§3 有数据表', p.tbl >= 1);
  check('§4 有方法论局限框', p.risk >= 1);
  check('§6 有 takeaway + 三条 watch', p.tkw >= 1 && p.watch >= 3, `${p.tkw} / ${p.watch}`);
  check('页眉带英文原名 / 研究者 / 年份 / 期刊',
    [meta.psychTop.en, meta.psychTop.who, meta.psychTop.year, meta.psychTop.journal]
      .every(x => p.meta.includes(x)), p.meta);
  check('术语表可收藏', p.gitem >= 4, p.gitem + ' 条');
  check('来源可点开', p.src >= 1, p.src + ' 项');
  check('没有残留未渲染的 [[', !p.raw);
  await page.click('#rBody .term'); await page.waitForTimeout(400);
  check('实验术语气泡能打开', !!(await page.textContent('#sheet .zh')));
  check('气泡来源写的是心理学实验',
    (await page.textContent('#sheet .from')).includes('心理学实验'),
    await page.textContent('#sheet .from'));
  await page.click('#veil'); await page.waitForTimeout(350);
  /* 进度条会走 + 读到底自动记进 S.readPsych（不能污染 S.read / S.readBook） */
  await page.evaluate(() => { const R = document.getElementById('reader'); R.scrollTop = R.scrollHeight; });
  await page.waitForTimeout(500);
  const st = await page.evaluate(id => {
    const s = JSON.parse(localStorage.getItem('dib.v1') || '{}');
    return { ps: !!(s.readPsych && s.readPsych[id] && s.readPsych[id].done),
             read: Object.keys(s.read || {}), book: Object.keys(s.readBook || {}) };
  }, meta.psychTop.id);
  check('读到底记进 S.readPsych', st.ps);
  check('没有串味到 S.read / S.readBook', !st.read.includes(meta.psychTop.id) && !st.book.length,
    `read=[${st.read}] readBook=[${st.book}]`);
  await page.click('#rClose'); await page.waitForTimeout(400);
}
await page.click('[data-go="today"]'); await page.waitForTimeout(300);

console.log('\n自动更新机制');
const VJ = path.join(ROOT, 'version.json');
const orig = fs.readFileSync(VJ, 'utf8');
let navs = 0; page.on('framenavigated', f => { if (f === page.mainFrame()) navs++; });
fs.writeFileSync(VJ, JSON.stringify({ build: '2099-01-01', issue: '999', title: 'x' }));
const before = navs;
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForTimeout(2500);
check('发现新版本会静默刷新', navs > before);
await page.waitForTimeout(1500);
check('版本仍不匹配时改为提示条', await page.evaluate(() => !document.getElementById('updbar').hidden));
const n2 = navs; await page.waitForTimeout(2000);
check('没有无限重载', navs === n2);
fs.writeFileSync(VJ, orig);

check('无 JS 报错', errs.length === 0, errs.join(' | '));

await browser.close();
server.close();

const bad = results.filter(x => !x.ok);
console.log(`\n${'='.repeat(46)}`);
if (bad.length) {
  console.log(`✗ ${bad.length} 项没过，修完再发布：`);
  bad.forEach(b => console.log('   · ' + b.name));
  process.exit(1);
}
console.log(`✓ 全部 ${results.length} 项通过，可以发布`);
