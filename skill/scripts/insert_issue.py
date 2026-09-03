#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把当期内容写进仓库。用法：

    python3 skill/scripts/insert_issue.py payload.json

payload.json 形如：
{
  "issue":   { "id":"004", "date":"2026-09-04", "sector":"...", "title":"...", ... },
  "english": { "date":"2026-09-04", "items":[ {...}, {...}, {...} ] }
}

字段规格见 skill/reference/data-format.md。

这个脚本做五件事，任何一步失败都会大声报错、不写坏文件：
  1. 校验 payload（六节、每节有 q、术语 6–8、来源非空、web 非空、英语 3 条字段齐全）
  2. 把新一期插到 ISSUES 最前、新英语插到 ENGLISH 最前
  3. 把 index.html 的 BUILD 和 sw.js 的 BUILD 改成当期日期
  4. 重写 version.json
  5. 抽出 <script> 跑 node --check

为什么用 json.dumps 生成 JS：JSON 是 JS 对象字面量的子集，引号一律由 json 转义，
从根上杜绝「中文用了 ASCII 直引号导致 App 白屏」这个反复出现的坑。
"""
import io, os, re, sys, json, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HTML = os.path.join(ROOT, 'index.html')
SW   = os.path.join(ROOT, 'sw.js')
VER  = os.path.join(ROOT, 'version.json')

BLOCK_TYPES = {'p', 'h4', 'ul', 'ol', 'table', 'risk', 'takeaway', 'watch', 'flow', 'chain'}


def die(msg):
    sys.exit('✗ ' + msg)


# ── 1. 校验 ───────────────────────────────────────────────────────────
def validate(iss, eng):
    errs = []

    for k in ('id', 'date', 'sector', 'title', 'deck', 'takeaway', 'next', 'web', 'sections', 'terms', 'sources'):
        if not iss.get(k):
            errs.append('issue 缺字段或为空: %s' % k)
    if iss.get('web') is not None and not str(iss.get('web', '')).startswith('http'):
        errs.append('issue.web 必须是真实 URL（当期网页版 artifact 地址），现在是: %r' % iss.get('web'))
    if not re.fullmatch(r'\d{3}', str(iss.get('id', ''))):
        errs.append('issue.id 必须是三位数字字符串，如 "004"')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(iss.get('date', ''))):
        errs.append('issue.date 必须是 YYYY-MM-DD')

    secs = iss.get('sections') or []
    if len(secs) != 6:
        errs.append('必须正好六节，现在 %d 节' % len(secs))
    for i, s in enumerate(secs, 1):
        where = '§%d' % i
        for k in ('n', 'tag', 'h', 'q', 'blocks'):
            if not s.get(k):
                errs.append('%s 缺字段: %s%s' % (where, k, '（每节都必须写"本节回答"）' if k == 'q' else ''))
        for b in (s.get('blocks') or []):
            t = b.get('t')
            if t not in BLOCK_TYPES:
                errs.append('%s 有未知块类型: %r（可用: %s）' % (where, t, '、'.join(sorted(BLOCK_TYPES))))

    terms = iss.get('terms') or []
    if not 6 <= len(terms) <= 8:
        errs.append('术语表要 6–8 条，现在 %d 条' % len(terms))
    for t in terms:
        if not all(t.get(k) for k in ('zh', 'en', 'def')):
            errs.append('术语缺 zh/en/def: %r' % t)

    for s in (iss.get('sources') or []):
        if not all(s.get(k) for k in ('d', 'n', 'u')):
            errs.append('来源缺 d/n/u: %r' % s)

    # 正文里引用的 [[术语]] 必须在 terms 里存在
    names = {t.get('zh') for t in terms}
    body = json.dumps(secs, ensure_ascii=False)
    for ref in set(re.findall(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]', body)):
        if ref not in names:
            errs.append('正文用了 [[%s]]，但术语表里没有这个词（气泡会点不开）' % ref)

    items = (eng or {}).get('items') or []
    if len(items) != 3:
        errs.append('英语必须正好 3 条，现在 %d 条' % len(items))
    for i, it in enumerate(items, 1):
        for k in ('type', 'en', 'zh', 'use', 'ex', 'bad', 'say'):
            if not it.get(k):
                errs.append('英语第 %d 条缺字段: %s' % (i, k))
        ex = it.get('ex') or []
        if len(ex) != 2 or any(len(p) != 2 for p in ex):
            errs.append('英语第 %d 条的 ex 必须是两个 [英文, 中文] 例句' % i)
        if it.get('say') and '<code>' not in it['say']:
            errs.append('英语第 %d 条的 say 里要用 <code>…</code> 包住音块' % i)
    if not any('搭配' in (it.get('type') or '') for it in items):
        errs.append('3 条里至少要有 1 条 type 含「搭配」的固定搭配条目')
    if eng.get('date') != iss.get('date'):
        errs.append('英语日期(%s)和当期日期(%s)不一致' % (eng.get('date'), iss.get('date')))

    if errs:
        print('校验没过，%d 个问题：' % len(errs))
        for e in errs:
            print('  ✗ ' + e)
        sys.exit(1)
    print('✓ payload 校验通过（六节 / 每节有 q / 术语 %d 条 / 来源 %d 项 / 英语 3 条）'
          % (len(terms), len(iss.get('sources'))))


# ── 2. 插入 ───────────────────────────────────────────────────────────
def insert(iss, eng):
    h = io.open(HTML, encoding='utf-8').read()

    # 期号不能重复
    if re.search(r'"?\bid"?\s*:\s*"%s"' % iss['id'], h):
        die('第 %s 期已经在 index.html 里了，不要重复插入' % iss['id'])

    iss_js = json.dumps(iss, ensure_ascii=False, indent=2)
    eng_js = json.dumps(eng, ensure_ascii=False, indent=2)

    a = 'const ISSUES = ['
    if a not in h:
        die('index.html 里找不到 `const ISSUES = [`')
    h = h.replace(a, a + '\n' + iss_js + ',', 1)

    b = 'const ENGLISH = ['
    if b not in h:
        die('index.html 里找不到 `const ENGLISH = [`')
    h = h.replace(b, b + '\n' + eng_js + ',', 1)

    # BUILD
    n, cnt = re.subn(r'const BUILD = "[\d-]*";', 'const BUILD = "%s";' % iss['date'], h, count=1)
    if cnt != 1:
        die('index.html 里找不到 `const BUILD = "...";`（老版本没有自动更新机制？）')
    h = n

    io.open(HTML, 'w', encoding='utf-8').write(h)
    print('✓ index.html：第 %s 期 + %s 的英语已插入，BUILD → %s' % (iss['id'], eng['date'], iss['date']))

    sw = io.open(SW, encoding='utf-8').read()
    sw2, c2 = re.subn(r"const BUILD = '[\d-]*';", "const BUILD = '%s';" % iss['date'], sw, count=1)
    if c2 != 1:
        die("sw.js 里找不到 `const BUILD = '...';`")
    io.open(SW, 'w', encoding='utf-8').write(sw2)
    print('✓ sw.js：BUILD → %s' % iss['date'])

    io.open(VER, 'w', encoding='utf-8').write(json.dumps(
        {'build': iss['date'], 'issue': iss['id'], 'title': iss['title'], 'sector': iss['sector']},
        ensure_ascii=False, indent=2) + '\n')
    print('✓ version.json 已重写（手机 App 靠它发现新一期）')
    return h


# ── 3. 语法校验 ───────────────────────────────────────────────────────
def check_js(h):
    m = re.search(r'<script>\n(.*)\n</script>', h, re.S)
    if not m:
        die('抽不出 <script> 内容')
    tmp = os.path.join(ROOT, '.check.js')
    io.open(tmp, 'w', encoding='utf-8').write(m.group(1))
    for f in (tmp, SW):
        r = subprocess.run(['node', '--check', f], capture_output=True, text=True)
        if r.returncode != 0:
            print(r.stderr)
            die('node --check 没过：%s' % os.path.basename(f))
    os.remove(tmp)
    print('✓ node --check 通过（index.html 内联脚本 + sw.js）')


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    p = json.load(io.open(sys.argv[1], encoding='utf-8'))
    iss, eng = p.get('issue'), p.get('english')
    if not iss or not eng:
        die('payload 需要 issue 和 english 两个顶层字段')
    validate(iss, eng)
    h = insert(iss, eng)
    check_js(h)
    print('\n下一步：node skill/scripts/verify.mjs   然后 git add -A && git commit && git push')


if __name__ == '__main__':
    main()
