#!/usr/bin/env node
/* さいほうの推奨手(sew-ai.js)の設定を、同じ種で打ち比べる(作業用)。
   使い方: node tools/sew-ab.js '<設定Aの JSON>' '<設定Bの JSON か、その配列>' [局数] [レシピ名,…|all|代表] [種の始め] [針]
     例: node tools/sew-ab.js '{"lockSlack":null}' '{}' 400 代表
         node tools/sew-ab.js '{}' '[{"etaK":0.8},{"etaK":0.6}]' 300   (A と、B のそれぞれを比べる)
   ・条件: 職人Lv80・針★3・コツあり。局ごとに種を 種の始め+局の番号 にする(A と B で同じ種)。
   ・差の判定: 片方だけ★3 の局の数 a(A だけ)・b(B だけ)から z = (b − a) / √(a + b)。|z| ≥ 2 で差ありとみる。
   ・レシピごとに子プロセスで並べて回す。 */
'use strict';
const path = require('path');
const os = require('os');
const { fork } = require('child_process');
const ROOT = path.join(__dirname, '..');
const REP = ['トーテムケープ上', 'トライバルトップ', '族長のバンダナ', 'ふしぎなブーツ', 'オスクトルブーツ', 'ポールスターボトム', '月影の額当て', 'ノクトルケープ上', '叡聖の博士服'];

if(process.argv[2] === '--child'){
  const AI = require(process.env.SEW_AI ? path.resolve(process.env.SEW_AI) : path.join(ROOT, 'sew-ai.js'));
  const { SEW_RECIPES } = require(path.join(ROOT, 'sew-recipes.js'));
  process.on('message', q => {
    const rec = SEW_RECIPES.find(r => r.name === q.name);
    const cfg = { level: 80, needle: q.needle, star: 3, kotsu: true };
    const out = [];
    for(const prm of [q.A].concat(q.B)){
      const ctx = AI.prepare(rec, cfg, prm);
      const res = [];
      for(let i = 0; i < q.N; i++){ const r = AI.playGame(rec, cfg, q.seed + i, ctx); res.push(r.star === 3 ? 1 : 0); }
      out.push(res);
    }
    process.send({ name: q.name, cloth: rec.cloth, n: rec.cells.length, out });
    process.exit(0);
  });
  return;
}
const A = JSON.parse(process.argv[2] || '{}'), B0 = JSON.parse(process.argv[3] || '{}'), B = Array.isArray(B0) ? B0 : [B0];
const N = +(process.argv[4] || 400);
let names = process.argv[5] || '代表';
const seed = +(process.argv[6] || 1000), needle = process.argv[7] || 'light';
if(names === '代表') names = REP;
else if(names === 'all') names = require(path.join(ROOT, 'sew-recipes.js')).SEW_RECIPES.filter(r => r.craftLevel >= 30).map(r => r.name);
else names = names.split(',');
const jobs = names.slice(), res = [];
let running = 0;
const P = Math.max(1, os.cpus().length);
const ci = (k, n) => { const p = k / n, h = 1.96 * Math.sqrt(p * (1 - p) / n); return `${(p * 100).toFixed(1)}%(${(Math.max(0, p - h) * 100).toFixed(1)}〜${(Math.min(1, p + h) * 100).toFixed(1)})`; };
function next(){
  if(!jobs.length){ if(!running) report(); return; }
  const name = jobs.shift(); running++;
  const ch = fork(__filename, ['--child']);
  ch.on('message', m => { res.push(m); });
  ch.on('exit', () => { running--; next(); });
  ch.send({ name, A, B, N, seed, needle });
}
function report(){
  res.sort((x, y) => names.indexOf(x.name) - names.indexOf(y.name));
  for(let v = 0; v < B.length; v++){
    console.log(`=== A ${JSON.stringify(A)} → B ${JSON.stringify(B[v])}`);
    let ta = 0, tb = 0, da = 0, db = 0;
    for(const r of res){
      const a = r.out[0], b = r.out[v + 1];
      let sa = 0, sb = 0, oa = 0, ob = 0;
      for(let i = 0; i < a.length; i++){ sa += a[i]; sb += b[i]; if(a[i] && !b[i]) oa++; if(b[i] && !a[i]) ob++; }
      ta += sa; tb += sb; da += oa; db += ob;
      const z = oa + ob ? (ob - oa) / Math.sqrt(oa + ob) : 0;
      console.log(`${r.name}(${r.cloth}・${r.n}マス) ${N}局: A ${ci(sa, N)} → B ${ci(sb, N)}  (A だけ ${oa}・B だけ ${ob}、z=${z.toFixed(2)})`);
    }
    const T = N * res.length, z = da + db ? (db - da) / Math.sqrt(da + db) : 0;
    console.log(`合計 ${T}局: A ${ci(ta, T)} → B ${ci(tb, T)}  (A だけ ${da}・B だけ ${db}、z=${z.toFixed(2)})`);
  }
}
for(let k = 0; k < Math.min(P, jobs.length); k++) next();
