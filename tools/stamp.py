#!/usr/bin/env python3
"""読み込むファイルに版の印(?v=...)を付け直し、各ページの版の番号を index.html に揃える。

ブラウザはファイル名が同じだと古いファイルを使い続けることがあり、
更新しても見た目や速さが変わらない原因になっていた。
配布するファイルの中身から印を計算して各ページ(index.html・kaji.html・sew.html)と style.css の参照に付けるので、
中身が変わった時だけ印が変わり、ブラウザは必ず新しいファイルを読み込む。
Worker 用のファイルには mc-pool.js が同じ印を引き継ぐ。

版の番号(V3.xx)は index.html の <title> が元。kaji.html・sew.html の <title> の番号を、それに書き換える。

使い方: コードを変えたらコミットの前に  python3 tools/stamp.py
"""
import hashlib, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
# 配布するファイル(どれか1つでも変われば印が変わる)。無いファイルは飛ばす(作っている途中のため)
ASSETS = ['style.css', 'engine.js', 'mc-pool.js', 'mc-worker.js', 'gamelog.js', 'ui.js', 'bg-motif.svg',
          'top.js', 'bg-motif-sew.svg', 'sew.css', 'sew-recipes.js', 'sew-engine.js', 'sew-ai.js', 'sew-ui.js', 'sew-worker.js']
PAGES = ['index.html', 'kaji.html', 'sew.html']
VER_RE = r'V\d+\.\d+'

def main():
    assets = [a for a in ASSETS if (ROOT / a).exists()]
    h = hashlib.sha1()
    for name in assets:
        data = (ROOT / name).read_bytes()
        # 印そのものは計算から外す(外さないと印を付けるたびに値が変わってしまう)
        h.update(re.sub(rb'--css-ver:"[0-9a-z]+"', b'', re.sub(rb'\?v=[0-9a-z]+', b'', data)))
    ver = h.hexdigest()[:8]
    m = re.search(r'<title>[^<]*?(' + VER_RE + r')</title>', (ROOT / 'index.html').read_text(encoding='utf-8'))
    if not m: raise SystemExit('index.html の <title> に版の番号(V3.xx)が見つかりません')
    app_ver = m.group(1)
    ref = r'((?:href|src)="(?:%s))\?v=[0-9a-z]+"' % '|'.join(map(re.escape, assets))
    for page in PAGES:
        p = ROOT / page
        if not p.exists(): continue
        s = p.read_text(encoding='utf-8')
        s, n = re.subn(ref, lambda mm: f'{mm.group(1)}?v={ver}"', s)
        if n == 0: raise SystemExit(f'{page} に印を付ける参照が見つかりません')
        s, n = re.subn(r'(<title>[^<]*?)' + VER_RE + r'(</title>)', lambda mm: f'{mm.group(1)}{app_ver}{mm.group(2)}', s)
        if n == 0: raise SystemExit(f'{page} の <title> に版の番号が見つかりません')
        p.write_text(s, encoding='utf-8')
    p = ROOT / 'style.css'
    s = p.read_text(encoding='utf-8')
    s, n1 = re.subn(r'(url\("bg-motif(?:-sew)?\.svg)\?v=[0-9a-z]+"', lambda mm: f'{mm.group(1)}?v={ver}"', s)
    s, n2 = re.subn(r'(--css-ver:)"[0-9a-z]+"', lambda mm: f'{mm.group(1)}"{ver}"', s)
    if n1 == 0 or n2 == 0: raise SystemExit('style.css に印を付ける参照が見つかりません')
    p.write_text(s, encoding='utf-8')
    print('版:', app_ver, '・版の印:', ver)

if __name__ == '__main__':
    main()
