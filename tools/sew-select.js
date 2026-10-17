#!/usr/bin/env node
/* =====================================================================
   裁縫: レシピごとに、設定の組(候補)のどれが今の設定より良いかを、打ち切りありで選ぶ(全レシピへの組の割り当て用)。
   ・局を round 局ずつ区切って回す(tools/sew-batch.js)。区切りごとに、レシピ・組ごとに
     「ふだん(A)だけ★3」の数 a・「組だけ★3」の数 b を数え、次の組はそこで打つのをやめる:
       - 打ち方が1手も変わらない組(打った手の並びの指紋が、それまでの全部の局でふだんと同じ)
       - 残りの局を全部勝っても z = (b − a) / √(a + b) が zSel に届かない組
         (組だけ★3 になれるのは、ふだんが★3 でない局だけなので、残りでふだんが失敗しそうな数を上限にする)
       - z ≤ drop のはっきり悪い組
     残った組が無いレシピは、そこで打つのをやめる。
   ・最後まで残って z ≥ zSel の組のうち、z が一番大きい組をそのレシピに選ぶ(選んだ種では甘く出るので、別の種で確かめること)。
   使い方: node tools/sew-select.js 組.json [レシピ名,…|代表|all|一覧のファイル] [局数] [種] '<条件の JSON>'
     組.json: { "名前": { 設定 }, … }。条件: { needle, hs(打っている途中の必殺のチャージ), round, zSel, drop, out(結果の JSON) }
   ===================================================================== */
'use strict';
const fs = require('fs'), path = require('path');

// 1局: 候補 args.active(0 = ふだん、k = 組 k)を同じ種で打ち、[★3 なら 1, 手の並びの指紋] を返す
function play({ recipe, seed, args, cache, AI }){
  const cfg = { level: 80, needle: args.needle || 'miracle', star: 3, kotsu: true };
  if(!cache.ctx) cache.ctx = {};
  return args.active.map(k => {
    if(!cache.ctx[k]) cache.ctx[k] = AI.prepare(recipe, cfg, k === 0 ? {} : args.sets[k - 1]);
    const r = AI.playGame(recipe, cfg, seed, cache.ctx[k], { hsCharge: !!args.hs, trace: true });
    return [r.star === 3 ? 1 : 0, r.trace];
  });
}
module.exports = { play };

async function main(){
  const { runSew, recipeNames } = require('./sew-batch.js');
  const [setsF, spec, nA, seedA, condA] = process.argv.slice(2);
  const setsObj = JSON.parse(fs.readFileSync(setsF, 'utf8')), setNames = Object.keys(setsObj), sets = setNames.map(k => setsObj[k]);
  const names = spec && fs.existsSync(spec) ? fs.readFileSync(spec, 'utf8').trim().split(',') : recipeNames(spec || 'all');
  const N = +(nA || 200), seed = +(seedA || 1000), C = JSON.parse(condA || '{}');
  const round = C.round || 50, zSel = C.zSel || 2, drop = C.drop === undefined ? -1.5 : C.drop;
  const st = {};
  for(const nm of names) st[nm] = { n: 0, base: 0, baseFail: 0, trace: [], v: sets.map(() => ({ a: 0, b: 0, s: 0, same: true, live: true, why: '' })) };
  let played = 0, full = names.length * N * (sets.length + 1);
  for(let from = 0; from < N; from += round){
    const to = Math.min(N, from + round);
    const live = names.filter(nm => st[nm].v.some(x => x.live));
    if(!live.length) break;
    const argsOf = nm => ({ needle: C.needle, hs: C.hs, sets, active: [0].concat(st[nm].v.map((x, k) => x.live ? k + 1 : -1).filter(k => k > 0)) });
    const rows = await runSew({ exp: __filename, names: live, N: to, from, seed, argsOf, label: 'sew-select', quiet: true });
    for(const row of rows){
      const o = st[row.name], act = argsOf(row.name).active;
      played += row.results.length * act.length;
      for(const g of row.results){
        const [b0, h0] = g[0];
        o.n++; o.base += b0; o.baseFail += 1 - b0;
        act.slice(1).forEach((k, j) => {
          const [bk, hk] = g[j + 1], x = o.v[k - 1];
          x.s += bk; if(b0 && !bk) x.a++; if(bk && !b0) x.b++;
          if(hk !== h0) x.same = false;
        });
      }
      // 打ち切り
      const rest = N - o.n;
      const failRest = Math.min(rest, Math.ceil(rest * Math.min(1, 3 * (o.baseFail + 1) / (o.n + 2))));   // 残りでふだんが失敗しそうな数の上限(多めに見る)
      o.v.forEach(x => {
        if(!x.live) return;
        const zNow = x.a + x.b ? (x.b - x.a) / Math.sqrt(x.a + x.b) : 0;
        const bm = x.b + failRest, zMax = x.a + bm ? (bm - x.a) / Math.sqrt(x.a + bm) : 0;
        if(x.same && rest > 0){ x.live = false; x.why = '打ち方が同じ'; }
        else if(zMax < zSel){ x.live = false; x.why = '届かない'; }
        else if(zNow <= drop){ x.live = false; x.why = 'はっきり悪い'; }
      });
    }
    process.stderr.write(`  局 ${to}/${N}: 残りのレシピ ${names.filter(nm => st[nm].v.some(x => x.live)).length}・打った局 ${played}(打ち切りなしなら ${full})\n`);
  }
  const pick = {}, cnt = {};
  for(const nm of names){
    const o = st[nm];
    let best = null;
    o.v.forEach((x, k) => { if(!x.live) return; const z = x.a + x.b ? (x.b - x.a) / Math.sqrt(x.a + x.b) : 0; if(z >= zSel && (!best || z > best.z)) best = { z, k }; });
    if(best){ pick[nm] = setNames[best.k]; cnt[setNames[best.k]] = (cnt[setNames[best.k]] || 0) + 1; }
  }
  if(C.out) fs.writeFileSync(C.out, JSON.stringify({ sets: setsObj, N, seed, pick, st }, null, 0));
  const T = names.reduce((s, nm) => s + st[nm].n, 0), B = names.reduce((s, nm) => s + st[nm].base, 0);
  console.log(`${names.length}レシピ: 打った局 ${played}(打ち切りなしなら ${full}、${(played / full * 100).toFixed(0)}%)・ふだん ${(B / T * 100).toFixed(1)}%`);
  console.log(`組を選んだレシピ ${Object.keys(pick).length}: ` + Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('・'));
}
if(require.main === module) main().catch(e => { console.error(e); process.exit(1); });
