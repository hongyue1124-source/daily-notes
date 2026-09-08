#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把当期内容写进仓库。用法：

    python3 skill/scripts/insert_issue.py payload.json

payload.json 形如：
{
  "issue":   { "id":"004", "date":"2026-09-04", "sector":"...", "title":"...", ... },
  "english": { "date":"2026-09-04", "items":[ {...}, {...}, {...} ] },
  "psych":   { "id":"001", "date":"2026-09-08", "field":"认知心理学", "name":"...", ... }
}

`issue` + `english` 是一对（要么都给，要么都不给）；`psych` 是**可选**的，
每天的产业笔记不一定带实验。三个键至少要有一组，只给 psych 也能单独跑。

字段规格见 skill/reference/data-format.md。

这个脚本做五件事，任何一步失败都会大声报错、不写坏文件：
  1. 校验 payload（六节、每节有 q、术语条数、来源非空、web、英语 3 条字段齐全）
  2. 把新一期插到 ISSUES 最前、新英语插到 ENGLISH 最前、新实验插到 PSYCH 最前
  3. 把 index.html 的 BUILD 和 sw.js 的 BUILD 改成当期日期
  4. 重写 version.json
  5. 抽出 <script> 跑 node --check

为什么用 json.dumps 生成 JS：JSON 是 JS 对象字面量的子集，引号一律由 json 转义，
从根上杜绝「中文用了 ASCII 直引号导致 App 白屏」这个反复出现的坑。
"""
import io, os, re, sys, json, subprocess

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from state import slice_array, top_objects, field   # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HTML = os.path.join(ROOT, 'index.html')
SW   = os.path.join(ROOT, 'sw.js')
VER  = os.path.join(ROOT, 'version.json')

BLOCK_TYPES = {'p', 'h4', 'ul', 'ol', 'table', 'risk', 'takeaway', 'watch', 'flow', 'chain'}
PSYCH_TAGS = ['问题', '设计', '结果', '反直觉', '后续', '拿走']


def die(msg):
    sys.exit('✗ ' + msg)


def walk_str(v):
    """递归拿出结构里的每一个字符串值。

    不能在整段 json.dumps 上跑 [[ 正则：表格里的数组格序列化后会出现字面 [[，
    会被误判成术语引用。见 known-issues.md。"""
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for x in v.values():
            yield from walk_str(x)
    elif isinstance(v, (list, tuple)):
        for x in v:
            yield from walk_str(x)


def check_term_refs(secs, terms, errs, where='正文'):
    names = {t.get('zh') for t in terms}
    refs = set()
    for sv in walk_str(secs):
        refs.update(re.findall(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]', sv))
    for ref in sorted(refs):
        if ref not in names:
            errs.append('%s用了 [[%s]]，但术语表里没有这个词（气泡会点不开）' % (where, ref))


def dup_id(html, marker, new_id):
    """期号查重必须限定在对应的数组里——ISSUES 和 PSYCH 是两套独立编号，
    在整个文件上搜 "id":"001" 会互相误伤。"""
    try:
        arr = slice_array(html, marker)
    except ValueError:
        return False
    return any(field(o, 'id') == new_id for o in top_objects(arr))


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
    check_term_refs(secs, terms, errs)

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


def validate_psych(ps):
    """心理学实验条目。六节的 tag 是固定的六个词，块类型完全复用 blockHTML()。"""
    errs = []

    for k in ('id', 'date', 'field', 'name', 'en', 'who', 'year', 'journal',
              'minutes', 'deck', 'takeaway', 'sections', 'terms', 'sources'):
        if not ps.get(k):
            errs.append('psych 缺字段或为空: %s' % k)
    # web 允许是空字符串（实验条目不一定有网页版），只在给了非空值时校验形状
    if ps.get('web') and not str(ps['web']).startswith('http'):
        errs.append('psych.web 给了就必须是真实 URL，现在是: %r' % ps.get('web'))
    if not re.fullmatch(r'\d{3}', str(ps.get('id', ''))):
        errs.append('psych.id 必须是三位数字字符串，如 "001"')
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(ps.get('date', ''))):
        errs.append('psych.date 必须是 YYYY-MM-DD')
    if not re.fullmatch(r'\d{4}', str(ps.get('year', ''))):
        errs.append('psych.year 必须是四位年份字符串，如 "2005"')

    secs = ps.get('sections') or []
    if len(secs) != 6:
        errs.append('psych 必须正好六节，现在 %d 节' % len(secs))
    for i, s in enumerate(secs, 1):
        where = '§%d' % i
        for k in ('n', 'tag', 'h', 'q', 'blocks'):
            if not s.get(k):
                errs.append('psych %s 缺字段: %s' % (where, k))
        for b in (s.get('blocks') or []):
            if b.get('t') not in BLOCK_TYPES:
                errs.append('psych %s 有未知块类型: %r（可用: %s）'
                            % (where, b.get('t'), '、'.join(sorted(BLOCK_TYPES))))
    if len(secs) == 6:
        got = [s.get('tag') for s in secs]
        if got != PSYCH_TAGS:
            errs.append('psych 六节的 tag 必须依次是 %s，现在是 %s'
                        % ('/'.join(PSYCH_TAGS), '/'.join(str(g) for g in got)))
        need = {2: [], 3: ['table'], 4: ['chain', 'risk'], 6: ['takeaway', 'watch']}
        for n, want in need.items():
            have = {b.get('t') for b in (secs[n - 1].get('blocks') or [])}
            for w in want:
                if w not in have:
                    errs.append('psych §%d（%s）必须有一个 %s 块' % (n, PSYCH_TAGS[n - 1], w))

    terms = ps.get('terms') or []
    if not 4 <= len(terms) <= 6:
        errs.append('psych 术语表要 4–6 条，现在 %d 条' % len(terms))
    for t in terms:
        if not all(t.get(k) for k in ('zh', 'en', 'def')):
            errs.append('psych 术语缺 zh/en/def（中英文都必填）: %r' % t)

    if not (ps.get('sources') or []):
        errs.append('psych.sources 不能为空')
    for s in (ps.get('sources') or []):
        if not all(s.get(k) for k in ('d', 'n', 'u')):
            errs.append('psych 来源缺 d/n/u: %r' % s)

    check_term_refs(secs, terms, errs, where='psych 正文')

    if errs:
        print('psych 校验没过，%d 个问题：' % len(errs))
        for e in errs:
            print('  ✗ ' + e)
        sys.exit(1)
    print('✓ psych 校验通过（六节 tag 齐 / §3 有表 / §4 有 chain+risk / §6 有 takeaway+watch '
          '/ 术语 %d 条 / 来源 %d 项）' % (len(terms), len(ps.get('sources'))))


# ── 2. 插入 ───────────────────────────────────────────────────────────
def insert(iss, eng, ps):
    h = io.open(HTML, encoding='utf-8').read()
    done = []

    if iss:
        if dup_id(h, 'const ISSUES = [', iss['id']):
            die('第 %s 期已经在 index.html 里了，不要重复插入' % iss['id'])
        a = 'const ISSUES = ['
        if a not in h:
            die('index.html 里找不到 `const ISSUES = [`')
        h = h.replace(a, a + '\n' + json.dumps(iss, ensure_ascii=False, indent=2) + ',', 1)

        b = 'const ENGLISH = ['
        if b not in h:
            die('index.html 里找不到 `const ENGLISH = [`')
        h = h.replace(b, b + '\n' + json.dumps(eng, ensure_ascii=False, indent=2) + ',', 1)
        done.append('第 %s 期 + %s 的英语' % (iss['id'], eng['date']))

    if ps:
        if dup_id(h, 'const PSYCH = [', ps['id']):
            die('心理学实验第 %s 条已经在 index.html 里了，不要重复插入' % ps['id'])
        c = 'const PSYCH = ['
        if c not in h:
            die('index.html 里找不到 `const PSYCH = [`（这个版本还没有心理学板块？）')
        h = h.replace(c, c + '\n' + json.dumps(ps, ensure_ascii=False, indent=2) + ',', 1)
        done.append('心理学实验第 %s 条（%s）' % (ps['id'], ps['name']))

    # BUILD 取本次插入内容里最新的那个日期
    build = max(x['date'] for x in (iss, ps) if x)
    n, cnt = re.subn(r'const BUILD = "[\d-]*";', 'const BUILD = "%s";' % build, h, count=1)
    if cnt != 1:
        die('index.html 里找不到 `const BUILD = "...";`（老版本没有自动更新机制？）')
    h = n

    io.open(HTML, 'w', encoding='utf-8').write(h)
    print('✓ index.html：%s 已插入，BUILD → %s' % ('、'.join(done), build))

    sw = io.open(SW, encoding='utf-8').read()
    sw2, c2 = re.subn(r"const BUILD = '[\d-]*';", "const BUILD = '%s';" % build, sw, count=1)
    if c2 != 1:
        die("sw.js 里找不到 `const BUILD = '...';`")
    io.open(SW, 'w', encoding='utf-8').write(sw2)
    print('✓ sw.js：BUILD → %s' % build)

    # version.json 的 issue/title/sector 始终指向 ISSUES 最新一期；
    # 只插 psych 时从刚写完的 index.html 里读回来，别把这几个字段丢掉。
    if iss:
        top = {'issue': iss['id'], 'title': iss['title'], 'sector': iss['sector']}
    else:
        o = top_objects(slice_array(h, 'const ISSUES = ['))[0]
        top = {'issue': field(o, 'id'), 'title': field(o, 'title'), 'sector': field(o, 'sector')}
    ver = {'build': build}
    ver.update(top)
    if ps:
        ver['psych'] = ps['id']
    io.open(VER, 'w', encoding='utf-8').write(
        json.dumps(ver, ensure_ascii=False, indent=2) + '\n')
    print('✓ version.json 已重写（手机 App 靠它发现新内容）')
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
    iss, eng, ps = p.get('issue'), p.get('english'), p.get('psych')
    if not iss and not ps:
        die('payload 至少要有 issue（配 english）或 psych 其中一组')
    if bool(iss) != bool(eng):
        die('issue 和 english 必须成对出现（当期长文和当天的 3 条英语是一套）')
    if iss:
        validate(iss, eng)
    if ps:
        validate_psych(ps)
    else:
        print('· payload 里没有 psych 键，跳过心理学板块（正常，实验不是每天都有）')
    h = insert(iss, eng, ps)
    check_js(h)
    print('\n下一步：node skill/scripts/verify.mjs   然后 git add -A && git commit && git push')


if __name__ == '__main__':
    main()
