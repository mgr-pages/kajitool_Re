#!/usr/bin/env node
/* さいほうの推奨手の、先読みなし(ふだんの選び方)と先読みありを、同じ種で打ち比べる(作業用。遅い)。
   使い方: node tools/sew-mc.js [局数] [レシピ名,…|代表] [候補の数K] [試しの本数R] [種の始め] [針]
   レシピごとに子プロセスで並べて回す。 */
'use strict';
const path = require('path');
const os = require('os');
const { fork } = require('child_process');
const ROOT = path.join(__dirname, '..');
const REP = ['トーテムケープ上', 'トライバルトップ', '族長のバンダナ', 'ふしぎなブーツ', 'オスクトルブーツ', 'ポールスターボトム', '月影の額当て', 'ノクトルケープ上', '叡聖の博士服'];
if(process.argv[2] === '--child'){
  const AI = require(path.join(ROOT, 'sew-ai.js'));
  const { SEW_RECIPES } = require(path.join(ROOT, 'sew-recipes.js'));
  process.on('message', q => {
    const rec = SEW_RECIPES.find(r => r.name === q.name);
    const cfg = { level: 80, needle: q.needle, star: 3, kotsu: true };
    const ctx = AI.prepare(rec, cfg, {});
    const a = [], b = [];
    const t0 = Date.now();
    for(let i = 0; i < q.N; i++){
      a.push(AI.playGame(rec, cfg, q.seed + i, ctx).star === 3 ? 1 : 0);
      b.push(AI.playGame(rec, cfg, q.seed + i, ctx, { mc: { K: q.K, R: q.R } }).star === 3 ? 1 : 0);
    }
    process.send({ name: q.name, cloth: rec.cloth, n: rec.cells.length, a, b, sec: (Date.now() - t0) / 1000 / q.N });
    process.exit(0);
  });
  return;
}
const N = +(process.argv[2] || 100);
let names = process.argv[3] || '代表';
const K = +(process.argv[4] || 4), R = +(process.argv[5] || 12), seed = +(process.argv[6] || 1000), needle = process.argv[7] || 'light';
names = names === '代表' ? REP : names.split(',');
const jobs = names.slice(), res = [];
let running = 0;
const ci = (k, n) => { const p = k / n, h = 1.96 * Math.sqrt(p * (1 - p) / n); return `${(p * 100).toFixed(1)}%(${(Math.max(0, p - h) * 100).toFixed(1)}〜${(Math.min(1, p + h) * 100).toFixed(1)})`; };
function next(){
  if(!jobs.length){ if(!running) report(); return; }
  const name = jobs.shift(); running++;
  const ch = fork(__filename, ['--child']);
  ch.on('message', m => res.push(m));
  ch.on('exit', () => { running--; next(); });
  ch.send({ name, N, K, R, seed, needle });
}
function report(){
  res.sort((x, y) => names.indexOf(x.name) - names.indexOf(y.name));
  let ta = 0, tb = 0, da = 0, db = 0;
  for(const r of res){
    let sa = 0, sb = 0, oa = 0, ob = 0;
    for(let i = 0; i < r.a.length; i++){ sa += r.a[i]; sb += r.b[i]; if(r.a[i] && !r.b[i]) oa++; if(r.b[i] && !r.a[i]) ob++; }
    ta += sa; tb += sb; da += oa; db += ob;
    const z = oa + ob ? (ob - oa) / Math.sqrt(oa + ob) : 0;
    console.log(`${r.name}(${r.cloth}・${r.n}マス) ${N}局: 先読みなし ${ci(sa, N)} → あり ${ci(sb, N)}  (なしだけ ${oa}・ありだけ ${ob}、z=${z.toFixed(2)})  ${r.sec.toFixed(1)}秒/局`);
  }
  const T = N * res.length, z = da + db ? (db - da) / Math.sqrt(da + db) : 0;
  console.log(`合計 ${T}局: 先読みなし ${ci(ta, T)} → あり ${ci(tb, T)}  (なしだけ ${da}・ありだけ ${db}、z=${z.toFixed(2)})  K=${K} R=${R}`);
}
for(let k = 0; k < Math.min(os.cpus().length, jobs.length); k++) next();
