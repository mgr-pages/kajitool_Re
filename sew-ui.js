/* =====================================================================
   裁縫の画面(sew.html)
   ・ルールは sew-engine.js(SEW)、推奨手は sew-ai.js(SEW_AI)、レシピは sew-recipes.js(SEW_RECIPES)。
   ・ゲームで起きたこと(ぬいパワー・布の特性・縫った後の残り)を入れてもらい、エンジンの局面(g)を進める。
     乱数は使わない(SEW.startTurn・SEW.applyMove)。
   ・1ターンの流れ:
       1. ターンの始め: ぬいパワーが決まっていなければ選んでもらう(「？」・シフトの後)。
          布の特性のターン(5・9・13…)なら、再生したマスの残り・光ったマスを入れてもらう。
       2. 入力がそろったら推奨手を自動で計算して出す。
       3. 「使った」を押したら、当たったマスの新しい残りを入れてもらう(候補を出す)。そろったら次のターンへ。
   ・ゲームの盤面の数字は「残り」(基準値 − 縫った量。縫うと減り、ちょうどで0、縫いすぎるとマイナス)。
   ・対局の記録は鍛冶と同じ送り先に送る(gamelog.js の GLOG_QUEUE に貯めて GameLog.flush)。画面には出さない。
   ===================================================================== */
'use strict';

const SKEY = 'sewAdvisorStateV1';
const SEW_LOG_CUR = 'sewAdvisorLogCurV1';
// 終盤の際どい判断の試し打ち(sew-ai.js の chooseEndMC)。引き継ぎ資料の 9-4
// ms: 1手の試し打ちの時間の上限(遅い端末で待たせすぎないため。上限に届かなければ、上限なしと同じ手)
const SEW_AI_PARAMS = { endMC: { K: 3, R: 32, z: 2, lo: 0.02, hi: 0.98, gap: 0.1, seed: 1, ms: 5000 } };
const CAT_JA = { head: 'アタマ', body_upper: 'からだ上', body_lower: 'からだ下', arm: 'ウデ', leg: '足' };
const CAT_ORDER = ['body_upper', 'body_lower', 'head', 'arm', 'leg'];
const CLOTH_JA = { normal: '通常の布', regen: '再生布', rainbow: '虹布', light: '光布' };
const CLOTH_SHORT = { normal: '通常', regen: '再生', rainbow: '虹', light: '光' };
const POW_SHORT = { weak: '弱', normal: '普', strong: '強', strongest: '最', critx2: '会', unknown: '？' };

/* ===== 状態 ===== */
// S.g はエンジンの局面(SEW.newGame の形)。保存する時はレシピを番号にして持つ
let S = null;
function defaultState(){
  return { recipeId: null, level: 80, needle: 'light', star: 3, kotsu: true,
           g: null, phase: 'none', turnIn: null, rec: null, move: null, pend: [], obs: {}, undo: [], msg: null };
}
function cfgOf(){ return { level: S.level, needle: S.needle, star: S.star, kotsu: S.kotsu }; }
function recipeOf(id){ return SEW_RECIPES.find(r => r.id === id) || null; }
function rem(i){ return S.g.base[i] - S.g.cum[i]; }
function cellName(i){ return 'マス' + (i + 1); }

function save(){
  try{
    const g = S.g ? Object.assign({}, S.g, { recipe: undefined }) : null;
    const undo = S.undo.map(u => Object.assign({}, u, { g: u.g ? Object.assign({}, u.g, { recipe: undefined }) : null }));
    localStorage.setItem(SKEY, JSON.stringify(Object.assign({}, S, { g, undo })));
  }catch(e){}
}
function load(){
  S = defaultState();
  let d = null; try{ d = JSON.parse(localStorage.getItem(SKEY)); }catch(e){}
  if(!d) return;
  Object.assign(S, d);
  const rec = recipeOf(S.recipeId);
  if(!rec){ S.g = null; S.phase = 'none'; S.undo = []; return; }
  if(S.g) S.g.recipe = rec;
  for(const u of S.undo) if(u.g) u.g.recipe = rec;
}

/* ===== 対局の記録(鍛冶と同じ送り先。画面には出さない) ===== */
const SewLog = (function(){
  const rd = k => { try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } };
  const wr = (k, v) => { try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };
  function rid(){ const a = new Uint8Array(8); (self.crypto || window.crypto).getRandomValues(a); return [...a].map(x => x.toString(16).padStart(2, '0')).join(''); }
  function device(){
    let d = null; try{ d = localStorage.getItem(GLOG_DEV); }catch(e){}
    if(!d){ d = rid(); try{ localStorage.setItem(GLOG_DEV, d); }catch(e){} }
    return d;
  }
  function snap(){ return S.g ? { turn: S.g.turn + 1, focus: S.g.focus, rems: S.g.base.map((b, i) => b - S.g.cum[i]) } : null; }
  let cur = rd(SEW_LOG_CUR);
  function ensure(){
    if(cur) return cur;
    const r = S.g.recipe, T = ((r.oldLimit && SEW.EVAL_OLD[S.g.n]) || SEW.EVAL[S.g.n]).star3;
    cur = { craft: 'sew', id: rid(), device: device(), started: new Date().toISOString(),
            version: (document.title.match(/V[\d.]+/) || [''])[0],
            // 鍛冶の記録と同じ列に入るように名前をそろえる(素材 = レシピ・地金特性 = 布・ハンマー = 針・許容誤差 = ★3 の上限)
            preset: r.name, recipeId: r.id, trait: CLOTH_JA[r.cloth], level: S.level, hammer: SEW.NEEDLES[S.needle].name + 'の針',
            star: S.star, kotsu: S.kotsu, threshold: T,
            env: (typeof navigator !== 'undefined') ? glogEnv(navigator.userAgent, navigator.maxTouchPoints) : null,
            zones: [], steps: [] };
    return cur;
  }
  function ev(type, data){
    if(!cur && type !== 'move') return;      // 打ち始める前の操作は記録しない
    ensure().steps.push(Object.assign({ t: type, at: snap() }, data || {}));
    wr(SEW_LOG_CUR, cur);
  }
  function active(){ return !!cur; }
  function finish(outcome){
    if(!cur) return;
    const s = snap() || {};
    const rec = Object.assign(cur, { outcome, finished: new Date().toISOString(),
      // 鍛冶の記録の「最後の温度」の列には、終えたターンを入れる
      final: { focus: s.focus, temp: s.turn, masses: s.rems || [] },
      reached: S.g ? S.g.base.every((b, i) => Math.abs(b - S.g.cum[i]) <= SEW.P.yellow) : false });
    cur = null; wr(SEW_LOG_CUR, null);
    const q = (rd(GLOG_QUEUE) || []).concat([rec]).slice(-GLOG_MAXQ);
    wr(GLOG_QUEUE, q);
    GameLog.flush();
  }
  return { ev, active, finish };
})();

/* ===== 推奨手の計算(Worker が使えればそちらで。ファイルを直接開いた時などは画面側で) =====
   Worker は端末の論理コア数(最大8)だけ作る。1つ目の Worker が試し打ちの手前まで計算し(SEW_AI.plan)、
   試し打ちが要る時は、本数を Worker で分けて打ち(SEW_AI.mcRuns)、画面側で同じ決まり(SEW_AI.mcPick・mcAlive)で選ぶ。
   本数が同じなら、1つで計算した時と同じ手になる。時間の上限(設定の ms)を過ぎたら、そこまでの本数で選ぶ。
   Worker が使えない・途中で失敗した時は、画面側で計算する(遅く、計算中は画面が止まる)。 */
const AI = (function(){
  let workers = null, seq = 0;
  const wait = new Map();
  const ctxCache = new Map();
  function fail(){
    if(workers) workers.forEach(w => { try{ w.terminate(); }catch(e){} });
    workers = null;
    for(const w of wait.values()) w({ error: 'worker' });
    wait.clear();
  }
  try{
    const me = document.querySelector('script[src^="sew-ui.js"]');
    const v = me ? (me.getAttribute('src').split('?v=')[1] || '') : '';
    if(location.protocol !== 'file:' && typeof Worker !== 'undefined'){
      const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
      workers = [];
      for(let k = 0; k < Math.max(1, Math.min(8, hc)); k++){
        const w = new Worker('sew-worker.js' + (v ? '?v=' + v : ''));
        w.onmessage = e => { const f = wait.get(e.data.id); if(f){ wait.delete(e.data.id); f(e.data); } };
        w.onerror = e => { if(e && e.preventDefault) e.preventDefault(); fail(); };
        workers.push(w);
      }
    }
  }catch(e){ fail(); }
  function local(g, cfg){
    const key = [g.recipe.id, cfg.level, cfg.needle, cfg.star, cfg.kotsu ? 1 : 0].join('/');
    let ctx = ctxCache.get(key);
    if(!ctx){ ctx = SEW_AI.prepare(g.recipe, cfg, SEW_AI_PARAMS); ctxCache.set(key, ctx); }
    return SEW_AI.choose(SEW.cloneGame(g), cfg, ctx);
  }
  function call(w, msg){
    return new Promise((res, rej) => {
      const id = ++seq;
      wait.set(id, d => d.error ? rej(new Error(d.error)) : res(d));
      w.postMessage(Object.assign({ id }, msg));
    });
  }
  // 試し打ち: 本数の番号 j を Worker に分け、各 Worker は受け持ちの j について候補 ks をすべて打つ
  async function runMC(base, req){
    const { cands, P, h } = req, W = workers.length, t0 = Date.now();
    const res = cands.map(() => []);
    const deal = async (ks, j0, j1) => {
      const js = []; for(let j = j0; j < j1; j++) js.push(j);
      const per = Math.ceil(js.length / W);
      const parts = await Promise.all(workers.map((w, i) => {
        const part = js.slice(i * per, (i + 1) * per);
        return part.length ? call(w, Object.assign({ type: 'runs', cands, h, ks, js: part }, base)).then(r => ({ part, out: r.out })) : null;
      }));
      for(const p of parts) if(p) ks.forEach((k, a) => p.part.forEach((j, b) => { res[k][j] = p.out[a][b]; }));
    };
    if(!P.batch){
      const all = cands.map((c, k) => k);
      let n = 0;
      while(n < P.R){
        const to = Math.min(P.R, n + W * 2);
        await deal(all, n, to); n = to;
        if(P.ms && Date.now() - t0 > P.ms) break;
      }
      return SEW_AI.mcPick(cands, res, n, P, null);
    }
    let alive = cands.map((c, k) => k).slice(1), n = 0;
    while(n < P.R && alive.length){
      const to = Math.min(P.R, n + P.batch);
      await deal([0].concat(alive), n, to); n = to;
      alive = SEW_AI.mcAlive(alive, res, n, P);
      if(P.ms && Date.now() - t0 > P.ms) break;
    }
    return SEW_AI.mcPick(cands, res, n, P, alive);
  }
  async function choose(g, cfg){
    if(!workers) return local(g, cfg);
    const base = { recipeId: g.recipe.id, cfg, prm: SEW_AI_PARAMS, g: Object.assign({}, g, { recipe: undefined }) };
    try{
      const { plan } = await call(workers[0], Object.assign({ type: 'plan' }, base));
      return plan.req ? await runMC(base, plan.req) : plan.move;
    }catch(e){
      console.warn('推奨手の並列計算に失敗したため、画面側で計算します:', e.message);
      fail();
      return local(g, cfg);
    }
  }
  function info(){ return { workers: workers ? workers.length : 0 }; }
  return { choose, info };
})();

/* ===== 対局を始める ===== */
function newGameFor(recipe){
  // 乱数は使わない(開始時の針の効果は、起きた時に画面で入れてもらう)
  const noRng = { next: () => 1, nextInt: () => 0 };
  const g = SEW.newGame(recipe, cfgOf(), noRng);
  S.g = g; S.recipeId = recipe.id;
  S.rec = null; S.move = null; S.pend = []; S.obs = {}; S.undo = []; S.msg = null;
  enterTurn();
}
// ターンの始めに要る入力を決める
function enterTurn(){
  const g = S.g;
  const exp = SEW.expectedPower(g);
  const t = g.turn + 1;
  const trait = SEW.isTraitTurn(t) ? g.cloth : null;
  const tin = { power: exp ? exp.power : null, shiftCrit: exp ? exp.shiftCrit : false, sure: !!exp,
                regen: null, glow: null, needRegen: false, needGlow: false };
  if(trait === 'regen') tin.needRegen = SEW.regenCandidates(g).length > 0;
  if(trait === 'light') tin.needGlow = g.base.some((b, i) => b - g.cum[i] >= SEW.P.yellow + 1);
  S.turnIn = tin; S.phase = 'turn'; S.rec = null; S.move = null; S.pend = []; S.obs = {};
  maybeStartTurn();
  // ぬいパワーが分からない(「？」・シフトの後)時は、選ぶ画面を開く(マスの値の入力と同じく、自分で開く)
  if(S.phase === 'turn' && !S.turnIn.power) openPower();
}
function turnReady(){
  const t = S.turnIn;
  return t && t.power && (!t.needRegen || t.regen) && (!t.needGlow || t.glow !== null);
}
// 入力がそろったらターンを始めて、推奨手を計算する
// 1手目は鍛冶と同じく「推奨手を計算」を押してから(force)。開始時の針の効果などを先に入れられるように
function maybeStartTurn(force){
  if(S.phase !== 'turn' || !turnReady()){ renderAll(); save(); return; }
  if(S.g.turn === 0 && force !== true){ renderAll(); save(); return; }
  const t = S.turnIn;
  SEW.startTurn(S.g, cfgOf(), { power: t.power, shiftCrit: t.shiftCrit,
    regen: t.regen, glow: t.glow === null ? -1 : t.glow });
  if(SewLog.active()) SewLog.ev('turn', { power: t.power, regen: t.regen, glow: t.glow });
  S.phase = 'move';
  calcRec();
}
let CALC_SEQ = 0;
function calcRec(){
  S.rec = null; renderAll();
  const g = S.g, my = ++CALC_SEQ;
  setBusy(true);
  AI.choose(g, cfgOf()).then(m => {
    if(my !== CALC_SEQ) return;
    S.rec = m; setBusy(false); renderAll(); save();
  });
}
function setBusy(on){
  const b = document.getElementById('calcBtn');
  if(b){ b.classList.toggle('busy', on); if(on){ b.disabled = true; b.innerHTML = '<span class="btn-main">計算中…</span>'; } }
}

/* ===== 手を使った ===== */
// 推奨手(または別の手)を使った。値の入力が要る手は、入力待ちにする
function useMove(m){
  if(!m) return;
  const g = S.g;
  if(m.finish){ askOutcome(() => resetToRecipe(), predictedOutcome()); return; }
  const sk = SEW.SKILL[m.skill];
  const cost = SEW.costOf(g, sk);
  if(cost > g.focus){ alert('集中力が足りません'); return; }
  pushUndo();
  S.move = { skill: m.skill, anchor: m.anchor || null, rec: !!(S.rec && S.rec.skill === m.skill && JSON.stringify(S.rec.anchor || null) === JSON.stringify(m.anchor || null)) };
  SewLog.ev('move', { sk: sk.name, anchor: m.anchor || null, rec: S.move.rec, recSk: S.rec && !S.rec.finish ? SEW.SKILL[S.rec.skill].name : (S.rec ? 'しあげる' : null), cost });
  if(sk.kind === 'sew'){
    S.pend = SEW.targetsOf(g, sk, m.anchor).map(([i, mul]) => ({ i, mul, kind: 'sew', aim: sk.aim === true }));
  } else if(sk.kind === 'hogushi'){
    S.pend = [{ i: g.cellAt[m.anchor.r * 8 + m.anchor.c], kind: 'hogushi' }];
  } else if(sk.kind === 'midare'){
    S.pend = []; S.midare = true;
  } else {
    S.pend = [];
  }
  S.obs = {};
  if(sk.kind === 'sew' || sk.kind === 'hogushi' || sk.kind === 'midare'){
    S.phase = 'input';
    renderAll(); save();
    if(S.pend.length) openCell(S.pend[0].i);
    return;
  }
  finishMove();
}
// 値がそろった(または入力が要らない手)。エンジンの局面を進めて、次のターンへ
function finishMove(){
  const g = S.g, m = S.move;
  const sk = SEW.SKILL[m.skill];
  const res = SEW.applyMove(g, { skill: m.skill, anchor: m.anchor }, cfgOf(), { remains: S.obs });
  if(!res.ok){ alert('この手は使えません(集中力が足りないか、当たるマスがありません)'); undoLast(true); return; }
  S.midare = false;
  S.msg = null;
  enterTurn();
}

/* ===== マスの残りの入力 ===== */
let NUM = null;    // { kind: 'cell'|'focus'|'regen', i, buf, neg }
function candidatesFor(i){
  const g = S.g, r = rem(i), cm = (g.shitsuke[i] ? 2 : 1) * (g.glow === i ? SEW.P.glowMul : 1);
  const p = S.pend.find(x => x.i === i);
  const groups = [];
  const add = (label, cls, vals) => { const u = [...new Set(vals)].sort((a, b) => b - a); if(u.length) groups.push({ label, cls, vals: u }); };
  if(S.phase === 'input' && S.move){
    const sk = SEW.SKILL[S.move.skill];
    if(sk.kind === 'hogushi'){
      const v = []; for(let b = 6; b <= 9; b++) v.push(Math.min(g.base[i], r + Math.min(Math.floor(b * SEW.POWER[g.power] * cm), g.cum[i])));
      add('糸ほぐしの後', 'n', v);
    } else {
      const muls = p ? [p.mul] : (sk.kind === 'midare' ? sk.muls : [1]);
      const n = [], c = [];
      for(const mul of muls) for(let b = 12; b <= 18; b++){
        const v = SEW.rollValue(b, mul, g.power, cm);
        n.push(r - v);
        if(r > 0) c.push(r - Math.min(2 * v, r));
      }
      add('会心が出なかった', 'n', n);
      add('会心が出た', 'c', c);
    }
  }
  return groups;
}
function openCell(i){
  if(!S.g) return;
  NUM = { kind: 'cell', i, buf: '', neg: false };
  const groups = candidatesFor(i);
  document.getElementById('numTitle').textContent = `${cellName(i)} の残り`;
  const box = document.getElementById('numCand');
  if(groups.length){
    box.innerHTML = groups.map(gr => `<div class="cand-grp"><span class="cand-h ${gr.cls}">${gr.label}</span><div class="cand-row">`
      + gr.vals.map(v => `<button class="cand${gr.cls === 'c' ? ' crit' : ''}" onclick="setCell(${i},${v},${gr.cls === 'c'})">${v}</button>`).join('')
      + '</div></div>').join('') + '<button class="cand-more" onclick="showNumKeys()">一覧に無い値を自分で入力する</button>';
    box.style.display = ''; document.getElementById('numKeys').style.display = 'none';
  } else {
    box.innerHTML = ''; box.style.display = 'none'; document.getElementById('numKeys').style.display = '';
  }
  updNum(); document.getElementById('numModal').classList.add('show');
}
function openNum(kind){
  if(!S.g) return;
  NUM = { kind, buf: '', neg: false };
  document.getElementById('numTitle').textContent = kind === 'focus' ? '残り集中力' : '';
  const box = document.getElementById('numCand');
  if(kind === 'focus' && S.level >= SEW.P.recover.lv && !S.g.recoverUsed){
    box.innerHTML = `<button class="cand-more" onclick="recoverFocus()">集中力が回復した(+${SEW.P.recover.amount})</button>`;
    box.style.display = '';
  } else { box.innerHTML = ''; box.style.display = 'none'; }
  document.getElementById('numKeys').style.display = '';
  updNum(); document.getElementById('numModal').classList.add('show');
}
function showNumKeys(){ document.getElementById('numKeys').style.display = ''; }
function closeNum(){ document.getElementById('numModal').classList.remove('show'); NUM = null; }
function nkey(k){
  if(!NUM) return;
  if(k === 'del') NUM.buf = NUM.buf.slice(0, -1);
  else if(k === 'sign') NUM.neg = !NUM.neg;
  else if(NUM.buf.length < 4) NUM.buf = (NUM.buf === '0' ? '' : NUM.buf) + k;
  updNum();
}
function updNum(){
  if(!NUM) return;
  document.getElementById('numVal').textContent = (NUM.neg ? '−' : '') + (NUM.buf || '0');
  const sg = document.getElementById('nSign'); if(sg) sg.classList.toggle('on', NUM.neg);
}
function ncommit(){
  if(!NUM) return;
  const v = (NUM.neg ? -1 : 1) * (parseInt(NUM.buf || '0', 10));
  if(NUM.kind === 'focus'){ if(v >= 0){ S.g.focus = v; } closeNum(); afterEdit(); return; }
  if(NUM.kind === 'cell'){ setCell(NUM.i, v, null); return; }
  if(NUM.kind === 'regen'){ setRegen(NUM.i, v); return; }
}
function recoverFocus(){
  S.g.focus += SEW.P.recover.amount; S.g.recoverUsed = true;
  SewLog.ev('recover', {});
  closeNum(); afterEdit();
}
// マスの残りを入れた。入力待ちなら記録して次へ、そうでなければ盤面の手直し
function setCell(i, v, crit){
  if(!Number.isFinite(v)) return;
  const g = S.g;
  if(S.phase === 'input'){
    S.obs[i] = v;
    SewLog.ev('val', { cell: i + 1, before: rem(i), val: v, crit: !!crit });
    S.pend = S.pend.filter(p => p.i !== i);
    closeNum();
    if(S.pend.length){ renderAll(); save(); openCell(S.pend[0].i); return; }
    if(S.midare){ renderAll(); save(); return; }       // みだれぬいは「入力おわり」を押すまで待つ
    finishMove(); return;
  }
  // 手直し(ゲームとずれた時): その場で残りを書き換える
  SewLog.ev('fix', { cell: i + 1, before: rem(i), val: v });
  g.cum[i] = g.base[i] - v;
  closeNum(); afterEdit();
}
function midareDone(){
  if(!S.midare) return;
  finishMove();
}
// 盤面・集中力を手直しした後: 計算し直す
function afterEdit(){
  if(S.phase === 'move') calcRec(); else { renderAll(); save(); }
}

/* ===== ターンの始めの入力 ===== */
function openPower(){
  if(!S.g) return;
  const t = S.turnIn, cur = S.phase === 'turn' ? (t && t.power) : S.g.power;
  const row = document.getElementById('powRow');
  // ターンの始めは、会心×２がシフトで出たかは局面で決まるので1つにする。手直しの時は分けて選ぶ
  const opts = [['weak', ''], ['normal', ''], ['strong', ''], ['strongest', '']].concat(S.phase === 'turn'
    ? [['critx2', '']] : [['critx2', 'シフトで出た', true], ['critx2', '「？」で出た', false]]);
  row.innerHTML = opts.map(([p, sub, sc]) => `<button class="cand${p === cur && (p !== 'critx2' || (sc === undefined || sc === (t ? t.shiftCrit : S.g.shiftCrit))) ? ' now' : ''}" onclick="setPower('${p}',${sc === undefined ? 'null' : sc})">${SEW.POWER_JA[p]}${sub ? `<small>${sub}</small>` : ''}</button>`).join('');
  document.getElementById('powTitle').textContent = S.phase === 'turn' ? `${S.g.turn + 1}ターン目のぬいパワー` : 'このターンのぬいパワー';
  document.getElementById('powModal').classList.add('show');
}
function closePower(){ document.getElementById('powModal').classList.remove('show'); }
function setPower(p, shiftCrit){
  closePower();
  const sc = p === 'critx2' ? (shiftCrit === null ? !!(S.g.forced) : shiftCrit) : false;
  if(S.phase === 'turn'){ S.turnIn.power = p; S.turnIn.shiftCrit = sc; S.turnIn.sure = true; maybeStartTurn(); return; }
  if(S.phase === 'move'){ S.g.power = p; S.g.shiftCrit = sc; S.g.randomCrit = p === 'critx2' && !sc; SewLog.ev('fixPower', { power: p }); calcRec(); }
}
function setGlow(i){
  if(!S.turnIn) return;
  S.turnIn.glow = i; maybeStartTurn();
}
function openRegen(i){
  NUM = { kind: 'regen', i, buf: '', neg: false };
  const g = S.g, r = rem(i), vals = [...new Set(SEW.P.regen.map(a => r + Math.min(a, g.cum[i])))].sort((a, b) => b - a);
  document.getElementById('numTitle').textContent = `${cellName(i)} の残り(再生の後)`;
  const box = document.getElementById('numCand');
  box.innerHTML = `<div class="cand-grp"><span class="cand-h n">再生の後</span><div class="cand-row">`
    + vals.map(v => `<button class="cand" onclick="setRegen(${i},${v})">${v}</button>`).join('') + '</div></div>'
    + '<button class="cand-more" onclick="showNumKeys()">一覧に無い値を自分で入力する</button>';
  box.style.display = ''; document.getElementById('numKeys').style.display = 'none';
  updNum(); document.getElementById('numModal').classList.add('show');
}
function setRegen(i, v){
  closeNum();
  S.turnIn.regen = { cell: i, remain: v };
  maybeStartTurn();
}
function noRegen(){ S.turnIn.needRegen = false; maybeStartTurn(); }

/* ===== 別の手 ===== */
let OTHER = null;
function openOther(){
  if(!S.g || S.phase !== 'move') return;
  OTHER = null;
  const g = S.g;
  const list = SEW.SKILLS.filter(sk => sk.lv <= S.level && (sk.kind !== 'muga' || (g.hsCharged && !g.hsUsed)));
  document.getElementById('otherTitle').textContent = '使った特技を選んでください';
  document.getElementById('otherBody').innerHTML = '<div class="oth-list">'
    + list.map(sk => { const c = SEW.costOf(g, sk); return `<button onclick="pickOther('${sk.id}')"${c > g.focus ? ' disabled' : ''}>${sk.name}<small>消費 ${c}</small></button>`; }).join('')
    + `<button onclick="pickOther('finish')">しあげる<small>ここで終える</small></button></div>`;
  document.getElementById('otherModal').classList.add('show');
}
function closeOther(){ document.getElementById('otherModal').classList.remove('show'); OTHER = null; }
function pickOther(id){
  if(id === 'finish'){ closeOther(); useMove({ finish: true }); return; }
  const sk = SEW.SKILL[id];
  if(['sew', 'hogushi', 'shitsuke'].includes(sk.kind) && sk.target){
    OTHER = id;
    const g = S.g;
    document.getElementById('otherTitle').textContent = `${sk.name}: 選んだマスを押してください`;
    let h = `<div class="oth-grid" style="grid-template-columns:repeat(${g.cols},1fr)">`;
    for(let r = 1; r <= g.rows; r++) for(let c = 1; c <= g.cols; c++){
      const i = g.cellAt[r * 8 + c];
      h += i === undefined ? '<button class="void" disabled></button>' : `<button onclick="pickOtherCell(${r},${c})">${i + 1}</button>`;
    }
    document.getElementById('otherBody').innerHTML = h + '</div>';
    return;
  }
  closeOther(); useMove({ skill: id });
}
function pickOtherCell(r, c){ const id = OTHER; closeOther(); useMove({ skill: id, anchor: { r, c } }); }

/* ===== 取り消し ===== */
function pushUndo(){
  S.undo.push({ g: SEW.cloneGame(S.g), phase: S.phase, turnIn: S.turnIn ? Object.assign({}, S.turnIn) : null, rec: S.rec });
  if(S.undo.length > 30) S.undo.shift();
}
function undoLast(silent){
  const u = S.undo.pop();
  if(!u) return;
  S.g = u.g; S.g.recipe = recipeOf(S.recipeId);
  S.phase = u.phase; S.turnIn = u.turnIn; S.rec = u.rec; S.move = null; S.pend = []; S.obs = {}; S.midare = false;
  if(!silent) SewLog.ev('undo', {});
  closeNum();
  renderAll(); save();
}

/* ===== 結果・リセット ===== */
let OUTCOME_NEXT = null;
function predictedOutcome(){ return S.g ? SEW.judge(S.g).star : null; }
const OUTCOMES = [[3, '大成功(★3)'], [2, '★2'], [1, '★1'], [0, '★0'], [-1, '失敗']];
function askOutcome(next, pred){
  OUTCOME_NEXT = next;
  document.getElementById('outcomeTitle').textContent = pred === undefined ? '今回の結果を選んでください' : '仕上がりを選んでください';
  document.getElementById('outcomeRow').innerHTML = OUTCOMES.map(([s, l]) =>
      `<button class="cand${pred === s ? ' cur' : ''}" onclick="chooseOutcome('${l}')">${l}</button>`).join('')
    + (pred === undefined ? `<button class="cand" onclick="chooseOutcome('途中でやめた')">途中でやめた</button>` : '');
  document.getElementById('outcomeModal').classList.add('show');
}
function closeOutcome(){ OUTCOME_NEXT = null; document.getElementById('outcomeModal').classList.remove('show'); }
function chooseOutcome(o){
  const next = OUTCOME_NEXT; closeOutcome();
  SewLog.finish(o);
  if(next) next();
}
function resetToRecipe(){ const r = recipeOf(S.recipeId); if(r) newGameFor(r); else { S.g = null; S.phase = 'none'; renderAll(); save(); } }
function confirmReset(){
  if(!S.g) return;
  if(SewLog.active()){ askOutcome(() => resetToRecipe()); return; }
  resetToRecipe();
}

/* ===== レシピの選択 ===== */
let PICK = { cat: null, band: null };
function openPicker(){ PICK = { cat: null, band: null }; document.getElementById('pkSearch').value = ''; renderPicker(); document.getElementById('pickModal').classList.add('show'); }
function closePicker(){ document.getElementById('pickModal').classList.remove('show'); }
function bandOf(r){ const b = Math.floor((r.equipLevel - 1) / 10); return [b * 10 + 1, b * 10 + 10]; }
function recipeBtn(r){
  return `<button class="pk-item${r.id === S.recipeId ? ' cur' : ''}" onclick="chooseRecipe(${r.id})">`
    + `<span class="cl ${r.cloth}">${CLOTH_SHORT[r.cloth]}</span>${r.name}<span class="lv">装備Lv${r.equipLevel}・職人Lv${r.craftLevel}</span></button>`;
}
function renderPicker(){
  const q = document.getElementById('pkSearch').value.trim();
  const crumbs = document.getElementById('pkCrumbs'), body = document.getElementById('pkBody');
  if(q){
    const hit = SEW_RECIPES.filter(r => r.name.includes(q)).sort((a, b) => b.equipLevel - a.equipLevel).slice(0, 80);
    crumbs.innerHTML = `<span class="pk-crumb now">「${q.replace(/[<>&"]/g, '')}」の検索結果 ${hit.length}件</span>`;
    body.innerHTML = `<div class="pk-list">${hit.map(recipeBtn).join('')}</div>`;
    return;
  }
  const cr = [`<button class="pk-crumb${PICK.cat ? '' : ' now'}" onclick="PICK={cat:null,band:null};renderPicker()">部位</button>`];
  if(PICK.cat) cr.push('<span class="pk-sep">▶</span>', `<button class="pk-crumb${PICK.band ? '' : ' now'}" onclick="PICK.band=null;renderPicker()">${CAT_JA[PICK.cat]}</button>`);
  if(PICK.band) cr.push('<span class="pk-sep">▶</span>', `<span class="pk-crumb now">装備Lv${PICK.band[0]}〜${PICK.band[1]}</span>`);
  crumbs.innerHTML = cr.join('');
  if(!PICK.cat){
    body.innerHTML = '<div class="pk-grid">' + CAT_ORDER.map(c => {
      const n = SEW_RECIPES.filter(r => r.category === c).length;
      return `<button onclick="PICK.cat='${c}';renderPicker()">${CAT_JA[c]}<small>${n}件</small></button>`;
    }).join('') + '</div>';
    return;
  }
  const list = SEW_RECIPES.filter(r => r.category === PICK.cat);
  if(!PICK.band){
    const bands = new Map();
    for(const r of list){ const b = bandOf(r); const k = b[0]; bands.set(k, (bands.get(k) || 0) + 1); }
    body.innerHTML = '<div class="pk-grid">' + [...bands.keys()].sort((a, b) => b - a).map(k =>
      `<button onclick="PICK.band=[${k},${k + 9}];renderPicker()">装備Lv${k}〜${k + 9}<small>${bands.get(k)}件</small></button>`).join('') + '</div>';
    return;
  }
  const rs = list.filter(r => r.equipLevel >= PICK.band[0] && r.equipLevel <= PICK.band[1]).sort((a, b) => b.equipLevel - a.equipLevel || a.id - b.id);
  body.innerHTML = `<div class="pk-list">${rs.map(recipeBtn).join('')}</div>`;
}
function chooseRecipe(id){
  closePicker();
  const r = recipeOf(id);
  if(!r) return;
  const go = () => { newGameFor(r); };
  if(S.g && SewLog.active()){ askOutcome(go); return; }
  go();
}

/* ===== 設定 ===== */
function readSettings(){
  S.level = Math.max(1, Math.min(80, parseInt(document.getElementById('s-level').value, 10) || 80));
  S.needle = document.getElementById('s-needle').value;
  S.star = parseInt(document.getElementById('s-star').value, 10);
  S.kotsu = document.getElementById('s-kotsu').value === '1';
}
function applySettings(){
  const before = S.g && !SewLog.active() && S.g.turn === 0;
  readSettings();
  // 打ち始める前なら、集中力も設定に合わせて作り直す
  if(before){ const r = recipeOf(S.recipeId); if(r){ newGameFor(r); return; } }
  if(S.phase === 'move') calcRec(); else { renderAll(); save(); }
}
function syncSettings(){
  document.getElementById('s-level').value = S.level;
  document.getElementById('s-needle').value = S.needle;
  document.getElementById('s-star').value = String(S.star);
  document.getElementById('s-kotsu').value = S.kotsu ? '1' : '0';
}

/* ===== 描画 ===== */
function renderAll(){ renderHeader(); renderBoard(); renderRec(); renderInput(); renderSkills(); syncPrimary(); }
function renderHeader(){
  const g = S.g, r = g ? g.recipe : null;
  document.getElementById('v-grp').textContent = r ? `${CAT_JA[r.category]}・${CLOTH_JA[r.cloth]}` : 'レシピ';
  document.getElementById('v-name').textContent = r ? r.name : '選んでください';
  document.getElementById('v-focus').textContent = g ? g.focus : '—';
  const pw = !g ? '—' : S.phase === 'turn' ? (S.turnIn && S.turnIn.power ? SEW.POWER_JA[S.turnIn.power] : '？') : SEW.POWER_JA[g.power];
  document.getElementById('v-power').textContent = pw;
  document.getElementById('v-gear').textContent = `${SEW.NEEDLES[S.needle].name}の針★${S.star} / Lv${S.level}${S.kotsu ? '' : ' / コツなし'}`;
  // 必殺: なし → (チャージが来たら選ぶ)チャージ → (使う)効果中。職人Lvが足りない時は欄を出さない
  const hsBox = document.getElementById('hsBox');
  hsBox.style.display = S.level >= SEW.SKILL.muga.lv ? '' : 'none';
  document.getElementById('v-hs').textContent = g ? HS_LABEL[hsKey()] : '—';
  hsBox.classList.toggle('on', !!g && (g.hsCharged || g.muga));
  // 札は今の状態だけを出す(精神統一の固定・虹布の特性のターン)。先の予告や、入力の画面で分かることは出さない
  const bd = [];
  if(g){
    const t = g.turn + 1;
    if(g.lockRem > 0 && g.lockedPower) bd.push(`<span class="badge boost">${SEW.POWER_JA[g.lockedPower]}で固定 あと${Math.max(0, g.lockRem - (S.phase === 'turn' ? 0 : 1))}ターン</span>`);
    if(g.cloth === 'rainbow' && SEW.isTraitTurn(t)) bd.push(`<span class="badge half">${SEW.rainbowMode(t) === 'half' ? '消費半分のターン' : '会心ターン(消費1.5倍)'}</span>`);
  }
  const bx = document.getElementById('badges');
  bx.innerHTML = bd.join('');
  bx.style.display = bd.length ? '' : 'none';
}
// 必殺の状態。欄を押すと選ぶ画面を開き、どの状態にも合わせられる(鍛冶の画面と同じ)。
// 無我の境地は使った後ずっと効く(muga と hsUsed が両方立つ)ので、使用済みは無い
const HS_LABEL = { none: 'なし', charged: 'チャージ', active: '効果中' };
function hsKey(){ const g = S.g; return !g ? 'none' : g.muga ? 'active' : g.hsCharged ? 'charged' : 'none'; }
function openHS(){
  if(!S.g) return;
  const k = hsKey();
  document.querySelectorAll('#hsModal .hs-opt').forEach(b => b.classList.toggle('cur', b.dataset.hs === k));
  document.getElementById('hsModal').classList.add('show');
}
function closeHS(){ document.getElementById('hsModal').classList.remove('show'); }
function setHS(k){
  closeHS();
  const g = S.g;
  if(!g || !HS_LABEL[k] || k === hsKey()) return;
  g.hsCharged = k === 'charged'; g.muga = k === 'active'; g.hsUsed = k === 'active';
  SewLog.ev('hs', { state: k });
  afterEdit();
}
function renderBoard(){
  const el = document.getElementById('sboard');
  const g = S.g;
  if(!g){ el.innerHTML = ''; document.getElementById('ssum').innerHTML = ''; document.getElementById('cycle').innerHTML = ''; return; }
  el.style.gridTemplateColumns = `repeat(${g.cols}, minmax(0,1fr))`;
  const tg = new Set(), pend = new Set(S.pend.map(p => p.i));
  let anchor = -1;
  const m = S.phase === 'input' ? S.move : S.rec;
  if(m && !m.finish && m.skill){
    const sk = SEW.SKILL[m.skill];
    if(sk.target && m.anchor){
      for(const [i] of SEW.targetsOf(g, sk, m.anchor)) tg.add(i);
      anchor = anchorCell(g, sk, m.anchor);
    }
  }
  // ターンの始めに盤のマスを選ぶ時(光ったマス・再生したマス)は、選べるマスだけを押せるようにする
  const pick = pickable();
  const midareDoneSet = S.phase === 'input' && S.midare ? new Set(Object.keys(S.obs).map(Number)) : null;
  let h = '';
  for(let r = 1; r <= g.rows; r++) for(let c = 1; c <= g.cols; c++){
    const i = g.cellAt[r * 8 + c];
    if(i === undefined){ h += '<div class="scell void"></div>'; continue; }
    const v = S.phase === 'input' && S.obs[i] !== undefined ? S.obs[i] : rem(i);
    const cls = ['scell', Math.abs(v) <= SEW.P.yellow ? 'yellow' : v < 0 ? 'red' : '',
                 tg.has(i) ? 'tg' : '', i === anchor ? 'anchor' : '', pend.has(i) ? 'pend' : '',
                 pick ? (pick.has(i) ? 'pick' : 'dis') : '', midareDoneSet && midareDoneSet.has(i) ? 'done' : ''].filter(Boolean).join(' ');
    const tags = (g.glow === i && S.phase !== 'turn' ? '<span class="tag glow">光</span>' : '') + (g.shitsuke[i] ? '<span class="tag shi">しつけ</span>' : '');
    h += `<button class="${cls}" onclick="tapCell(${i})"${pick && !pick.has(i) ? ' disabled' : ''}><span class="no">${i + 1}${pend.has(i) ? '<span class="in">入力</span>' : ''}</span><span class="rem">${v}</span>`
       + `${tags ? `<span class="tags">${tags}</span>` : ''}</button>`;
  }
  el.innerHTML = h;
  const j = SEW.judge(g), T = ((g.oldLimit && SEW.EVAL_OLD[g.n]) || SEW.EVAL[g.n]).star3;
  const yel = g.base.filter((b, i) => Math.abs(b - g.cum[i]) <= SEW.P.yellow).length;
  // 誤差の合計は、全マスが黄色になった時だけ出す(★3 は全マス黄色の時だけなので、それまでは出しても使わない)
  document.getElementById('ssum').innerHTML = yel < g.n ? ''
    : `誤差の合計 <b class="${j.total <= T ? 'ok' : 'ng'}">${j.total}</b><span class="ssub">★3 は ${T} 以下</span>`;
  // 何ターン目かと、ぬいパワーの順番(印が今の位置。押すと直せる)
  document.getElementById('cycle').innerHTML = `<span class="cyc-t">${g.turn + 1}ターン目</span>`
    + g.cycle.map((p, k) => `<button class="${k === g.cycleIdx ? 'now' : ''}${p === 'unknown' ? ' q' : ''}" onclick="setCycleIdx(${k})">${POW_SHORT[p]}</button>`).join('');
}
// 盤の上で「ここ」と示すマス: 推奨手の起点が欠けた位置なら、同じマスに当たる実在の起点を探す
function anchorCell(g, sk, a){
  const i = g.cellAt[a.r * 8 + a.c];
  const key = t => t.map(x => x[0] + ':' + x[1]).sort().join(',');
  const want = key(SEW.targetsOf(g, sk, a));
  if(i !== undefined) return i;
  for(let r = 1; r <= g.rows; r++) for(let c = 1; c <= g.cols; c++){
    const j = g.cellAt[r * 8 + c]; if(j === undefined) continue;
    if(key(SEW.targetsOf(g, sk, { r, c })) === want) return j;
  }
  return -1;
}
// 順番の位置を直す。確かめの画面は出さず、押し間違えは「取り消す」で戻す
function setCycleIdx(k){
  const g = S.g; if(!g || k === g.cycleIdx || S.phase === 'input') return;
  pushUndo();
  g.cycleIdx = k;
  SewLog.ev('fixCycle', { idx: k });
  if(S.phase === 'turn') enterTurn(); else { renderAll(); save(); }
}
// ターンの始めに盤から選ぶマス(光ったマス・再生したマス)。選ぶ場面でなければ null
function pickable(){
  const g = S.g, t = S.turnIn;
  if(!g || S.phase !== 'turn' || !t) return null;
  if(t.needGlow && t.glow === null) return new Set(g.base.map((b, i) => i).filter(i => rem(i) >= SEW.P.yellow + 1));
  if(t.needRegen && !t.regen) return new Set(SEW.regenCandidates(g));
  return null;
}
function tapCell(i){
  if(!S.g) return;
  if(S.phase === 'turn' && S.turnIn){
    const pick = pickable();
    if(pick){
      if(!pick.has(i)) return;                       // 選べないマス(盤では押せない見た目にしてある)
      if(S.turnIn.needGlow) setGlow(i); else openRegen(i);
      return;
    }
  }
  if(S.phase === 'input' && S.midare){ openCell(i); return; }
  if(S.phase === 'input' && S.pend.some(p => p.i === i)){ openCell(i); return; }
  openCell(i);       // 手直し
}
function moveText(m){
  if(!m) return '';
  if(m.finish) return 'しあげる';
  const sk = SEW.SKILL[m.skill];
  if(sk.target && m.anchor){
    const a = anchorCell(S.g, sk, m.anchor);
    return `${sk.name}<span class="tgt">${a >= 0 ? cellName(a) + ' を選ぶ' : ''}</span>`;
  }
  return sk.name;
}
function renderRec(){
  const el = document.getElementById('rec');
  const g = S.g;
  if(!g){ el.innerHTML = '<div class="rec-empty">レシピを選んでください</div>'; return; }
  if(S.phase === 'turn'){ el.innerHTML = ''; return; }        // ターンの始めの入力は、下の欄と主ボタンで分かる
  if(S.phase === 'input'){ el.innerHTML = `<div class="rec-main"><div class="rec-skill">${moveText(S.move)}</div></div>`; return; }
  if(!S.rec){ el.innerHTML = '<div class="rec-empty">計算中…</div>'; return; }
  const m = S.rec, sk = m.finish ? null : SEW.SKILL[m.skill];
  const cost = sk ? SEW.costOf(g, sk) : 0;
  const sub = m.finish ? (m.why || '') : `消費 ${cost}` + (m.why ? `・${m.why}` : '');
  const p = Number.isFinite(m.pStar3) ? `<div class="rec-p">★3 の見込み ${Math.round(m.pStar3 * 100)}%</div>` : '';
  el.innerHTML = `<div class="rec-main"><div class="rec-skill">${moveText(m)}</div><div class="rec-sub">${sub}</div>${p}</div>`;
}
function renderInput(){
  const el = document.getElementById('inputPanel');
  const g = S.g;
  if(!g){ el.innerHTML = ''; return; }
  const parts = [];
  if(S.phase === 'turn' && S.turnIn){
    const t = S.turnIn;
    if(t.needRegen && !t.regen){
      parts.push(`<div class="inp"><div class="row"><button onclick="noRegen()">戻らなかった</button></div></div>`);
    }
    if(t.needGlow && t.glow === null){
      parts.push(`<div class="inp"><div class="row"><button onclick="setGlow(-1)">光らなかった</button></div></div>`);
    }
  }
  if(S.phase !== 'input' && g.turn === 0 && !SewLog.active()){
    const op = SEW.NEEDLES[S.needle].opening;
    if(op && op.type === 'focus' && !S.openingDone) parts.push(`<div class="inp"><div class="row"><button onclick="openingFocus()">開始時に集中力 +${op.amount} が出た</button></div></div>`);
  }
  if(S.level >= SEW.P.recover.lv && !g.recoverUsed && g.focus <= SEW.P.recover.below && S.phase !== 'input'){
    parts.push(`<div class="inp"><div class="row"><button onclick="recoverFocus()">集中力が回復した(+${SEW.P.recover.amount})</button></div></div>`);
  }
  if(S.msg) parts.push(`<div class="inp"><div class="d">${S.msg}</div></div>`);
  el.innerHTML = parts.join('');
}
function openingFocus(){ const op = SEW.NEEDLES[S.needle].opening; S.g.focus += op.amount; S.openingDone = true; afterEdit(); }
function renderSkills(){
  const g = S.g, el = document.getElementById('skTable');
  if(!g){ el.innerHTML = ''; return; }
  const p = S.phase === 'turn' ? (S.turnIn && S.turnIn.power) || 'normal' : g.power;
  const rows = SEW.SKILLS.filter(sk => sk.lv <= S.level && sk.kind !== 'muga').map(sk => {
    const c = SEW.costOf(g, sk);
    let v = '';
    if(sk.kind === 'sew' && sk.mul) v = `${SEW.rollValue(12, sk.mul, p, 1)}〜${SEW.rollValue(18, sk.mul, p, 1)}`;
    else if(sk.kind === 'sew' && sk.center) v = `中 ${SEW.rollValue(12, sk.center, p, 1)}〜${SEW.rollValue(18, sk.center, p, 1)}・周り ${SEW.rollValue(12, sk.around, p, 1)}〜${SEW.rollValue(18, sk.around, p, 1)}`;
    else if(sk.kind === 'hogushi') v = `戻す ${Math.floor(6 * SEW.POWER[p])}〜${Math.floor(9 * SEW.POWER[p])}`;
    else if(sk.kind === 'midare') v = '4マスに 2・1・1・0.5倍';
    return `<tr><td>${sk.name}</td><td>${c}</td><td>${v}</td></tr>`;
  });
  el.innerHTML = `<tr><th>特技</th><th>消費</th><th>値(${SEW.POWER_JA[p]})</th></tr>` + rows.join('');
}
// 画面下の主ボタン: 次にすべきことを1つだけ示す
function syncPrimary(){
  const btn = document.getElementById('calcBtn');
  if(btn.classList.contains('busy')) return;
  const ub = document.getElementById('undoBtn'), ob = document.getElementById('otherBtn');
  ub.style.display = S.undo.length ? '' : 'none';
  ob.style.display = S.g && S.phase === 'move' ? '' : 'none';
  let label = '', sub = '', run = null;
  if(!S.g){ label = 'レシピを選ぶ'; run = openPicker; }
  else if(S.phase === 'turn'){
    const t = S.turnIn;
    if(!t.power){ label = 'ぬいパワーを選ぶ'; run = openPower; }
    else if(t.needRegen && !t.regen){ label = '再生したマスをタップしてください'; }
    else if(t.needGlow && t.glow === null){ label = '光ったマスをタップしてください'; }
    else { label = '推奨手を計算'; run = () => maybeStartTurn(true); }
  } else if(S.phase === 'input'){
    if(S.midare){ label = '入力おわり'; run = midareDone; }
    else if(S.pend.length){ label = '結果を入力'; sub = `${cellName(S.pend[0].i)}` + (S.pend.length > 1 ? `・残り${S.pend.length}マス` : ''); run = () => openCell(S.pend[0].i); }
  } else if(S.phase === 'move'){
    if(S.rec){ label = S.rec.finish ? 'しあげた' : '使った'; sub = S.rec.finish ? '結果を選ぶ' : ''; run = () => useMove(S.rec); }
    else { label = '推奨手を計算'; run = calcRec; }
  }
  btn.disabled = !run;
  btn.innerHTML = `<span class="btn-main">${label}</span>` + (sub ? `<span class="btn-sub">${sub}</span>` : '');
  btn._run = run;
}
function onPrimary(){ const b = document.getElementById('calcBtn'); if(b._run) b._run(); }

/* ===== 起動 ===== */
load();
syncSettings();
for(const id of ['s-level', 's-needle', 's-star', 's-kotsu']) document.getElementById(id).addEventListener('change', applySettings);
renderAll();
if(S.g && S.phase === 'move' && !S.rec) calcRec();
GameLog.flush();

// 設定欄の一番下に、届いている版を出す(鍛冶の画面と同じ)
(function(){
  const el = document.getElementById('v-ver');
  if(!el) return;
  const me = document.querySelector('script[src^="sew-ui.js"]');
  const js = me ? ((me.getAttribute('src').split('?v=')[1]) || '—') : '—';
  const css = getComputedStyle(document.documentElement).getPropertyValue('--css-ver').trim().replace(/"/g, '') || '—';
  const title = (document.title.match(/V[\d.]+/) || [''])[0];
  el.innerHTML = `${title} ・ 画面 ${js} ・ 見た目 ${css}`
    + (js !== css ? '<br><b>見た目のファイルが古いままです。ブラウザのキャッシュを消してください</b>' : '');
})();
// スマホでは下部の操作パネルが画面に固定されている。その分だけページ下に余白を取る(鍛冶の画面と同じ)
(function(){
  const foot = document.getElementById('footPanel');
  const mq = window.matchMedia('(max-width: 759px)');
  const sync = () => { document.body.style.paddingBottom = mq.matches ? (foot.offsetHeight + 12) + 'px' : ''; };
  if(typeof ResizeObserver !== 'undefined') new ResizeObserver(sync).observe(foot);
  window.addEventListener('resize', sync);
  sync();
})();
