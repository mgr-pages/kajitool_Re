#!/usr/bin/env python3
"""背景の柄(鍛冶の bg-motif.svg・裁縫の bg-motif-sew.svg)を作る。

道具の線画とスライムを、位置・向き・大きさをばらけさせて 900×900 の1枚に散らす。
規則正しく並ぶと単調に見えるため。乱数の種は固定なので、何度作っても同じ絵になる。
1枚を繰り返して敷くので、端にかかった絵は反対側にも描いて継ぎ目で途切れないようにする。

使い方: python3 tools/make-bg-motif.py > bg-motif.svg            (鍛冶)
        python3 tools/make-bg-motif.py sew > bg-motif-sew.svg    (裁縫)
"""
import math, random, sys

SIZE = 900
SEED = 20260926
STROKE = 2.2            # 線の太さ(全イラスト共通。拡大縮小しても同じ太さに見えるよう、絵ごとに割り戻す)

# 各イラストは原点を中心に、おおよそ半径 R の中に収まるように描く
SYMBOLS = {
    'hammer': (34, '''<g transform="rotate(-35)"><rect x="-4" y="-18" width="8" height="54" rx="3"/>
      <rect x="-20" y="-32" width="40" height="16" rx="3"/><path d="M-14 -32 v16 M14 -32 v16"/></g>'''),
    'anvil': (46, '''<path d="M-38 -10 H30 Q42 -10 46 -18 Q44 0 22 2 L14 16 H24 V24 H-24 V16 H-14 L-20 2 Q-38 0 -38 -10 Z"/>
      <path d="M-30 -4 H26"/>'''),
    'flame': (28, '''<path d="M0 26 C-18 26 -24 10 -16 -2 C-12 6 -6 6 -6 0 C-6 -12 2 -20 4 -28 C10 -16 22 -8 20 8 C19 20 10 26 0 26 Z"/>
      <path d="M0 20 C-7 20 -9 12 -5 7 C-2 11 2 10 2 5 C6 9 8 13 6 16 C5 19 3 20 0 20 Z"/>'''),
    'ingot': (27, '''<path d="M-26 9 L-18 -9 H18 L26 9 Z"/><path d="M-18 -9 L-12 -3 H12 L18 -9"/>'''),
    # スライム: 利用者から提供されたフリー素材の絵(約2000×1600の座標)をなぞった線画。
    # 0.056 倍に縮めるので、線の太さはその分だけ太く指定して他の絵と揃える。
    'slime': (32, '''<g transform="scale(.056) translate(-975 -760)" stroke-width="%.1f">
      <path d="M1010 240 C1045 240 1055 290 1065 330 C1085 420 1100 500 1140 560 C1200 620 1300 650 1360 670 C1480 730 1530 850 1525 940 C1520 1080 1400 1200 1250 1240 C1100 1280 850 1285 700 1250 C540 1215 430 1100 430 950 C430 820 540 720 650 660 C750 610 840 580 890 520 C930 470 955 380 970 300 C980 260 995 240 1010 240 Z"/>
      <ellipse cx="875" cy="905" rx="92" ry="98"/><ellipse cx="1115" cy="888" rx="90" ry="95"/>
      <path d="M750 1050 C790 1020 850 1040 900 1070 C960 1100 1040 1100 1110 1080 C1170 1060 1210 1000 1255 1005 C1290 1010 1280 1060 1250 1080 C1180 1140 1080 1175 980 1170 C880 1168 780 1130 750 1095 C735 1075 740 1058 750 1050 Z"/>
      <circle cx="877" cy="907" r="37" fill="%s" fill-opacity=".9" stroke="none"/>
      <circle cx="1112" cy="890" r="35" fill="%s" fill-opacity=".9" stroke="none"/></g>''' % (STROKE / .056, '#7a5c28', '#7a5c28')),
    # 火花は塗りの小さな星
    'spark': (10, '''<path d="M0 -10 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 z" fill="#b5480f" fill-opacity=".8" stroke="none"/>'''),
}
# 1枚に置く数。スライムは見つけて楽しいくらいの数に抑える
COUNTS = {'hammer': 4, 'anvil': 3, 'flame': 4, 'ingot': 3, 'slime': 4, 'spark': 12}

# ===== 裁縫 =====
SEW_INK = '#4f4a78'     # 線の色(藍に寄せた紫。鍛冶の焦茶と見分けがつくように)
SEW_SYMBOLS = {
    # 針と、目に通した糸
    'needle': (36, '''<g transform="rotate(-28)"><path d="M-34 0 L25 -2.6 Q31 -2.6 31 0 Q31 2.6 25 2.6 Z"/>
      <ellipse cx="26" cy="0" rx="3" ry="1.1"/><path d="M27 0 C38 -9 30 -23 15 -16 C3 -10 9 5 -6 11"/></g>'''),
    # 糸巻き(上下のつばと、巻いた糸。ほどけた糸の端)
    'spool': (30, '''<rect x="-16" y="-25" width="32" height="7" rx="2"/><rect x="-16" y="18" width="32" height="7" rx="2"/>
      <rect x="-11" y="-18" width="22" height="36"/><path d="M-11 -11 L11 -7 M-11 -3 L11 1 M-11 5 L11 9 M-11 13 L11 17"/>
      <path d="M11 9 C22 10 24 20 18 26"/>'''),
    # はさみ
    'scissors': (34, '''<g transform="rotate(18)"><circle cx="-22" cy="-9" r="8"/><circle cx="-22" cy="9" r="8"/>
      <path d="M-15 -5 L31 7 M-15 5 L31 -7"/><circle cx="8" cy="0" r="1.6"/></g>'''),
    # ボタン(4つ穴)
    'button': (16, '''<circle r="15"/><circle r="10.5"/>
      <circle cx="-3.8" cy="-3.8" r="1.8"/><circle cx="3.8" cy="-3.8" r="1.8"/><circle cx="-3.8" cy="3.8" r="1.8"/><circle cx="3.8" cy="3.8" r="1.8"/>'''),
    # 指ぬき(点々のくぼみ)
    'thimble': (22, '''<path d="M-13 15 L-11 -8 Q-11 -18 0 -18 Q11 -18 11 -8 L13 15 Z"/><path d="M-16 15 H16"/>
      <path d="M-5 -9 h.1 M2 -9 h.1 M-7 -1 h.1 M0 -1 h.1 M7 -1 h.1 M-7 7 h.1 M0 7 h.1 M7 7 h.1"/>'''),
    # 布の切れ端(ピンキングばさみのぎざぎざの端と、ぬい目)
    'cloth': (36, '''<path d="M-30 -20 L-24 -25 L-18 -20 L-12 -25 L-6 -20 L0 -25 L6 -20 L12 -25 L18 -20 L24 -25 L30 -20 V22 H-30 Z"/>
      <path d="M-24 -9 H24 M-24 12 H24" stroke-dasharray="5 4"/>'''),
    'slime': (SYMBOLS['slime'][0], SYMBOLS['slime'][1].replace('#7a5c28', SEW_INK)),
    # 十字のぬい目(鍛冶の火花の代わりの小さな飾り。塗りの色を少し入れる)
    'stitch': (8, '''<path d="M-5 -5 L5 5 M5 -5 L-5 5" stroke="#a0306a" stroke-opacity=".85"/>'''),
}
SEW_COUNTS = {'needle': 4, 'spool': 3, 'scissors': 3, 'button': 4, 'thimble': 3, 'cloth': 3, 'slime': 4, 'stitch': 12}

SETS = {
    'kaji': dict(symbols=SYMBOLS, counts=COUNTS, seed=SEED, ink='#7a5c28', small='spark',
                 note='背景に敷く柄: 鍛冶の道具とスライム。数字の読みやすさを損なわないよう、ごく薄くしてある。'),
    'sew': dict(symbols=SEW_SYMBOLS, counts=SEW_COUNTS, seed=SEED + 1, ink=SEW_INK, small='stitch',
                note='背景に敷く柄(裁縫): 針・糸巻き・はさみ・ボタン・指ぬき・布とスライム。数字の読みやすさを損なわないよう、ごく薄くしてある。'),
}

def main(kind='kaji'):
    st = SETS[kind]
    symbols, counts, small = st['symbols'], st['counts'], st['small']
    rnd = random.Random(st['seed'])
    placed = []                 # (x, y, 半径)
    items = []
    order = [k for k, n in counts.items() for _ in range(n)]
    rnd.shuffle(order)
    order.sort(key=lambda k: -symbols[k][0])      # 大きい絵から先に置くと詰まりにくい
    for name in order:
        r0 = symbols[name][0]
        for _ in range(4000):
            # スライムは中で線の太さを直接指定しているので、大きさは変えない(線の太さを他と揃えるため)
            s = rnd.uniform(.8, 1.2) if name != 'slime' else 1.0
            r = r0 * s
            x, y = rnd.uniform(0, SIZE), rnd.uniform(0, SIZE)
            gap = 34 if name != small else 14
            ok = True
            for (px, py, pr) in placed:
                # 繰り返して敷いた時の隣の1枚との距離も見る(継ぎ目で重ならないように)
                dx = min(abs(x - px), SIZE - abs(x - px))
                dy = min(abs(y - py), SIZE - abs(y - py))
                if math.hypot(dx, dy) < r + pr + gap:
                    ok = False; break
            if ok:
                rot = rnd.uniform(-35, 35) if name != 'slime' else rnd.uniform(-12, 12)
                placed.append((x, y, r)); items.append((name, x, y, rot, s))
                break
        else:
            raise SystemExit(f'{name} を置く場所が見つかりませんでした')

    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">',
           '  <!-- tools/make-bg-motif.py で作成。手で直さず、スクリプトを直して作り直すこと。',
           f'       {st["note"]} -->',
           ]
    # <defs>/<use> で使い回すと、背景画像として表示した時に描かれないブラウザがあるため、
    # 絵を1つずつ直接書き出す
    out.append(f'  <g fill="none" stroke="{st["ink"]}" stroke-width="{STROKE}" stroke-linecap="round" stroke-linejoin="round" opacity=".2">')
    for name, x, y, rot, s in items:
        r = symbols[name][0] * s
        # 端にかかる絵は反対側にも描く
        xs = [x] + ([x - SIZE] if x + r > SIZE else []) + ([x + SIZE] if x - r < 0 else [])
        ys = [y] + ([y - SIZE] if y + r > SIZE else []) + ([y + SIZE] if y - r < 0 else [])
        for xx in xs:
            for yy in ys:
                # 拡大縮小しても線の太さが揃うよう、stroke-width を倍率で割り戻す
                out.append(f'    <g transform="translate({xx:.1f} {yy:.1f}) rotate({rot:.1f}) scale({s:.2f})" stroke-width="{STROKE / s:.2f}">{symbols[name][1]}</g>')
    out.append('  </g>')
    out.append('</svg>')
    print('\n'.join(out))

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'kaji')
