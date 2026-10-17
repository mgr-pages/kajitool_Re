#!/usr/bin/env node
/* =====================================================================
   鍛冶: 商材ごとに、今の重みを少しずつ変えた案(候補)のどれが良いかを、打ち切りありで選ぶ(先読みなし・乱数テープ)。
   ・候補は商材ごとに作る: 重みを1つずつ ×0・×0.5・×1.5・×2(0 の重みは決めた値)、重みの組(ITEM_PARAMS)への置き換え、
     技を使わない設定(ban)。候補の重みは今の重み(商材の params)に重ねる。
   ・局を区切って回す(tools/kaji-batch.js)。区切りごとに「今の重みだけ大成功」a・「候補だけ大成功」b を数え、
     打ち方が1手も変わらない候補・残りを全部勝っても z = (b − a) / √(a + b) が zSel に届かない候補・z ≤ drop の候補・
     今の z のまま最後まで打った時の見込み(z × √(最後の局数 / 今の局数))が fut に届かない候補は、そこで打つのをやめる。
   ・最後まで残って z ≥ zSel の候補のうち、z が一番大きい候補を選ぶ(選んだ種では甘く出るので、別の種で確かめること)。
   使い方: node tools/kaji-select.js 商材,… [局数] [種] '<条件の JSON>'
     条件: { hammer, rounds(区切りの局数の並び。既定 [50,100,100,150]), zSel, drop, fut, start(商材 → 始めの重みの上書き), out }
   ===================================================================== */
'use strict';
const fs = require('fs'), path = require('path');

// 0 の重みに試す値と、1つずつ変える重み
const ZERO_TRY = { tcost: [0.01, 0.017, 0.03], midare: [1], midareW: [1, 2], mdc: [0.5], boostEff: [2, 4, 8], psEff: [2, 4, 8],
                   litReady: [16, 32], boostPlan: [1], save: [12, 25], turn: [2, 5], center: [1.5, 3], far: [2.5, 5], te: [2.5, 5] };
const KEYS = ['cap', 'adv', 'land', 'heat', 'ov', 'pr', 'te', 'rush', 'save', 'turn', 'center', 'far', 'mpm', 'slack', 'effK', 'slackMax',
              'wideAim', 'pairSnipe', 'boostPlan', 'saveCap', 'boostAim', 'boostRes', 'opening', 'tatakiFit', 'x2turn', 'aimNow', 'aimRes',
              'tcost', 'midare', 'midareW', 'mdc', 'litReady', 'boostEff', 'psEff', 'tmax'];
const BANS = [['reppuu'], ['midare'], ['hiyashikomi'], ['naname'], ['chouyonren'], ['yowanerai'], ['jouge_nerai'], ['karyoku']];

// 商材の今の重み(既定 + 商材の params + start)から候補を作る。戻り値: [{ name, p(重ねる重み) }]
function candidatesFor(E, item, start){
  const BASE = E('BASE_PARAMS'), PR = E('PRESETS')[item], IP = E('ITEM_PARAMS');
  const cur = Object.assign({}, BASE, PR.params || {}, start || {});
  const out = [], seen = new Set();
  const add = (name, p) => { const k = JSON.stringify(p); if(!seen.has(k)){ seen.add(k); out.push({ name, p }); } };
  for(const k of KEYS){
    const v = cur[k] === undefined ? 0 : cur[k];
    const vals = v === 0 ? (ZERO_TRY[k] || []) : [0, v * 0.5, v * 1.5, v * 2];
    for(const x of vals){ const y = Math.round(x * 10000) / 10000; if(y !== v) add(`${k}=${y}`, Object.assign({}, start || {}, { [k]: y })); }
  }
  // 重みの組へ置き換え(今の商材の params の鍵で、組に無いものは既定に戻す)
  for(const [nm, set] of Object.entries(IP)){
    const p = {};
    for(const k of Object.keys(Object.assign({}, PR.params || {}, start || {}))) p[k] = BASE[k];
    Object.assign(p, set);
    add(`組${nm}`, p);
  }
  for(const b of BANS) add(`ban ${b.join('+')}`, Object.assign({}, start || {}, { ban: b }));
  return out;
}

async function main(){
  const { runKaji } = require('./kaji-batch.js');
  const A = require('./analyze.js');
  const E = A.loadEngine({ seed: 1 });
  const [itemsA, nA, seedA, condA] = process.argv.slice(2);
  const items = itemsA.split(','), N = +(nA || 400), seed = +(seedA || 101), C = JSON.parse(condA || '{}');
  const rounds = C.rounds || [50, 100, 100, 150], zSel = C.zSel || 2, drop = C.drop === undefined ? -1.5 : C.drop, fut = C.fut === undefined ? 1.0 : C.fut;
  const start = C.start || {};
  const st = {};
  for(const it of items){
    const cands = candidatesFor(E, it, start[it]);
    st[it] = { n: 0, base: 0, fail: 0, cands, v: cands.map(() => ({ a: 0, b: 0, s: 0, same: true, live: true, why: '' })) };
  }
  let played = 0, full = items.reduce((s, it) => s + N * (st[it].cands.length + 1), 0), from = 0;
  for(const r of rounds){
    if(from >= N) break;
    const to = Math.min(N, from + r);
    const live = items.filter(it => st[it].v.some(x => x.live));
    if(!live.length) break;
    const act = {};
    for(const it of live) act[it] = st[it].v.map((x, k) => x.live ? k : -1).filter(k => k >= 0);
    const rows = await runKaji({ items: live, N: to, from, seed, hammer: C.hammer, label: 'kaji-select', quiet: true,
      variantsOf: it => [start[it] || {}].concat(act[it].map(k => st[it].cands[k].p)) });
    for(const it of live){
      const o = st[it], ks = act[it];
      played += rows[it].length * (ks.length + 1);
      for(const g of rows[it]){
        const b0 = g[0].great, h0 = g[0].trace;
        o.n++; o.base += b0; o.fail += 1 - b0;
        ks.forEach((k, j) => { const x = o.v[k], bk = g[j + 1].great; x.s += bk; if(b0 && !bk) x.a++; if(bk && !b0) x.b++; if(g[j + 1].trace !== h0) x.same = false; });
      }
      const rest = N - o.n;
      const failRest = Math.min(rest, Math.ceil(rest * Math.min(1, 3 * (o.fail + 1) / (o.n + 2))));
      for(const k of ks){
        const x = o.v[k];
        const zNow = x.a + x.b ? (x.b - x.a) / Math.sqrt(x.a + x.b) : 0, bm = x.b + failRest, zMax = x.a + bm ? (bm - x.a) / Math.sqrt(x.a + bm) : 0;
        if(x.same && rest > 0){ x.live = false; x.why = '打ち方が同じ'; }
        else if(zMax < zSel){ x.live = false; x.why = '届かない'; }
        else if(zNow <= drop){ x.live = false; x.why = 'はっきり悪い'; }
        else if(fut !== null && rest > 0 && zNow * Math.sqrt(N / o.n) < fut){ x.live = false; x.why = '見込みが低い'; }
      }
    }
    from = to;
    process.stderr.write(`  局 ${to}/${N}: 残りの候補 ${items.reduce((s, it) => s + st[it].v.filter(x => x.live).length, 0)}・打った局 ${played}(打ち切りなしなら ${full})\n`);
  }
  const pick = {};
  for(const it of items){
    const o = st[it];
    let best = null;
    o.v.forEach((x, k) => { if(!x.live) return; const z = x.a + x.b ? (x.b - x.a) / Math.sqrt(x.a + x.b) : 0; if(z >= zSel && (!best || z > best.z)) best = { z, k, x }; });
    const top = o.v.map((x, k) => ({ k, x, z: x.a + x.b ? (x.b - x.a) / Math.sqrt(x.a + x.b) : 0 })).filter(y => y.x.live).sort((a, b) => b.z - a.z).slice(0, 3);
    console.log(`${it}: 今 ${(o.base / o.n * 100).toFixed(1)}%(${o.n}局)` + (best ? ` → ${o.cands[best.k].name} ${(best.x.s / o.n * 100).toFixed(1)}%(今だけ ${best.x.a}・案だけ ${best.x.b}、z=${best.z.toFixed(2)})` : ' → 選ぶ案なし') +
      (top.length ? `  [残った上位: ${top.map(y => `${o.cands[y.k].name} z=${y.z.toFixed(2)}`).join('・')}]` : ''));
    if(best) pick[it] = { name: o.cands[best.k].name, p: o.cands[best.k].p, z: best.z };
  }
  console.log(`打った局 ${played}(打ち切りなしなら ${full}、${(played / full * 100).toFixed(0)}%)`);
  if(C.out) fs.writeFileSync(C.out, JSON.stringify({ N, seed, pick, st: Object.fromEntries(Object.entries(st).map(([k, o]) => [k, { n: o.n, base: o.base, v: o.v.map((x, i) => Object.assign({ name: o.cands[i].name }, x)) }])) }));
}
if(require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { candidatesFor };
