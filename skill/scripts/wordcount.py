#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""数六节正文的汉字数。目标 2500–3500 字。

    python3 skill/scripts/wordcount.py payload.json   # 数 payload 里的当期
    python3 skill/scripts/wordcount.py                # 数 index.html 里最新一期

历史教训：第 003 期初稿 5,245 字，压了三轮才到 3,960，仍然超标。
建议一开始就按配额写：§1 450 / §2 550 / §3 900 / §4 650 / §5 600 / §6 350。
"""
import io, os, re, sys, json

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
QUOTA = {1: 450, 2: 550, 3: 900, 4: 650, 5: 600, 6: 350}
HAN = re.compile(r'[一-鿿]')


def han(s):
    return len(HAN.findall(re.sub(r'<[^>]+>', '', str(s))))


def count_section(sec):
    n = han(sec.get('h', '')) + han(sec.get('q', ''))
    for b in sec.get('blocks', []):
        t = b.get('t')
        if t in ('p', 'h4', 'takeaway'):
            n += han(b.get('v', ''))
        elif t in ('ul', 'ol', 'flow'):
            n += sum(han(x) for x in b.get('v', []))
        elif t == 'risk':
            n += sum(han(x) for x in b.get('items', []))
        elif t == 'chain':
            n += sum(han(k) + han(v) for k, v in b.get('items', []))
        elif t == 'watch':
            n += sum(han(a) + han(c) for a, _, c in
                     [(i[0], i[1], i[2]) for i in b.get('items', [])])
        elif t == 'table':
            n += han(b.get('cap', '')) + sum(han(x) for x in b.get('head', []))
            for row in b.get('rows', []):
                for c in row:
                    n += han(c[1] if isinstance(c, list) else c)
    return n


def main():
    if len(sys.argv) > 1:
        iss = json.load(io.open(sys.argv[1], encoding='utf-8'))['issue']
    else:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from state import slice_array, top_objects, field
        src = io.open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
        obj = top_objects(slice_array(src, 'const ISSUES = ['))[0]
        print('（从 index.html 最新一期估算：%s %s）\n' % (field(obj, 'id'), field(obj, 'title')))
        # 粗算：整个对象里的汉字，减去 terms/sources 的部分
        total = han(obj)
        print('对象内汉字合计约 %d（含术语表与来源，正文实际略少）' % total)
        return

    total = 0
    print('%-6s %6s %7s   %s' % ('节', '汉字', '配额', ''))
    for i, sec in enumerate(iss.get('sections', []), 1):
        n = count_section(sec)
        total += n
        q = QUOTA.get(i, 0)
        bar = '超 %+d' % (n - q) if abs(n - q) > 80 else 'ok'
        print('%-6s %6d %7d   %s' % (sec.get('n', '§%d' % i), n, q, bar))
    print('-' * 34)
    ok = 2500 <= total <= 3500
    print('%-6s %6d %7d   %s' % ('合计', total, 3500, '✓ 在 2500–3500 区间' if ok else
          ('✗ 超标 %d 字，需要压缩' % (total - 3500) if total > 3500 else '✗ 太短 %d 字' % (2500 - total))))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
