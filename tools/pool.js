/* =====================================================================
   試験の共通の並べ方(鍛冶の成績テスト・裁縫の打ち比べ・その場の試験で使う)。
   ・仕事(job)を「重い順」に並べ、コアの数の子プロセスで回す。空いた子から次の仕事を取るので、
     最後に長い仕事が1つ残ってほかのコアが遊ぶ時間が短くなる。
   ・子プロセスは最後まで使い回す。子の中でためた表(裁縫の終盤の表・鍛冶の総当たりの表など)は、
     同じ子が次に同じレシピの仕事を受けた時にそのまま使える。
   ・仕事の重さは、前に回した時の秒数(.cache/pool-times.json)を使う。無ければ job.cost(目安)を使う。
     重さは並べる順にしか使わないので、結果は変わらない(結果は仕事ごとに決まり、親が順に並べ直す)。

   使い方(親):
     const { runPool } = require('./pool.js');
     const out = await runPool(jobs, { worker: '/絶対/パス/子.js', label: 'sim', onDone: (job, res, k) => {} });
     // jobs: [{ key: '重さを覚える名前', cost: 目安, ...子に渡す中身 }]。out[k] が jobs[k] の結果
   子のファイル: module.exports = { run(job) }。run は結果(JSON にできる値)か、その Promise を返す。
   並べる数: 既定は os.availableParallelism()(無ければ os.cpus().length)。環境変数 POOL_PROCS で変えられる。
   ===================================================================== */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

const TIMES = path.join(__dirname, '..', '.cache', 'pool-times.json');
const PROCS = () => Math.max(1, Number(process.env.POOL_PROCS) ||
  (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length));

function readTimes(){ try{ return JSON.parse(fs.readFileSync(TIMES, 'utf8')); }catch(e){ return {}; } }
function writeTimes(t){
  try{ fs.mkdirSync(path.dirname(TIMES), { recursive: true }); fs.writeFileSync(TIMES, JSON.stringify(t)); }catch(e){}
}

/* ---- 親プロセス側 ---- */
function runPool(jobs, opt){
  const label = opt.label || path.basename(opt.worker);
  const times = readTimes();
  const keyOf = j => label + '|' + (j.key !== undefined ? j.key : JSON.stringify(j));
  const weight = j => { const t = times[keyOf(j)]; return t !== undefined ? t : (j.cost || 0); };
  // 重い順(同じ重さなら元の順)
  const order = jobs.map((j, k) => k).sort((a, b) => weight(jobs[b]) - weight(jobs[a]) || a - b);
  const out = new Array(jobs.length);
  const n = Math.min(opt.procs || PROCS(), jobs.length);
  let next = 0, done = 0, failed = null, ended = false;
  if(!jobs.length) return Promise.resolve(out);
  return new Promise((resolve, reject) => {
    const kids = [];
    const finish = () => {
      if(ended) return;
      ended = true;
      for(const c of kids) c.kill();
      writeTimes(times);
      failed ? reject(failed) : resolve(out);
    };
    const give = c => {
      if(failed || next >= order.length){ c.idle = true; if(kids.every(x => x.idle)) finish(); return; }
      const k = order[next++];
      c.cur = k;
      c.send({ id: k, job: jobs[k] });
    };
    for(let i = 0; i < n; i++){
      const c = fork(__filename, ['--pool-child', opt.worker], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
                                                                execArgv: opt.execArgv || process.execArgv });
      c.on('message', m => {
        if(m.error){ failed = failed || new Error(`仕事 ${keyOf(jobs[m.id])} が失敗しました:\n${m.error}`); }
        else {
          out[m.id] = m.res;
          times[keyOf(jobs[m.id])] = Math.round(m.ms) / 1000;
          done++;
          if(opt.onDone) opt.onDone(jobs[m.id], m.res, m.id, done, jobs.length);
        }
        give(c);
      });
      c.on('exit', code => {
        if(!c.idle && !failed){ failed = new Error(`子プロセスが途中で終わりました(${code})。仕事 ${c.cur !== undefined ? keyOf(jobs[c.cur]) : '-'}`); }
        c.idle = true;
        if(kids.every(x => x.idle)) finish();
      });
      kids.push(c);
      give(c);
    }
  });
}

// 局 0〜n-1 を、size 局ずつの範囲に分ける([from, to) の組)
function chunks(n, size){
  const out = [];
  for(let a = 0; a < n; a += size) out.push([a, Math.min(n, a + size)]);
  return out;
}

module.exports = { runPool, chunks, procs: PROCS };

/* ---- 子プロセス側(仕事のファイルが、この並べ方を読み込んでも困らないよう、module.exports の後に置く) ---- */
if(require.main === module && process.argv[2] === '--pool-child'){
  const mod = require(process.argv[3]);
  process.on('message', async m => {
    const t0 = Date.now();
    try{
      const res = await mod.run(m.job);
      process.send({ id: m.id, res, ms: Date.now() - t0 });
    }catch(e){
      process.send({ id: m.id, error: String(e && e.stack || e), ms: Date.now() - t0 });
    }
  });
}
