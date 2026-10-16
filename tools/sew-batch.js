#!/usr/bin/env node
/* =====================================================================
   裁縫の試験を、共通の並べ方(tools/pool.js)で回す。打ち比べ(sew-ab.js・sew-mc.js)と、その場で書く試験の両方で使う。
   レシピごとの局を何局かずつの仕事に分け、重い順にコアの数の子プロセスで回す。局の結果は種(種の始め + 局の番号)だけで
   決まるので、どう分けても結果は同じ。子は使い回すので、準備(表づくり)は「子 × レシピ」ごとに1回で済む。

   その場の試験の書き方(試験のファイルはどこに置いてもよい):
     module.exports = {
       // 1局を打って結果を返す(JSON にできる値)。cache は、この子プロセスの中でレシピごとに使い回せる入れ物
       play({ recipe, seed, args, cache, SEW, AI }) { ... },
       // 全部そろった後に親で呼ぶ。rows: [{ name, recipe, results: [局 0 の結果, 局 1 の結果, …] }](レシピは指定の順)
       report(rows, args) { ... },
     };
   使い方: node tools/sew-batch.js <試験のファイル> [レシピ名,…|代表|all] [局数] [種の始め] ['<JSON の引数>']
   ・条件(職人Lv・針など)は試験の側で決める。既定の推奨手は sew-ai.js(環境変数 SEW_AI で作業用の写しに替えられる)。
   ・1つの仕事の局数は自動で決める(コアの数の6倍ほどの仕事になるように)。環境変数 POOL_CHUNK で指定もできる。
   ===================================================================== */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const REP = ['トーテムケープ上', 'トライバルトップ', '族長のバンダナ', 'ふしぎなブーツ', 'オスクトルブーツ', 'ポールスターボトム', '月影の額当て', 'ノクトルケープ上', '叡聖の博士服'];

/* ---- 子プロセス側(tools/pool.js から require される) ---- */
let LIB = null;
const CACHES = new Map();          // 試験のファイル|レシピ → cache(子の中で使い回す)
function lib(){
  if(LIB) return LIB;
  const SEW = require(path.join(ROOT, 'sew-engine.js'));
  const AI = require(process.env.SEW_AI ? path.resolve(process.env.SEW_AI) : path.join(ROOT, 'sew-ai.js'));
  const { SEW_RECIPES } = require(path.join(ROOT, 'sew-recipes.js'));
  return (LIB = { SEW, AI, SEW_RECIPES });
}
function run(job){
  const { SEW, AI, SEW_RECIPES } = lib();
  const exp = require(job.exp);
  const recipe = SEW_RECIPES.find(r => r.name === job.name);
  if(!recipe) throw new Error('レシピが見つかりません: ' + job.name);
  const ck = job.exp + '|' + job.name;
  if(!CACHES.has(ck)) CACHES.set(ck, {});
  const cache = CACHES.get(ck), results = [];
  for(let i = job.from; i < job.to; i++) results.push(exp.play({ recipe, seed: job.seed + i, args: job.args, cache, SEW, AI }));
  return { name: job.name, from: job.from, results };
}

/* ---- 親プロセス側 ---- */
function recipeNames(spec){
  if(!spec || spec === '代表') return REP.slice();
  if(spec === 'all') return lib().SEW_RECIPES.filter(r => r.craftLevel >= 30).map(r => r.name);
  return spec.split(',');
}
// exp: 試験のファイルの絶対パス。戻り値は rows(report に渡す形)
async function runSew({ exp, names, N, seed, args, label, quiet }){
  const { runPool, chunks, procs } = require('./pool.js');
  const { SEW_RECIPES } = lib();
  const recipes = names.map(n => { const r = SEW_RECIPES.find(x => x.name === n); if(!r) throw new Error('レシピが見つかりません: ' + n); return r; });
  const per = Math.max(1, Math.ceil(procs() * 6 / recipes.length));
  const size = Number(process.env.POOL_CHUNK) || Math.max(5, Math.ceil(N / per));
  const jobs = [];
  for(const r of recipes) for(const [from, to] of chunks(N, size))
    // 重さの目安: マスの数が多いほど重い(終盤の表と先読み)。前に回した時の秒数があればそちらを使う
    jobs.push({ key: [path.basename(exp), JSON.stringify(args), r.name, from, to].join('|'), cost: (to - from) * r.cells.length * r.cells.length,
                exp, name: r.name, from, to, seed, args });
  const t0 = Date.now();
  if(!quiet) process.stderr.write(`${jobs.length}個の仕事(${size}局ずつ)を ${Math.min(procs(), jobs.length)}並列で回します…\n`);
  const out = await runPool(jobs, { worker: __filename, label: label || 'sew-batch',
    onDone: (j, res, k, done, all) => { if(!quiet && (done % Math.max(1, Math.floor(all / 10)) === 0 || done === all)) process.stderr.write(`  ${done}/${all}\n`); } });
  const rows = recipes.map(r => ({ name: r.name, recipe: r, results: new Array(N) }));
  out.forEach(o => { const row = rows[names.indexOf(o.name)]; o.results.forEach((v, i) => { row.results[o.from + i] = v; }); });
  if(!quiet) process.stderr.write(`所要 ${Math.round((Date.now() - t0) / 1000)}秒\n`);
  return rows;
}

module.exports = { run, runSew, recipeNames, REP };

if(require.main === module){
  const [expArg, spec, nArg, seedArg, argsArg] = process.argv.slice(2);
  if(!expArg){ console.error('使い方: node tools/sew-batch.js <試験のファイル> [レシピ名,…|代表|all] [局数] [種の始め] [\'<JSON の引数>\']'); process.exit(2); }
  const exp = path.resolve(expArg), args = argsArg ? JSON.parse(argsArg) : {};
  const names = recipeNames(spec), N = +(nArg || 300), seed = +(seedArg || 1000);
  runSew({ exp, names, N, seed, args }).then(rows => {
    const m = require(exp);
    if(m.report) m.report(rows, args);
    else for(const r of rows) console.log(r.name, JSON.stringify(r.results));
  }).catch(e => { console.error(e); process.exit(1); });
}
