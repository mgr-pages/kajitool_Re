#!/usr/bin/env node
/* =====================================================================
   鍛冶の打ち比べ(先読みなし)を、共通の並べ方(tools/pool.js)で回す。1局の打ち方は tools/analyze.js と同じ。
   商材ごとの局を何局かずつの仕事に分け、重い順にコアの数の子プロセスで回す。局の結果は種と局の番号だけで
   決まる(analyze.js の --from と同じ)ので、どう分けても結果は同じ。
   1つの仕事の中で、同じ局を A と B(複数可)の重みで続けて打つ(同じ局どうしで比べる)。

   使い方: node tools/kaji-batch.js '<A の重み>' '<B の重みか、その配列>' [局数] [商材,…] [種] [置き換え 0|1]
     ・重みは商材の params に重ねる(置き換え 1 なら、商材の params を置き換える。analyze.js の --replace と同じ)。
     ・乱数テープ(analyze.js の --tape 1)で打つ。職人Lv80・光のハンマー★3(analyze.js と同じ)。
     例: node tools/kaji-batch.js '{}' '[{"cap":18},{"cap":30}]' 1000 機甲兵のレシーバー,ラッシュグローブ 44
   差の判定: 片方だけ大成功の局の数 a(A だけ)・b(B だけ)から z = (b − a) / √(a + b)。
   ===================================================================== */
'use strict';
const path = require('path');

/* ---- 子プロセス側 ---- */
let ENG = null;
const ORIG = new Map();     // 商材 → 元の params(重ねる時の元)
function engine(){
  if(ENG) return ENG;
  const A = require('./analyze.js');
  const E = A.loadEngine({ seed: 1 });
  return (ENG = { A, E });
}
async function run(job){
  const { A, E } = engine();
  const PR = E('PRESETS')[job.preset];
  if(!PR) throw new Error('商材が見つかりません: ' + job.preset);
  if(!ORIG.has(job.preset)) ORIG.set(job.preset, PR.params || null);
  const orig = ORIG.get(job.preset) || {};
  const out = [];
  for(let g = job.from; g < job.to; g++){
    const row = [];
    for(const p of job.variants){
      PR.params = job.replace ? p : Object.assign({}, orig, p);
      const o = { preset: job.preset, seed: job.seed, tape: 1, mode: 'greedy', fork: 0, hs0: 0, hsp: 0, hsAt: -1, hsNow: 0 };
      const r = await A.playGame(E, o, g);
      row.push({ great: r.great ? 1 : 0, reached: r.reached ? 1 : 0, over: r.over ? 1 : 0, err: r.err, focus: r.focusLeft });
    }
    out.push(row);
  }
  PR.params = ORIG.get(job.preset);
  return { preset: job.preset, from: job.from, out };
}

/* ---- 親プロセス側 ---- */
// 戻り値: { 商材: [局 0 の [A の結果, B1 の結果, …], 局 1 …] }
async function runKaji({ items, N, seed, variants, replace, label, quiet }){
  const { runPool, chunks, procs } = require('./pool.js');
  const per = Math.max(1, Math.ceil(procs() * 8 / items.length));
  const size = Number(process.env.POOL_CHUNK) || Math.max(5, Math.min(100, Math.ceil(N / per)));
  const jobs = [];
  for(const it of items) for(const [from, to] of chunks(N, size))
    jobs.push({ key: [it, JSON.stringify(variants), replace ? 1 : 0, seed, from, to].join('|'), cost: (to - from) * variants.length,
                preset: it, from, to, seed, variants, replace: !!replace });
  const t0 = Date.now();
  if(!quiet) process.stderr.write(`${jobs.length}個の仕事(${size}局ずつ)を ${Math.min(procs(), jobs.length)}並列で回します…\n`);
  const res = await runPool(jobs, { worker: __filename, label: label || 'kaji-batch',
    onDone: (j, r, k, done, all) => { if(!quiet && (done % Math.max(1, Math.floor(all / 10)) === 0 || done === all)) process.stderr.write(`  ${done}/${all}\n`); } });
  const rows = {};
  for(const it of items) rows[it] = new Array(N);
  res.forEach(r => r.out.forEach((v, i) => { rows[r.preset][r.from + i] = v; }));
  if(!quiet) process.stderr.write(`所要 ${Math.round((Date.now() - t0) / 1000)}秒\n`);
  return rows;
}

module.exports = { run, runKaji };

if(require.main === module){
  const [aJ, bJ, nA, itemsA, seedA, repA] = process.argv.slice(2);
  if(!itemsA){ console.error("使い方: node tools/kaji-batch.js '<A>' '<B か配列>' 局数 商材,… [種] [置き換え 0|1]"); process.exit(2); }
  const A = JSON.parse(aJ || '{}'), B0 = JSON.parse(bJ || '{}'), B = Array.isArray(B0) ? B0 : [B0];
  const N = +(nA || 500), items = itemsA.split(','), seed = +(seedA || 44), replace = repA === '1';
  const ci = (k, n) => { const p = k / n, h = 1.96 * Math.sqrt(p * (1 - p) / n); return `${(p * 100).toFixed(1)}%(${(Math.max(0, p - h) * 100).toFixed(1)}〜${(Math.min(1, p + h) * 100).toFixed(1)})`; };
  runKaji({ items, N, seed, variants: [A].concat(B), replace }).then(rows => {
    for(let v = 0; v < B.length; v++){
      console.log(`=== A ${JSON.stringify(A)} → B ${JSON.stringify(B[v])}${replace ? '(置き換え)' : ''}`);
      let ta = 0, tb = 0, da = 0, db = 0, T = 0;
      for(const it of items){
        let sa = 0, sb = 0, oa = 0, ob = 0, ua = 0, ub = 0;
        for(const g of rows[it]){ const a = g[0].great, b = g[v + 1].great; sa += a; sb += b; if(a && !b) oa++; if(b && !a) ob++; ua += 1 - g[0].reached; ub += 1 - g[v + 1].reached; }
        ta += sa; tb += sb; da += oa; db += ob; T += N;
        const z = oa + ob ? (ob - oa) / Math.sqrt(oa + ob) : 0;
        console.log(`${it} ${N}局: A ${ci(sa, N)} → B ${ci(sb, N)}  (A だけ ${oa}・B だけ ${ob}、z=${z.toFixed(2)}・未到達 ${ua} → ${ub})`);
      }
      const z = da + db ? (db - da) / Math.sqrt(da + db) : 0;
      if(items.length > 1) console.log(`合計 ${T}局: A ${ci(ta, T)} → B ${ci(tb, T)}  (A だけ ${da}・B だけ ${db}、z=${z.toFixed(2)})`);
    }
  }).catch(e => { console.error(e); process.exit(1); });
}
