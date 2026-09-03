#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""开工前先跑这个：从 index.html 读出当前状态，告诉你本期该用什么期号、
避开哪些行业、哪些英语表达已经给过。

    python3 skill/scripts/state.py

不要凭记忆猜这些东西——聊天记录每天清空，仓库才是唯一事实来源。
"""
import io, os, re, sys, json, subprocess, datetime, signal

try:                                   # 允许 `| head` 而不炸 BrokenPipe
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
except (AttributeError, ValueError):
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HTML = os.path.join(ROOT, 'index.html')


def slice_array(src, marker):
    """取出 `const XXX = [ ... ];` 的中括号内部（考虑字符串里的括号）。"""
    i = src.index(marker) + len(marker)   # marker 末尾已含 '['，所以深度从 1 起算
    depth, j, in_s, q, esc = 1, i, False, '', False
    while j < len(src):
        c = src[j]
        if in_s:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == q:
                in_s = False
        else:
            if c in '"\'':
                in_s, q = True, c
            elif c == '[':
                depth += 1
            elif c == ']':
                depth -= 1
                if depth == 0:
                    return src[i:j]
        j += 1
    raise ValueError('未闭合的数组: ' + marker)


def top_objects(arr):
    """把数组文本切成一个个顶层 { ... } 对象。"""
    out, depth, start, in_s, q, esc = [], 0, None, False, '', False
    for j, c in enumerate(arr):
        if in_s:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == q:
                in_s = False
            continue
        if c in '"\'':
            in_s, q = True, c
        elif c == '{':
            if depth == 0:
                start = j
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0 and start is not None:
                out.append(arr[start:j + 1])
                start = None
    return out


def field(obj, key):
    """从对象文本里取一个顶层字符串字段（同时支持 id:"x" 和 "id":"x"）。"""
    m = re.search(r'"?\b%s"?\s*:\s*"((?:[^"\\]|\\.)*)"' % re.escape(key), obj)
    return m.group(1) if m else None


def today_sg():
    try:
        out = subprocess.run(['date', '+%F'], env={**os.environ, 'TZ': 'Asia/Singapore'},
                             capture_output=True, text=True, timeout=5)
        return out.stdout.strip()
    except Exception:
        return datetime.date.today().isoformat()


def main():
    if not os.path.exists(HTML):
        sys.exit('找不到 %s —— 先 git clone 仓库并 cd 进去' % HTML)
    src = io.open(HTML, encoding='utf-8').read()

    issues = top_objects(slice_array(src, 'const ISSUES = ['))
    rows = []
    for o in issues:
        rows.append({
            'id': field(o, 'id'), 'date': field(o, 'date'),
            'sector': field(o, 'sector'), 'title': field(o, 'title'),
            'web': field(o, 'web') or field(o, 'external') or '',
        })

    eng_days = top_objects(slice_array(src, 'const ENGLISH = ['))
    used_en, day_rows = [], []
    for d in eng_days:
        dt = field(d, 'date')
        # 同时支持 en:"x"（手写 JS）和 "en": "x"（insert_issue.py 生成的 JSON）
        ens = re.findall(r'"?\ben"?\s*:\s*"((?:[^"\\]|\\.)*)"', d)
        day_rows.append((dt, len(ens)))
        used_en += ens

    ids = [int(r['id']) for r in rows if r['id'] and r['id'].isdigit()]
    nxt = '%03d' % ((max(ids) + 1) if ids else 1)
    recent = [r['sector'] for r in rows[:2]]

    print('=' * 62)
    print('本期期号        : %s        ← 已有最大 id + 1，不要凭记忆改' % nxt)
    print('今天(SGT)       : %s' % today_sg())
    print('                  ↑ 若与系统提示 <env>Today\'s date 不一致，以系统提示为准')
    print('最近两期的行业  : %s   ← 避开这些' % ('、'.join(recent) if recent else '（无）'))
    print('=' * 62)

    print('\n【已有 %d 期】' % len(rows))
    for r in rows:
        flag = '' if r['web'] else '   ⚠ web 字段是空的'
        print('  %s  %s  %-12s %s%s' % (r['id'], r['date'], r['sector'], r['title'], flag))

    print('\n【已用过的行业】')
    seen, order = set(), []
    for r in rows:
        if r['sector'] not in seen:
            seen.add(r['sector']); order.append(r['sector'])
    print('  ' + ('、'.join(order) if order else '（无）'))

    print('\n【英语：已给过 %d 条，%d 天】不得重复' % (len(used_en), len(day_rows)))
    for dt, n in day_rows:
        print('  %s  %d 条' % (dt, n))
    for e in used_en:
        print('    · %s' % e)

    missing = [r['id'] for r in rows if not r['web']]
    if missing:
        print('\n⚠ 这些期的 web / external 链接是空的，需要补：%s' % '、'.join(missing))

    print('')
    json.dump({'next_id': nxt, 'today': today_sg(), 'avoid_sectors': recent,
               'used_sectors': order, 'used_english': used_en,
               'issues': rows, 'missing_web': missing},
              io.open(os.path.join(ROOT, '.state.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=2)
    print('（同样的内容已写到 .state.json）')


if __name__ == '__main__':
    main()
