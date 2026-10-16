#!/usr/bin/env node
/* さいほうの推奨手(sew-ai.js)の設定を、同じ種で打ち比べる(作業用)。
   使い方: node tools/sew-ab.js '<設定Aの JSON>' '<設定Bの JSON か、その配列>' [局数] [レシピ名,…|all|代表] [種の始め] [針]
     例: node tools/sew-ab.js '{"lockSlack":null}' '{}' 400 代表
         node tools/sew-ab.js '{}' '[{"etaK":0.8},{"etaK":0.6}]' 300   (A と、B のそれぞれを比べる)
   ・条件: 職人Lv80・針★3・コツあり。局ごとに種を 種の始め+局の番号 にする(A と B で同じ種)。
   ・差の判定: 片方だけ★3 の局の数 a(A だけ)・b(B だけ)から z = (b − a) / √(a + b)。|z| ≥ 2 で差ありとみる。
   ・回し方は tools/sew-batch.js(局を分けて重い順にコアの数で回す。分け方で結果は変わらない)。 */
'use strict';
const path = require('path');

// 1局: A と B のそれぞれで打ち、★3 なら 1(sew-batch.js の子プロセスで呼ばれる)
function play({ recipe, seed, args, cache, AI }){
  const cfg = { level: 80, needle: args.needle, star: 3, kotsu: true };
  if(!cache.ctx) cache.ctx = [args.A].concat(args.B).map(prm => AI.prepare(recipe, cfg, prm));
  return cache.ctx.map(ctx => AI.playGame(recipe, cfg, seed, ctx).star === 3 ? 1 : 0);
}
module.exports = { play };

if(require.main === module){
  const { runSew, recipeNames } = require('./sew-batch.js');
  const A = JSON.parse(process.argv[2] || '{}'), B0 = JSON.parse(process.argv[3] || '{}'), B = Array.isArray(B0) ? B0 : [B0];
  const N = +(process.argv[4] || 400);
  const names = recipeNames(process.argv[5] || '代表');
  const seed = +(process.argv[6] || 1000), needle = process.argv[7] || 'light';
  const ci = (k, n) => { const p = k / n, h = 1.96 * Math.sqrt(p * (1 - p) / n); return `${(p * 100).toFixed(1)}%(${(Math.max(0, p - h) * 100).toFixed(1)}〜${(Math.min(1, p + h) * 100).toFixed(1)})`; };
  runSew({ exp: __filename, names, N, seed, args: { A, B, needle }, label: 'sew-ab' }).then(rows => {
    for(let v = 0; v < B.length; v++){
      console.log(`=== A ${JSON.stringify(A)} → B ${JSON.stringify(B[v])}`);
      let ta = 0, tb = 0, da = 0, db = 0;
      for(const r of rows){
        let sa = 0, sb = 0, oa = 0, ob = 0;
        for(const g of r.results){ const a = g[0], b = g[v + 1]; sa += a; sb += b; if(a && !b) oa++; if(b && !a) ob++; }
        ta += sa; tb += sb; da += oa; db += ob;
        const z = oa + ob ? (ob - oa) / Math.sqrt(oa + ob) : 0;
        console.log(`${r.name}(${r.recipe.cloth}・${r.recipe.cells.length}マス) ${N}局: A ${ci(sa, N)} → B ${ci(sb, N)}  (A だけ ${oa}・B だけ ${ob}、z=${z.toFixed(2)})`);
      }
      const T = N * rows.length, z = da + db ? (db - da) / Math.sqrt(da + db) : 0;
      console.log(`合計 ${T}局: A ${ci(ta, T)} → B ${ci(tb, T)}  (A だけ ${da}・B だけ ${db}、z=${z.toFixed(2)})`);
    }
  }).catch(e => { console.error(e); process.exit(1); });
}
