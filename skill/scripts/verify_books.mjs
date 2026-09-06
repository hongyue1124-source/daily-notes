/* 一次性验收：「读书」页 + 两层阅读器 + 独立存储键。
   verify.mjs 只测最新一期，覆盖不到这次改动，所以另写这一份。
   顶部的 playwright / 浏览器候选列表照抄 verify.mjs。 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

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
for (const m of moduleCandidates()) { try { chromium = require_(m).chromium; break; } catch {} }
if (!chromium) { console.error('✗ 找不到 playwright'); process.exit(1); }
const BROWSER = ['/opt/pw-browsers/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'].find(p => fs.existsSync(p));
const LAUNCH = BROWSER ? { executablePath: BROWSER } : {};

const ROOT = '/Users/panpan/Downloads/Claude Code/每日知识/daily-notes';
const PORT = 8901;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
               '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${extra ? '  ' + extra : ''}`);
};

const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) errs.push('CONSOLE: ' + m.text()); });

/* ── A. 老 localStorage（缺 readBook / starBook）加载不报错 ── */
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.evaluate(() => localStorage.setItem('dib.v1', JSON.stringify(
  { read: { '006': { p: .4, done: false } }, star: { '005': true }, starTerm: {}, starEng: { '2026-09-06|chase it up / chase someone up on something': true }, fs: 1, theme: 'auto' })));
await page.reload();
await page.waitForTimeout(1200);
console.log('\nA · 老 localStorage 兼容');
check('缺 readBook / starBook 的旧存档加载无报错', errs.length === 0, errs.join(' | '));
const compat = await page.evaluate(() => ({
  rb: JSON.stringify(S.readBook), sb: JSON.stringify(S.starBook),
  keepRead: !!(S.read && S.read['006']), keepStar: !!(S.star && S.star['005']),
  keepEng: Object.keys(S.starEng).length,
}));
check('readBook / starBook 自动补成空对象', compat.rb === '{}' && compat.sb === '{}', compat.rb + ' ' + compat.sb);
check('旧的 read / star / starEng 没被动过', compat.keepRead && compat.keepStar && compat.keepEng === 1);

/* ── B. 五个 tab 都能切 ── */
console.log('\nB · 底部导航');
const tabs = await page.$$eval('nav.tabs .tab', bs => bs.map(b => b.dataset.go));
check('五个 tab', tabs.length === 5 && tabs.join(',') === 'today,archive,english,books,me', tabs.join(','));
for (const t of tabs) {
  await page.click(`[data-go="${t}"]`); await page.waitForTimeout(200);
  const on = await page.$eval(`#s-${t}`, e => e.classList.contains('on'));
  const sel = await page.$eval(`[data-go="${t}"]`, e => e.getAttribute('aria-selected'));
  check(`切到 ${t} 并高亮`, on && sel === 'true');
}
check('「读书」在「英语」和「我的」之间', tabs[2] === 'english' && tabs[3] === 'books' && tabs[4] === 'me');

/* ── C. 读书列表 ── */
await page.click('[data-go="books"]'); await page.waitForTimeout(300);
console.log('\nC · 读书页列表');
const data = await page.evaluate(() => BOOKS.map(b => ({
  id: b.id, title: b.title, front: b.front.length, tail: (b.tail||[]).length, ch: b.chapters.length,
  terms: b.terms.length, src: b.sources.length,
  frontTags: b.front.map(s => s.tag),
  chNos: b.chapters.map(c => c.no),
})));
check('三本书', data.length === 3, data.map(d => d.title).join('/'));
const rows = await page.$$('#bookBody [data-openbook]');
check('三行都渲染出来', rows.length === 3);
for (const d of data) {
  const txt = await page.$eval(`[data-openbook="${d.id}"]`, e => e.innerText);
  check(`${d.title} 行有书名 / 一句话 / 章节数 / 进度`,
    txt.includes(d.title) && txt.length > 40 && /\d+\s*[章卷篇组]/.test(txt) && /未读|已读|\d+\/\d+/.test(txt));
}
check('每本都有「一页读懂」和「核心主题」小节',
  data.every(d => d.frontTags.includes('一页读懂') && d.frontTags.includes('核心主题')));
check('章节条目数：论语 20 / 道德经 9 / 理想国 10',
  data.find(d => d.id === 'lunyu').ch === 20 && data.find(d => d.id === 'daodejing').ch === 9 &&
  data.find(d => d.id === 'republic').ch === 10, data.map(d => d.id + ':' + d.ch).join(' '));

/* ── D. 第一层阅读器：每本都能点进去，内容齐 ── */
console.log('\nD · 第一层：整本书');
for (const d of data) {
  await page.click(`#bookBody [data-openbook="${d.id}"]`); await page.waitForTimeout(400);
  const info = await page.evaluate(() => ({
    on: document.getElementById('reader').classList.contains('on'),
    h2: document.querySelector('#rBody .rhead h2').textContent,
    secs: [...document.querySelectorAll('#rBody .sec .sechd .t')].map(e => e.textContent.trim()),
    chRows: document.querySelectorAll('#rBody .chlist [data-openchap]').length,
    srcs: document.querySelectorAll('#rBody .srcs a').length,
    terms: document.querySelectorAll('#rBody .term').length,
    markHidden: document.getElementById('rMark').hidden,
    raw: document.getElementById('rBody').innerText,
  }));
  check(`${d.title} 打开全屏阅读器`, info.on && info.h2.includes(d.title));
  check(`${d.title} ${d.front} 节展开 + 章节列表 + ${d.tail} 节附录`, info.secs.length === d.front + 1 + d.tail,
    info.secs.join(','));
  check(`${d.title} 下半部 ${d.ch} 条章节行折叠`, info.chRows === d.ch, String(info.chRows));
  check(`${d.title} 资料来源 ${d.src} 条`, info.srcs === d.src);
  check(`${d.title} 概念气泡 ≥ ${d.terms} 个`, info.terms >= d.terms, String(info.terms));
  check(`${d.title} 书页里 ✓ 按钮隐藏`, info.markHidden === true);
  check(`${d.title} 正文无残留 [[`, !info.raw.includes('[['));
  if (d.tail) check(`${d.title} 附录排在章节列表之后`,
    info.secs.indexOf('章次索引') > info.secs.findIndex(t => t.startsWith('逐')), info.secs.join(','));
  await page.click('#rClose'); await page.waitForTimeout(300);
  check(`${d.title} 关掉回到书列表`, await page.$eval('#reader', e => !e.classList.contains('on')));
}

/* ── E. 第二层：章节 + 关掉回到那本书 ── */
console.log('\nE · 第二层：章节');
await page.click('#bookBody [data-openbook="republic"]'); await page.waitForTimeout(350);
const allChap = await page.$$eval('#rBody .chlist [data-openchap]', bs => bs.map(b => b.dataset.openchap));
check('理想国 10 条章节行 key 正确', allChap.length === 10 && allChap[0] === 'republic|01');
await page.click('#rBody [data-openchap="republic|07"]'); await page.waitForTimeout(400);
const ch = await page.evaluate(() => ({
  id: document.getElementById('rId').textContent,
  h2: document.querySelector('#rBody .rhead h2').textContent,
  q: (document.querySelector('#rBody .secq b') || {}).textContent,
  markHidden: document.getElementById('rMark').hidden,
  body: document.getElementById('rBody').innerText,
  curChap: !!window.curChap, curBook: !!window.curBook, cur: !!window.cur, curEng: !!window.curEng,
}));
check('章节层打开的是第七卷', ch.h2.includes('第七卷') && ch.id.includes('VII'), ch.h2);
check('章节层显示「本卷主问题」框', ch.q === '本卷主问题', String(ch.q));
check('章节层 ✓ 按钮显示', ch.markHidden === false);
check('章节层正文含洞穴寓言', ch.body.includes('洞穴'));
check('章节层无残留 [[', !ch.body.includes('[['));
await page.click('#rClose'); await page.waitForTimeout(400);
const back = await page.evaluate(() => ({
  on: document.getElementById('reader').classList.contains('on'),
  h2: (document.querySelector('#rBody .rhead h2') || {}).textContent,
  chRows: document.querySelectorAll('#rBody .chlist [data-openchap]').length,
}));
check('关掉章节回到《理想国》那本书，而不是书列表', back.on && back.h2.includes('理想国') && back.chRows === 10,
  `on=${back.on} h2=${back.h2}`);

/* ── F. 读书进度 / 收藏：独立存储键 ── */
console.log('\nF · 独立存储键');
await page.click('#rBody [data-openchap="republic|03"]'); await page.waitForTimeout(350);
await page.click('#rMark'); await page.waitForTimeout(200);   // 标记已读
await page.click('#rStar'); await page.waitForTimeout(200);   // 收藏这一章
let st = await page.evaluate(() => JSON.parse(localStorage.getItem('dib.v1')));
check('章节已读写进 S.readBook', st.readBook['republic|03'] === true, JSON.stringify(st.readBook));
check('章节收藏写进 S.starBook', st.starBook['republic|03'] === true, JSON.stringify(st.starBook));
check('没有污染 S.read', JSON.stringify(st.read) === '{"006":{"p":0.4,"done":false}}', JSON.stringify(st.read));
check('没有污染 S.star', JSON.stringify(st.star) === '{"005":true}', JSON.stringify(st.star));
check('没有污染 S.starEng', Object.keys(st.starEng).length === 1);
await page.click('#rClose'); await page.waitForTimeout(350);  // 回书页
await page.click('#rStar'); await page.waitForTimeout(200);   // 收藏整本书
st = await page.evaluate(() => JSON.parse(localStorage.getItem('dib.v1')));
check('整本书收藏写进 S.starBook[bookId]', st.starBook['republic'] === true);
const rowTxt = await page.$eval('#rBody [data-openchap="republic|03"]', e => e.innerText);
check('书页里那一行已变成「已读 / 已收藏」', rowTxt.includes('已读') && rowTxt.includes('已收藏'), rowTxt.replace(/\n/g, ' '));
await page.click('#rClose'); await page.waitForTimeout(350);
const listTxt = await page.$eval('#bookBody [data-openbook="republic"]', e => e.innerText);
check('退回书列表后进度 / 收藏已刷新', listTxt.includes('1/10') && listTxt.includes('已收藏'), listTxt.replace(/\n/g, ' '));

/* 自动记进度：滚到底 */
await page.click('#bookBody [data-openbook="daodejing"]'); await page.waitForTimeout(350);
await page.click('#rBody [data-openchap="daodejing|02"]'); await page.waitForTimeout(350);
await page.evaluate(() => { const R = document.getElementById('reader'); R.scrollTop = R.scrollHeight; });
await page.waitForTimeout(500);
st = await page.evaluate(() => JSON.parse(localStorage.getItem('dib.v1')));
check('滚到底自动记 S.readBook', st.readBook['daodejing|02'] === true, JSON.stringify(st.readBook));
check('滚到底没写 S.read（文章进度不串味）',
  JSON.stringify(st.read) === '{"006":{"p":0.4,"done":false}}', JSON.stringify(st.read));
await page.click('#rClose'); await page.waitForTimeout(300);
await page.click('#rClose'); await page.waitForTimeout(300);

/* ── G. 文章 / 英语的收藏与进度仍然各走各的 ── */
console.log('\nG · 文章 / 英语不受影响');
await page.click('[data-go="archive"]'); await page.waitForTimeout(300);
await page.click('#archBody [data-open="005"]'); await page.waitForTimeout(400);
await page.click('#rStar'); await page.waitForTimeout(200);   // 取消 005 收藏
st = await page.evaluate(() => JSON.parse(localStorage.getItem('dib.v1')));
check('文章 ★ 仍写 S.star', st.star['005'] === false, JSON.stringify(st.star));
check('文章 ★ 没碰 S.starBook', st.starBook['republic'] === true && st.starBook['republic|03'] === true);
await page.click('#rClose'); await page.waitForTimeout(300);
await page.click('[data-go="english"]'); await page.waitForTimeout(300);
await page.click('[data-emode="all"]'); await page.waitForTimeout(300);
const engKey0 = await page.$eval('#engBody [data-openeng]', e => e.dataset.openeng);
await page.click(`#engBody [data-openeng="${engKey0.replace(/"/g, '\\"')}"]`); await page.waitForTimeout(400);
await page.click('#rStar'); await page.waitForTimeout(200);
st = await page.evaluate(() => JSON.parse(localStorage.getItem('dib.v1')));
check('英语 ★ 仍写 S.starEng', Object.keys(st.starEng).length >= 1 && st.starEng[engKey0] !== undefined);
check('英语 ★ 没碰 S.starBook / S.readBook',
  st.starBook['republic'] === true && st.readBook['daodejing|02'] === true);
await page.click('#rClose'); await page.waitForTimeout(300);

/* ── H. 「我的」页统计 ── */
console.log('\nH · 我的页');
await page.click('[data-go="me"]'); await page.waitForTimeout(300);
const stats = await page.$eval('#stats', e => e.innerText.replace(/\n/g, ' '));
check('统计里有读书三项', /读完的书/.test(stats) && /读过章节/.test(stats) && /收藏书目/.test(stats), stats);
const nums = await page.$$eval('#stats .n', ns => ns.map(n => n.textContent));
check('读过章节 = 2', nums[4] === '2', nums.join('/'));
check('收藏书目 = 1', nums[5] === '1', nums.join('/'));
const me = await page.$eval('#meBody', e => e.innerText);
check('「我的」保留原有分组', me.includes('阅读设置') && me.includes('收藏的文章') && me.includes('关于'));
check('「我的」多了「收藏的书」', me.includes('收藏的书') && me.includes('理想国'));

/* ── I. 术语气泡 ── */
console.log('\nI · 概念气泡');
await page.click('[data-go="books"]'); await page.waitForTimeout(250);
await page.click('#bookBody [data-openbook="lunyu"]'); await page.waitForTimeout(350);
await page.click('#rBody .term'); await page.waitForTimeout(350);
const sheet = await page.evaluate(() => ({
  on: document.getElementById('sheet').classList.contains('on'),
  from: (document.querySelector('#sheet .from') || {}).textContent,
  zh: (document.querySelector('#sheet .zh') || {}).textContent,
  def: (document.querySelector('#sheet .def') || {}).textContent,
}));
check('书里的概念气泡能点开', sheet.on && !!sheet.zh, sheet.zh);
check('气泡来源标的是书名而不是期号', /《.+》/.test(sheet.from || ''), sheet.from);
check('气泡带定义', (sheet.def || '').length > 5);
await page.click('#veil'); await page.waitForTimeout(250);
await page.click('#rClose'); await page.waitForTimeout(300);

/* ── J. 390×844 不横向滚动 + 无 JS 报错 ── */
console.log('\nJ · 版式与报错');
const oflow = [];
for (const [name, go, extra] of [['今日', 'today', null], ['往期', 'archive', null],
  ['英语', 'english', null], ['读书', 'books', null], ['我的', 'me', null]]) {
  await page.click(`[data-go="${go}"]`); await page.waitForTimeout(250);
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  if (w[0] > w[1] + 1) oflow.push(`${name} ${w[0]}>${w[1]}`);
}
await page.click('[data-go="books"]'); await page.waitForTimeout(200);
for (const id of ['lunyu', 'daodejing', 'republic']) {
  await page.click(`#bookBody [data-openbook="${id}"]`); await page.waitForTimeout(350);
  let w = await page.evaluate(() => [document.getElementById('rBody').scrollWidth, window.innerWidth]);
  if (w[0] > w[1] + 1) oflow.push(`书 ${id} ${w[0]}>${w[1]}`);
  const first = await page.$eval('#rBody .chlist [data-openchap]', e => e.dataset.openchap);
  await page.click(`#rBody [data-openchap="${first}"]`); await page.waitForTimeout(350);
  w = await page.evaluate(() => [document.getElementById('rBody').scrollWidth, window.innerWidth]);
  if (w[0] > w[1] + 1) oflow.push(`章 ${first} ${w[0]}>${w[1]}`);
  await page.click('#rClose'); await page.waitForTimeout(250);
  await page.click('#rClose'); await page.waitForTimeout(250);
}
check('390×844 五个页面 + 书页 + 章节页都不横向滚动', oflow.length === 0, oflow.join(' | '));

/* 全书正文里没有残留 [[ */
const leak = await page.evaluate(() => {
  const bad = [];
  for (const b of BOOKS) {
    const walk = o => {
      if (typeof o === 'string') { if (/\[\[[^\]|]+(\|[^\]]+)?\]\]/.test(o)) {
        for (const m of o.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) if (!TM[m[1]]) bad.push(b.id + ':' + m[1]);
      } }
      else if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === 'object') Object.values(o).forEach(walk);
    };
    walk(b.front); walk(b.chapters);
  }
  return bad;
});
check('所有 [[术语]] 都能在术语表里查到', leak.length === 0, leak.join(','));
check('没有更新横幅误报「有新一期」', await page.$eval('#updbar', e => e.hidden === true));
check('全程无 JS 报错', errs.length === 0, errs.join(' | '));

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
