#!/usr/bin/env node
/* さいほうの推奨手の、先読みなし(ふだんの選び方)と先読みあり(chooseMC。画面では使っていない)を、同じ種で打ち比べる(作業用。遅い)。
   使い方: node tools/sew-mc.js [局数] [レシピ名,…|代表] [候補の数K] [試しの本数R] [種の始め] [針]
   回し方は tools/sew-batch.js(局を分けて重い順にコアの数で回す)。
   画面で使っている終盤の先読み(endMC)は、tools/sew-ab.js に '{"endMC":{…}}' を渡して比べる。 */
'use strict';

// 1局: [先読みなしで★3 か, 先読みありで★3 か, 先読みありの秒数]
function play({ recipe, seed, args, cache, AI }){
  const cfg = { level: 80, needle: args.needle, star: 3, kotsu: true };
  if(!cache.ctx) cache.ctx = AI.prepare(recipe, cfg, {});
  const a = AI.playGame(recipe, cfg, seed, cache.ctx).star === 3 ? 1 : 0;
  const t0 = Date.now();
  const b = AI.playGame(recipe, cfg, seed, cache.ctx, { mc: { K: args.K, R: args.R } }).star === 3 ? 1 : 0;
  return [a, b, (Date.now() - t0) / 1000];
}
module.exports = { play };

if(require.main === module){
  const { runSew, recipeNames } = require('./sew-batch.js');
  const N = +(process.argv[2] || 100);
  const names = recipeNames(process.argv[3] || '代表');
  const K = +(process.argv[4] || 4), R = +(process.argv[5] || 12), seed = +(process.argv[6] || 1000), needle = process.argv[7] || 'light';
  const ci = (k, n) => { const p = k / n, h = 1.96 * Math.sqrt(p * (1 - p) / n); return `${(p * 100).toFixed(1)}%(${(Math.max(0, p - h) * 100).toFixed(1)}〜${(Math.min(1, p + h) * 100).toFixed(1)})`; };
  runSew({ exp: __filename, names, N, seed, args: { K, R, needle }, label: 'sew-mc' }).then(rows => {
    let ta = 0, tb = 0, da = 0, db = 0;
    for(const r of rows){
      let sa = 0, sb = 0, oa = 0, ob = 0, sec = 0;
      for(const [a, b, s] of r.results){ sa += a; sb += b; sec += s; if(a && !b) oa++; if(b && !a) ob++; }
      ta += sa; tb += sb; da += oa; db += ob;
      const z = oa + ob ? (ob - oa) / Math.sqrt(oa + ob) : 0;
      console.log(`${r.name}(${r.recipe.cloth}・${r.recipe.cells.length}マス) ${N}局: 先読みなし ${ci(sa, N)} → あり ${ci(sb, N)}  (なしだけ ${oa}・ありだけ ${ob}、z=${z.toFixed(2)})  ${(sec / N).toFixed(1)}秒/局`);
    }
    const T = N * rows.length, z = da + db ? (db - da) / Math.sqrt(da + db) : 0;
    console.log(`合計 ${T}局: 先読みなし ${ci(ta, T)} → あり ${ci(tb, T)}  (なしだけ ${da}・ありだけ ${db}、z=${z.toFixed(2)})  K=${K} R=${R}`);
  }).catch(e => { console.error(e); process.exit(1); });
}
