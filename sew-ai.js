/* =====================================================================
   さいほうの推奨手(作業中。状態と続きは docs/引き継ぎ資料.md の 9章)
   ・sew-engine.js(SEW)のルールの上で、手を選ぶ。名前の空間は SEW_AI。
   ・考え方:
       各マスの「仕上げまでに要る集中力の見込み」h(残り) を作り、
       手を打った後の h の合計の減り(期待値)− 消費集中力 が一番大きい手を選ぶ。
       h は2段:
         仕上げ(残りが小さい): 弱いで固定して1マスずつ仕上げる総当たり(期待の消費集中力)。
         削り(残りが大きい)  : 1集中力あたり eta だけ減らせるとして、仕上げの表につなぐ。
   ・精神統一は「今の強さで、続く手の価値が高い」時に使う(下の lockGain)。
   ・しあげる: 全マスが黄色で、誤差の合計が★3の範囲に入ったら。
   ・終盤(全マスの残りが ±endR 以内): 1マスの「誤差 a 以内に収まる確率」の表から、盤の★3の確率を出して、
     それが一番高い手を選ぶ(chooseEnd)。
   ===================================================================== */
'use strict';
(function(root){
const SEW = root.SEW || (typeof require === 'function' ? require('./sew-engine.js') : null);

const DEF = {
  eta: 0,            // 削りの効率(1集中力あたりに減らせる量)。0 なら盤の形から決める(etaK × 最強の複数マスの特技の効率)
  etaK: null,        // null ならマスの数ごとの etaKn を使う
  etaKn: { 4: 1.0, 6: 1.0, 9: 0.4 },   // 2026-10-14 に代表9レシピで選んだ(9マスは削りを重く見るほど良く、4マスは逆。6マスは差が出ず)
  lockOver: 7 / 3,   // 精神統一の分を、仕上げの1手あたりに割り振った消費
  pen: null,         // 仕上げた時の誤差ごとの減点(集中力の単位)。null ならマス数と許容誤差から決める
  pen4: [0, 8, 20, 40, 60], pen6: [0, 4, 14, 26, 38], pen9: [0, 2, 9, 18, 28],
  r1: 20,            // 仕上げの表を使う上限(これより上は削りの直線)
  regenRed: true,    // 再生布: 赤いマス(縫いすぎ)は、次の再生で戻る見込みで評価する
  regenRedMax: null, // そのマスが赤くなると赤いマスがこの数以上になる時は、赤いマスを戻る見込みで見ない(0 で使わない)。null ならマスの数ごとの regenRedMaxN
  regenRedMaxN: { 4: 3, 6: 2, 9: 3 },   // 2026-10-16、再生布・各10レシピ: 9マス 3(種1000で選び 種5000 z=3.00)・6マス 2(種1000 z=8.04・種5000 z=5.44)・4マス 3(種1000 z=2.29・種9000 z=2.32、+1pt 弱)
  endR: 30,          // 全マスの残りがこの範囲(-endR〜endR)に入ったら終盤の評価に切り替える
  endOver: 2,        // 終盤の表で、1手あたりに割り振る精神統一の消費
  endStep: 4,        // 終盤の盤の値で、集中力を何刻みで割り振るか
  qFmax: 320,
  waitCost: 6,       // 弱いが来るまで待つ1ターンの消費の見込み
  endOn: true,
  qRegen: false,     // 再生布の終盤の表で、赤いマスが再生で戻ることを見込む
  qRegenWait: 2,     // その時の、待つ消費の見込み
  qRegenN: { 9: 8 }, // マスの数ごとに qRegen を使う時の、待つ消費の見込み。qRegen が true ならそちらが先。
                     // 9マスだけ(2026-10-14: 再生布の9マス4レシピで、種5000 z=6.72・種9000 z=5.91。4・6マスは差が出ず)
  endMulti: false,   // 終盤に複数マスに当たる手も見る
  regenFast: true,   // 再生の前の手の評価を、前もって作った合成で速く行う(false は戻る量ごとに作り直す。遅い)
  endMC: null,       // 終盤の際どい判断の試し打ち { K: 候補の数, R: 本数, z: 乗り換えの基準, lo, hi: 見込みの範囲, gap: 候補にする見込みの差, seed, ms: 時間の上限(省略可) }。
                     // 画面(sew-ui.js の SEW_AI_PARAMS)では { K:3, R:32, z:2, lo:0.02, hi:0.98, gap:0.1, seed:1, ms:5000 } を使う
                     // (2026-10-16、代表9レシピ・各300局: 種1000 72.5% → 74.3%(z=4.72)・種5000 72.9% → 74.7%(z=4.46))。
                     // 試験の道具では遅くなるので、ふだんは使わない
  bulkMC: null,      // 削り(終盤の前)の手も試し打ちで確かめる { K: 候補の数, R: 本数, z: 乗り換えの基準, seed, ms: 時間の上限(省略可) }。
                     // 候補は ふだんの手・精神統一(できる時)・ふだんの評価の上位。ふだんの手より z 以上はっきり良い時だけ乗り換える
  endMinP: 0.002,    // 終盤の評価で、どの手でも★3の確率がこれ未満なら、ふだんの選び方に戻す
  endTieW: 0.01,     // 終盤の手選びで、集中力を endTieMul 倍に減らした時の★3の確率を、この重みで足す。
  endTieMul: 0.6,    // 集中力が多いと確率がどの手でも1に張り付き、並び順で集中力を無駄にする手が選ばれていたので、その同点を崩す
                     // (2026-10-16、代表9レシピ・各300局: 種5000 z=4.00・種9000 z=5.02。重み 0.1 は種1000で選び、種5000 z=2.83)
  regenAware: true,  // 再生布: 次のターンの始めに戻るマスを見込む
  lockMin: 2,        // 精神統一の得がこれを超えたら使う
  noLockOnUp: true,  // 虹布の会心ターンには精神統一を使わない(2026-10-14、虹布10レシピ・種5000〜・各400局で z=3.26)
  lockCostReal: false, // 精神統一の得の見積もりで、消費を今のターンの消費(虹布の半分・1.5倍)にする
  bulkLock: null,    // 削りの残り(各マスの r1 を超える分の合計)がこれ以上なら、強い・最強の固定を続ける。null で使わない
  bulkLockNet: -3,   // その時、今の強さの一番よい手の得がこれより大きいこと
  lockTrait: ['light4'], // 精神統一の得の見積もりで、続くターンの布の特性(光布の光るマス・虹布の消費と会心)を見る布とマスの数。true で全部
                         // (2026-10-16: 光布4マスで、種1000 z=1.76・種5000 z=2.86・Lv70〜75の10レシピ 種9000 z=3.92。虹布・再生布・6・9マスは差が出ず)
  lockSlack: 1,      // 固定するのは、順番に出てくる強さの中で手の価値が一番高い強さ(との差がこれ以内)の時だけ。null で見ない
  rMin: -80, rMax: 160,
};

function penaltyFor(n, T, prm){
  if(prm.pen) return prm.pen;
  return n <= 4 ? prm.pen4 : n <= 6 ? prm.pen6 : prm.pen9;
}

/* ---- 仕上げの表: 弱いで固定した時の、1マスを仕上げるまでの消費の期待値 ---- */
function finishTable(cfg, pen, prm, muga){
  const lv = cfg.level, LO = prm.rMin, HI = prm.rMax, N = HI - LO + 1;
  const over = lv >= SEW.SKILL.seishin.lv ? prm.lockOver : 0;
  let base = SEW.NEEDLES[cfg.needle].crit[cfg.star] + (cfg.kotsu ? SEW.P.kotsu : 0) + (lv >= 10 ? SEW.P.passive : 0);
  if(muga) base *= SEW.P.muga;
  const acts = [];
  const add = (id, mul, aim) => {
    const sk = SEW.SKILL[id]; if(sk.lv > lv) return;
    const d = []; for(let b = 12; b <= 18; b++) d.push(SEW.rollValue(b, mul, 'weak', 1));
    acts.push({ id, cost: sk.cost + over, d, q: Math.min(1, base * (aim ? SEW.P.aim : 1)) });
  };
  add('nuu', 1); add('kagen', 0.5); add('hankagen', 0.75); add('nerai', 1, true); add('nibai', 2); add('sanbai', 3);
  const hog = SEW.SKILL.hogushi.lv <= lv ? { cost: SEW.SKILL.hogushi.cost + over, d: [6, 7, 8, 9].map(b => Math.floor(b * 0.5)) } : null;
  const E = new Float64Array(N).fill(1e9), A = new Int16Array(N).fill(-1);
  const at = r => E[Math.max(LO, Math.min(HI, r)) - LO] + (r < LO ? (LO - r) * 3 : 0);
  for(let it = 0; it < 400; it++){
    let ch = 0;
    for(let r = LO; r <= HI; r++){
      let best = Math.abs(r) <= 4 ? pen[Math.abs(r)] : 1e9, ba = -1;
      if(r > 0){
        for(let k = 0; k < acts.length; k++){
          const a = acts[k]; let s = 0;
          for(const v of a.d) s += (1 - a.q) * at(r - v) + a.q * at(r - Math.min(2 * v, r));
          const val = a.cost + s / 7;
          if(val < best - 1e-9){ best = val; ba = k; }
        }
      }
      if(r < 0 && hog){
        let s = 0; for(const v of hog.d) s += at(r + v);
        const val = hog.cost + s / 4;
        if(val < best - 1e-9){ best = val; ba = 100; }
      }
      const i = r - LO;
      if(Math.abs(best - E[i]) > 1e-7){ ch++; E[i] = best; A[i] = ba; }
    }
    if(!ch) break;
  }
  return { E, A, LO, HI, acts };
}

// h(残り): 残りが r1 までは仕上げの表(弱いで固定して仕上げる消費の期待値)。それより上は、1集中力あたり eta で減らせるとして直線でつなぐ
function buildH(ft, prm, eta, regen){
  const { E, LO, HI } = ft;
  const r1 = Math.min(prm.r1, HI), top = E[r1 - LO], bot = E[0];
  const base = r => r > r1 ? top + (r - r1) / eta : r < LO ? bot + (LO - r) * 0.6 : E[r - LO];
  if(!regen) return base;
  // 再生布: 赤いマスは次の再生で 12〜16 戻る(赤いマスは割合が1を超えるので、真っ先に戻る)
  const N = HI - LO + 1, H = new Float64Array(N);
  for(let r = LO; r <= HI; r++){
    let v = base(r);
    if(r < -SEW.P.yellow){ let s = 0; for(const a of SEW.P.regen) s += base(r + a); v = Math.min(v, s / SEW.P.regen.length + 1); }
    H[r - LO] = v;
  }
  return r => r < LO || r > HI ? base(r) : H[r - LO];
}
// 盤の削りの効率: 最強で固定した時の、複数マスの特技(みだれぬいを除く)の「平均の値の合計 / (消費 + 精神統一の割り振り)」の最大
function boardEta(actions, cfg, prm){
  const over = cfg.level >= SEW.SKILL.seishin.lv ? prm.lockOver : 0;
  let best = 0;
  for(const a of actions){
    if(a.sk.kind !== 'sew') continue;
    let s = 0; for(const [, mul] of a.tg){ for(let b = 12; b <= 18; b++) s += SEW.rollValue(b, mul, 'strongest', 1) / 7; }
    best = Math.max(best, s / (a.sk.cost + over));
  }
  return best;
}

/* ---- レシピと設定ごとの準備 ---- */
function prepare(recipe, cfg, params){
  const prm = Object.assign({}, DEF, params || {});
  const n = recipe.cells.length;
  const T = ((recipe.oldLimit && SEW.EVAL_OLD[n]) || SEW.EVAL[n]).star3;
  const pen = penaltyFor(n, T, prm);
  const fakeGame = { rows: recipe.rows, cols: recipe.cols, cellAt: {} };
  recipe.cells.forEach((c, i) => { fakeGame.cellAt[c.r * 8 + c.c] = i; });
  // 手の一覧(同じマスに同じ倍率で当たるものは1つにまとめる)
  const actions = [];
  for(const sk of SEW.SKILLS){
    if(sk.lv > cfg.level) continue;
    if(sk.kind === 'sew'){
      const seen = new Set();
      for(let r = 1; r <= recipe.rows; r++) for(let c = 1; c <= recipe.cols; c++){
        const tg = SEW.targetsOf(fakeGame, sk, { r, c });
        if(!tg.length) continue;
        const key = tg.map(x => x[0] + ':' + x[1]).sort().join(',');
        if(seen.has(key)) continue; seen.add(key);
        actions.push({ skill: sk.id, sk, anchor: { r, c }, tg });
      }
    } else if(sk.kind === 'hogushi' || sk.kind === 'shitsuke'){
      recipe.cells.forEach(cl => actions.push({ skill: sk.id, sk, anchor: { r: cl.r, c: cl.c }, tg: [[fakeGame.cellAt[cl.r * 8 + cl.c], 1]] }));
    } else if(sk.kind === 'midare'){
      actions.push({ skill: sk.id, sk, anchor: null, tg: null });
    }
  }
  const ft = finishTable(cfg, pen, prm, false);
  const ftM = finishTable(cfg, pen, prm, true);
  const etaK = prm.etaK !== null ? prm.etaK : (prm.etaKn[n] !== undefined ? prm.etaKn[n] : 1.0);
  const eta = prm.eta || etaK * boardEta(actions, cfg, prm);
  const rg = prm.regenRed && recipe.cloth === 'regen';
  const redMax = rg ? (prm.regenRedMax !== null ? prm.regenRedMax : (prm.regenRedMaxN && prm.regenRedMaxN[n]) || 0) : 0;
  return { recipe, cfg, prm, n, T, pen, actions, eta, h: buildH(ft, prm, eta, rg), hM: buildH(ftM, prm, eta, rg), ft, ftM,
    redMax, hP: redMax ? buildH(ft, prm, eta, false) : null, hPM: redMax ? buildH(ftM, prm, eta, false) : null,
    lockTrait: prm.lockTrait === true || (Array.isArray(prm.lockTrait) && prm.lockTrait.includes(recipe.cloth + n)) };
}

/* ---- 手の評価 ---- */
// 1マスに倍率 mul で縫った後の h の期待値
function expH(g, cfg, ctx, h, i, mul, aim){
  const r = g.base[i] - g.cum[i];
  const cm = (g.shitsuke[i] ? 2 : 1) * (g.glow === i ? SEW.P.glowMul : 1);
  const q = r > 0 ? Math.min(1, SEW.critRate(g, cfg, i, aim)) : 0;
  let s = 0;
  for(let b = 12; b <= 18; b++){
    const v = SEW.rollValue(b, mul, g.power, cm);
    s += (1 - q) * h(r - v) + q * h(r - Math.min(2 * v, r));
  }
  return s / 7;
}
function evalAction(g, cfg, ctx, a){
  const h = g.muga ? ctx.hM : ctx.h;
  const cost = SEW.costOf(g, a.sk);
  if(cost > g.focus) return null;
  // 再生布: そのマスが赤くなると赤いマスが redMax 個以上になる時は、赤いマスを「次の再生で戻る」見込みで見ない
  // (再生は4ターンに1マスしか戻さないので、赤いマスが多いと見込みが甘くなる)
  let hOf = null;
  if(ctx.redMax){
    let red = 0; for(let i = 0; i < g.n; i++) if(g.base[i] - g.cum[i] < -SEW.P.yellow) red++;
    const hp = g.muga ? ctx.hPM : ctx.hP, hmix = x => x < -SEW.P.yellow ? hp(x) : h(x);
    hOf = i => (red - (g.base[i] - g.cum[i] < -SEW.P.yellow ? 1 : 0) + 1 >= ctx.redMax ? hmix : h);
  }
  const H = i => hOf ? hOf(i) : h;
  let gain = 0;
  if(a.sk.kind === 'sew'){
    for(const [i, mul] of a.tg){ const hi = H(i); gain += hi(g.base[i] - g.cum[i]) - expH(g, cfg, ctx, hi, i, mul, a.sk.aim === true); }
  } else if(a.sk.kind === 'midare'){
    const k = Math.min(4, g.n);
    for(let i = 0; i < g.n; i++){
      const hi = H(i), h0 = hi(g.base[i] - g.cum[i]);
      for(let s = 0; s < k; s++) gain += (h0 - expH(g, cfg, ctx, hi, i, a.sk.muls[s], false)) / g.n;
    }
  } else if(a.sk.kind === 'hogushi'){
    const i = a.tg[0][0], r = g.base[i] - g.cum[i], hi = H(i);
    if(r >= 0) return null;
    const cm = (g.shitsuke[i] ? 2 : 1) * (g.glow === i ? SEW.P.glowMul : 1);
    let s = 0;
    for(let b = 6; b <= 9; b++){ const v = Math.min(Math.floor(b * SEW.POWER[g.power] * cm), g.cum[i]); s += hi(r + v); }
    gain = hi(r) - s / 4;
  } else return null;
  if(ctx.prm.regenAware && g.cloth === 'regen' && SEW.isTraitTurn(g.turn + 2)) gain += regenDelta(g, cfg, a, h);
  return { a, cost, net: gain - cost };
}
// 再生布: この手のあと、次のターンの始めに戻るマスの h の変化(手の結果は平均で見る)
function regenDelta(g, cfg, a, h){
  const g2 = applyMean(g, cfg, a);
  let t = -1, best = -Infinity;
  for(let i = 0; i < g2.n; i++){
    if(Math.abs(g2.base[i] - g2.cum[i]) <= SEW.P.yellow) continue;
    const q = g2.cum[i] / g2.base[i]; if(q > best){ best = q; t = i; }
  }
  if(t < 0) return 0;
  const r = g2.base[t] - g2.cum[t];
  let s = 0; for(const amt of SEW.P.regen) s += h(r + Math.min(amt, g2.cum[t]));
  // 手そのものの評価は平均の局面ではないので、戻りの分だけを足す(戻らない場合との差)
  return h(r) - s / SEW.P.regen.length;
}
function bestAction(g, cfg, ctx){
  let best = null;
  for(const a of ctx.actions){
    const e = evalAction(g, cfg, ctx, a);
    if(e && (!best || e.net > best.net + 1e-9)) best = e;
  }
  return best;
}
// 打った後のマスを平均で進めた写し(精神統一の見積もり用)
function applyMean(g, cfg, a){
  const g2 = SEW.cloneGame(g);
  if(a.sk.kind === 'sew'){
    for(const [i, mul] of a.tg){
      const cm = (g.shitsuke[i] ? 2 : 1) * (g.glow === i ? SEW.P.glowMul : 1);
      let s = 0; for(let b = 12; b <= 18; b++) s += SEW.rollValue(b, mul, g.power, cm);
      g2.cum[i] += Math.round(s / 7); g2.shitsuke[i] = false;
    }
  } else if(a.sk.kind === 'midare'){
    for(let i = 0; i < g.n; i++){ let s = 0; for(let b = 12; b <= 18; b++) for(const m of a.sk.muls) s += SEW.rollValue(b, m, g.power, 1); g2.cum[i] += Math.round(s / 7 / g.n); }
  } else if(a.sk.kind === 'hogushi'){
    const i = a.tg[0][0]; g2.cum[i] = Math.max(0, g2.cum[i] - Math.floor(7.5 * SEW.POWER[g.power]));
  }
  g2.glow = -1;
  return g2;
}
// 精神統一の得: 固定すると、今の強さの手を3回(今のターンの分を引いて、実質2回ぶん)多く打てる
function lockGain(g, cfg, ctx){
  let gg = g, nets = [];
  for(let k = 0; k < 3; k++){
    if(ctx.lockTrait && k > 0){ gg.turn = g.turn + k; gg.glow = -1; }   // k 手目は k ターン後(布の特性をそのターンのもので見る)。gg は写し
    const b = bestAction(gg, cfg, ctx);
    if(!b || b.net <= 0) break;
    let net = b.net;
    if(ctx.lockTrait && k > 0 && g.cloth === 'light' && SEW.isTraitTurn(gg.turn + 1)){
      // 光布の光るターン: 光るマス(残り5以上の白いマスから1つ)ごとの一番よい手の得の平均
      const cand = []; for(let i = 0; i < gg.n; i++) if(gg.base[i] - gg.cum[i] >= SEW.P.yellow + 1) cand.push(i);
      if(cand.length){ let s = 0; for(const c of cand){ gg.glow = c; const bc = bestAction(gg, cfg, ctx); s += bc ? Math.max(bc.net, net) : net; } gg.glow = -1; net = s / cand.length; }
    }
    nets.push(net);
    gg = applyMean(gg, cfg, b.a);
  }
  if(nets.length < 2) return -1;
  return nets.slice(1).reduce((s, v) => s + v, 0) - (ctx.prm.lockCostReal ? SEW.costOf(g, SEW.SKILL.seishin) : SEW.SKILL.seishin.cost);
}

// 今の強さで固定してよいか: 順番に出てくる強さ(「？」があれば全部)の中で、今の局面の一番よい手の価値が
// 一番高い強さか、それとの差が lockSlack 以内の時だけ固定する(すぐ後に最強が来るのに強いで固定し続けないように)
function lockWorth(g, cfg, ctx){
  if(ctx.prm.lockSlack === null) return true;
  const set = new Set(g.cycle.filter(p => p !== 'unknown'));
  if(g.cycle.includes('unknown')) ['weak', 'normal', 'strong', 'strongest'].forEach(p => set.add(p));
  const keep = g.power;
  let mine = -Infinity, top = -Infinity;
  for(const p of set){
    g.power = p;
    const b = bestAction(g, cfg, ctx);
    const v = b ? b.net : -Infinity;
    if(p === keep) mine = v;
    if(v > top) top = v;
  }
  g.power = keep;
  if(!set.has(keep)){ const b = bestAction(g, cfg, ctx); mine = b ? b.net : -Infinity; }
  return mine >= top - ctx.prm.lockSlack;
}

/* ---- 終盤: ★3 になる確率で選ぶ ----
   1マスの表 Q[a][r][f]: 弱いで固定して仕上げる時、集中力 f 以内で、誤差 a 以内に収まる確率の最大(総当たり)。
   盤の値: 各マスに誤差の枠 a_i(合計 ≤ 許容誤差)と集中力 f_i(合計 ≤ 残り)を割り振った時の、確率の積の最大。 */
const Q_CACHE = {};
function qTables(cfg, muga, prm, regen){
  // regen: 再生布。縫いすぎた赤いマスは、待てば再生で 12〜16 戻る(待つ消費を qRegenWait と見る)
  const rw = regen ? prm.qRegenWait : null;
  const key = [cfg.level, cfg.needle, cfg.star, cfg.kotsu ? 1 : 0, muga ? 1 : 0, prm.endOver, prm.qFmax, rw].join('/');
  if(Q_CACHE[key]) return Q_CACHE[key];
  const LO = -40, HI = 48, NR = HI - LO + 1, FM = prm.qFmax, lv = cfg.level;
  const over = lv >= SEW.SKILL.seishin.lv ? prm.endOver : 0;
  let base = SEW.NEEDLES[cfg.needle].crit[cfg.star] + (cfg.kotsu ? SEW.P.kotsu : 0) + (lv >= 10 ? SEW.P.passive : 0);
  if(muga) base *= SEW.P.muga;
  const acts = [];
  const add = (id, mul, aim) => {
    const sk = SEW.SKILL[id]; if(sk.lv > lv) return;
    const d = []; for(let b = 12; b <= 18; b++) d.push(SEW.rollValue(b, mul, 'weak', 1));
    acts.push({ id, c: sk.cost + over, d, q: Math.min(1, base * (aim ? SEW.P.aim : 1)) });
  };
  add('nuu', 1); add('kagen', 0.5); add('hankagen', 0.75); add('nerai', 1, true); add('nibai', 2); add('sanbai', 3);
  const hog = SEW.SKILL.hogushi.lv <= lv ? { c: SEW.SKILL.hogushi.cost + over, d: [6, 7, 8, 9].map(b => Math.floor(b * 0.5)) } : null;
  const Q = [];
  for(let a = 0; a <= 4; a++){
    const T = new Float32Array(NR * (FM + 1));
    const at = (r, f) => (r < LO || r > HI || f < 0) ? 0 : T[(r - LO) * (FM + 1) + f];
    for(let f = 0; f <= FM; f++){
      for(let r = HI; r >= LO; r--){   // 再生は r を増やすので、同じ f の中では r の大きい方から決める
        let v = Math.abs(r) <= a ? 1 : 0;
        if(v < 1){
          if(r > 0) for(const x of acts){
            if(x.c > f) continue;
            let sum = 0;
            for(const dv of x.d) sum += (1 - x.q) * at(r - dv, f - x.c) + x.q * at(r - Math.min(2 * dv, r), f - x.c);
            if(sum / 7 > v) v = sum / 7;
          }
          if(r < 0 && hog && hog.c <= f){
            let sum = 0; for(const dv of hog.d) sum += at(r + dv, f - hog.c);
            if(sum / 4 > v) v = sum / 4;
          }
          if(rw !== null && r < -SEW.P.yellow && f >= rw){
            let sum = 0; for(const am of SEW.P.regen) sum += at(r + am, f - rw);
            if(sum / SEW.P.regen.length > v) v = sum / SEW.P.regen.length;
          }
        }
        T[(r - LO) * (FM + 1) + f] = v;
      }
    }
    Q.push(T);
  }
  return (Q_CACHE[key] = { Q, LO, HI, FM });
}
// 1マスの品目表: q[a][k] = Q[a][r][k*G](k = 0..NG)
function cellRow(qt, r, NG, G){
  const out = [];
  for(let a = 0; a <= 4; a++){
    const row = new Float32Array(NG + 1);
    if(r < qt.LO || r > qt.HI){ out.push(row); continue; }
    const off = (r - qt.LO) * (qt.FM + 1);
    for(let k = 0; k <= NG; k++) row[k] = qt.Q[a][off + Math.min(qt.FM, k * G)];
    out.push(row);
  }
  return out;
}
// 2つの表(誤差の枠 e = 0..T・集中力 k = 0..NG で、確率の積の最大)を合わせる
function combine(A, B, T, NG){
  const C = [];
  for(let e = 0; e <= T; e++){
    const row = new Float32Array(NG + 1);
    for(let e1 = 0; e1 <= e; e1++){
      const a = A[e1], b = B[e - e1];
      if(!a || !b) continue;
      for(let k = 0; k <= NG; k++){
        let m = row[k];
        for(let k1 = 0; k1 <= k; k1++){ const v = a[k1] * b[k - k1]; if(v > m) m = v; }
        row[k] = m;
      }
    }
    C.push(row);
  }
  return C;
}
function cellTable(qt, r, T, NG, G){
  // 1マス: 誤差の枠 e に対して a <= min(e, 4) の最大(枠は余らせてよい)
  const rows = cellRow(qt, r, NG, G), out = [];
  for(let e = 0; e <= T; e++){
    const row = new Float32Array(NG + 1);
    for(let a = 0; a <= Math.min(e, 4); a++) for(let k = 0; k <= NG; k++) if(rows[a][k] > row[k]) row[k] = rows[a][k];
    out.push(row);
  }
  return out;
}
// 盤の★3の確率(全マス)
function boardProb(rv, focus, T, qt, prm){
  const G = prm.endStep, NG = Math.max(0, Math.floor(focus / G));
  let W = null;
  for(const r of rv){ const c = cellTable(qt, r, T, NG, G); W = W ? combine(W, c, T, NG) : c; }
  return W ? W[T][NG] : 0;
}
// この手のあと、弱いのターンが来るまでに待つターン数の見込み × 1ターンの消費の見込み
// kind: 'lock'(今のターンに精神統一)/ 'shift'(今のターンにシフト)/ それ以外
function accessCost(g, kind, prm){
  const seq = [];   // 次のターンからの強さ(弱いになる確率)
  let idx = g.cycleIdx;
  const L = g.cycle.length;
  if(kind === 'lock'){
    for(let k = 0; k < 3; k++) seq.push(g.power === 'weak' ? 1 : 0);
    idx = (idx + 1) % L;
  } else if(g.lockRem > 1){
    for(let k = 1; k < g.lockRem; k++) seq.push(g.lockedPower === 'weak' ? 1 : 0);
    idx = (idx + 1) % L;
  } else {
    idx = (idx + 1) % L;
    if(kind === 'shift'){ seq.push(g.power === 'weak' ? 0 : 0.25); idx = (idx + 1) % L; }
  }
  for(let k = 0; k < 2 * L && seq.length < 16; k++){ const p = g.cycle[idx]; seq.push(p === 'weak' ? 1 : p === 'unknown' ? 0.2 : 0); idx = (idx + 1) % L; }
  let pNot = 1, exp = 0;
  for(const pw of seq){
    if(pw >= 1) break;
    exp += pNot * (1 - pw);
    pNot *= 1 - pw;
    if(pNot < 0.01) break;
  }
  return exp * prm.waitCost;
}
// 1マスに縫った時(今のターンの強さ・会心率・光ったマス)の、残りの分布 [[r', 確率], ...]
function outcomes(g, cfg, i, mul, aim, isHog){
  const r = g.base[i] - g.cum[i], cm = (g.shitsuke[i] ? 2 : 1) * (g.glow === i ? SEW.P.glowMul : 1);
  const out = new Map(), add = (x, p) => out.set(x, (out.get(x) || 0) + p);
  if(isHog){
    for(let b = 6; b <= 9; b++){ const v = Math.min(Math.floor(b * SEW.POWER[g.power] * cm), g.cum[i]); add(r + v, 0.25); }
    return [...out];
  }
  const q = r > 0 ? Math.min(1, SEW.critRate(g, cfg, i, aim)) : 0;
  for(let b = 12; b <= 18; b++){
    const v = SEW.rollValue(b, mul, g.power, cm);
    add(r - v, (1 - q) / 7);
    if(q > 0) add(r - Math.min(2 * v, r), q / 7);
  }
  return [...out];
}
// 盤の値の準備: 各マスの表と、そのマスを除いた残りの合成(前からの合成・後ろからの合成)
function endPrep(rv, focus, T, qt, prm){
  const G = prm.endStep, NG = Math.max(0, Math.floor(focus / G)), n = rv.length;
  const cells = rv.map(r => cellTable(qt, r, T, NG, G));
  const pre = [], suf = [];
  for(let i = 0; i < n; i++) pre.push(i ? combine(pre[i - 1], cells[i], T, NG) : cells[i]);
  for(let i = n - 1; i >= 0; i--) suf[i] = i < n - 1 ? combine(cells[i], suf[i + 1], T, NG) : cells[i];
  const loo = [];
  for(let i = 0; i < n; i++){
    const L = i > 0 ? pre[i - 1] : null, R = i < n - 1 ? suf[i + 1] : null;
    loo.push(L && R ? combine(L, R, T, NG) : (L || R || null));
  }
  return { G, NG, T, cells, loo, all: pre[n - 1] };
}
// マス i の残りを r' にした時の、盤の★3の確率(集中力 focus' で)
function looValue(ep, qt, i, r2, focus2, Wx){
  const k2 = Math.floor(focus2 / ep.G);
  if(k2 < 0) return 0;
  const k = Math.min(k2, ep.NG), rows = cellRow(qt, r2, k, ep.G), W = Wx === undefined ? ep.loo[i] : Wx;
  let best = 0;
  for(let a = 0; a <= Math.min(ep.T, 4); a++){
    const ra = rows[a];
    for(let k1 = 0; k1 <= k; k1++){
      const v = ra[k1] * (W ? W[ep.T - a][k - k1] : 1);
      if(v > best) best = v;
    }
  }
  return best;
}
// 終盤の手選び。★3 になる確率が一番高い手(どの手でも0に近ければ null を返して、ふだんの選び方に任せる)
function chooseEnd(g, cfg, ctx, list){
  const prm = ctx.prm, T = ctx.T;
  const qrw = g.cloth === 'regen' ? (prm.qRegen ? prm.qRegenWait : (prm.qRegenN && prm.qRegenN[g.n] !== undefined ? prm.qRegenN[g.n] : null)) : null;
  const qt = qTables(cfg, g.muga, qrw === null ? prm : Object.assign({}, prm, { qRegenWait: qrw }), qrw !== null);
  const rv = g.base.map((b, i) => b - g.cum[i]);
  const ep = endPrep(rv, g.focus, T, qt, prm);
  const regenNext = g.cloth === 'regen' && SEW.isTraitTurn(g.turn + 2);
  let rp = null;   // 再生の準備(使う時に作る)
  let best = { v: -1, s: -1 };
  const all = [];
  // v: ★3 の確率。s: 選ぶ時の点(endTieW > 0 なら、集中力を endTieMul 倍に減らした時の確率も、その重みで足す)
  const consider = (v, m, s) => { if(s === undefined) s = v; all.push({ v, m, s }); if(s > best.s + 1e-9) best = { v, m, s }; };
  const tw = prm.endTieW || 0, tm = prm.endTieMul;
  // 縫う・糸ほぐし(1マスに当たる手)
  for(const a of ctx.actions){
    if(!a.tg || a.tg.length !== 1) continue;
    if(a.sk.kind !== 'sew' && a.sk.kind !== 'hogushi') continue;
    const cost = SEW.costOf(g, a.sk); if(cost > g.focus) continue;
    const [i, mul] = a.tg[0];
    if(a.sk.kind === 'hogushi' && rv[i] >= 0) continue;
    if(a.sk.kind === 'sew' && rv[i] <= -SEW.P.yellow) continue;
    const f2 = g.focus - cost - accessCost(g, 'none', prm);
    const outs = outcomes(g, cfg, i, mul, a.sk.aim === true, a.sk.kind === 'hogushi');
    const val = f => {
      let v = 0;
      for(const [r2, p] of outs){
        if(regenNext && !prm.regenFast){ const rv2 = rv.slice(); rv2[i] = r2; v += p * regenValueSlow(rv2, g, f, T, qt, prm, ep, i); continue; }
        v += p * (regenNext ? regenValue(rp || (rp = regenPrep(rv, g, ep, qt, T)), g, ep, qt, i, r2, f) : looValue(ep, qt, i, r2, f));
      }
      return v;
    };
    const v = val(f2);
    consider(v, { skill: a.skill, anchor: a.anchor }, tw ? v + tw * val(f2 * tm) : v);
  }
  // 複数マスに当たる手: 当たる各マスは、結果で混ぜた表にして、割り振りを先に決めた値で見る
  // (結果を見てから割り振り直せない分、1マスの手より少し低く出る)。再生の前のターンは見ない
  if(prm.endMulti && !regenNext){
    const n = rv.length;
    for(const a of ctx.actions){
      if(a.sk.kind !== 'sew' || !a.tg || a.tg.length < 2) continue;
      const cost = SEW.costOf(g, a.sk); if(cost > g.focus) continue;
      if(a.tg.some(([i]) => rv[i] <= 0)) continue;   // 仕上がった・縫いすぎのマスに当たる手は見ない
      const f2 = g.focus - cost - accessCost(g, 'none', prm), k2 = Math.floor(f2 / ep.G);
      if(k2 < 0) continue;
      const S = new Set(a.tg.map(x => x[0]));
      let W = null;
      for(let k = 0; k < n; k++){ if(S.has(k)) continue; W = W ? combine(W, ep.cells[k], T, ep.NG) : ep.cells[k]; }
      for(const [i, mul] of a.tg){
        const mix = mixOutcomeTable(g, cfg, qt, i, mul, T, ep.NG, ep.G);
        W = W ? combine(W, mix, T, ep.NG) : mix;
      }
      consider(W[T][Math.min(k2, ep.NG)], { skill: a.skill, anchor: a.anchor });
    }
  }
  // 精神統一(弱いの時): 固定の消費は表の1手あたりの割り振りで見込んでいるので、ここでは使う時の差だけ
  const sei = SEW.SKILL.seishin;
  if(sei.lv <= cfg.level && g.power === 'weak' && g.lockRem <= 1 && g.focus >= sei.cost){
    const need = rv.filter(r => Math.abs(r) > 1).length + (SEW.judge(g).total > T ? rv.filter(r => Math.abs(r) === 1).length : 0);
    if(need >= 2){ if(list) all.push({ v: Infinity, s: Infinity, m: { skill: 'seishin', why: '弱いで固定して仕上げ' } }); else return { skill: 'seishin', why: '弱いで固定して仕上げ' }; }
  }
  // シフト(弱いでない時に、次を変える)
  const sh = SEW.SKILL.shift;
  if(sh.lv <= cfg.level && g.power !== 'weak' && g.focus >= sh.cost && g.lockRem <= 1){
    const f2 = g.focus - sh.cost - accessCost(g, 'shift', prm);
    const v = regenNext ? 0 : ep.all ? valueAt(ep, f2) : 0;
    consider(v, { skill: 'shift', why: '弱いを待つ' }, tw && !regenNext && ep.all ? v + tw * valueAt(ep, f2 * tm) : v);
  }
  if(list) return all.sort((x, y) => y.s - x.s).map(x => Object.assign({ pStar3: x.v }, x.m));
  if(best.v < prm.endMinP) return null;
  return Object.assign({ pStar3: best.v }, best.m);
}
// 1マスに縫った結果で混ぜた表
function mixOutcomeTable(g, cfg, qt, i, mul, T, NG, G){
  const outs = outcomes(g, cfg, i, mul, false, false);
  const acc = []; for(let e = 0; e <= T; e++) acc.push(new Float32Array(NG + 1));
  for(const [r2, p] of outs){ const t = cellTable(qt, r2, T, NG, G); for(let e = 0; e <= T; e++){ const a = acc[e], b = t[e]; for(let k = 0; k <= NG; k++) a[k] += p * b[k]; } }
  return acc;
}
function valueAt(ep, focus2){ const k = Math.floor(focus2 / ep.G); return k < 0 ? 0 : ep.all[ep.T][Math.min(k, ep.NG)]; }
// 再生が次のターンの始めに起きる時の準備。マス i を縫う手ごとに、i 以外で戻るマス t0(割合が一番大きい黄色でないマス)を、
// 12〜16 戻った後の表の平均に置き換えて、i を除いた合成を作っておく
function regenPrep(rv, g, ep, qt, T){
  const n = rv.length, out = [];
  const ratio = k => (g.base[k] - rv[k]) / g.base[k];
  const mixCache = {};
  for(let i = 0; i < n; i++){
    let t0 = -1, best = -Infinity;
    for(let k = 0; k < n; k++){ if(k === i || Math.abs(rv[k]) <= SEW.P.yellow) continue; const q = ratio(k); if(q > best){ best = q; t0 = k; } }
    let W = ep.loo[i];
    if(t0 >= 0){
      const mix = mixCache[t0] || (mixCache[t0] = mixTable(qt, rv[t0], g.cum[t0], T, ep.NG, ep.G));
      W = null;
      for(let k = 0; k < n; k++){ if(k === i) continue; const c = k === t0 ? mix : ep.cells[k]; W = W ? combine(W, c, T, ep.NG) : c; }
    }
    out.push({ t0, best, W });
  }
  return out;
}
// 戻る量 12〜16 で平均した、1マスの表
function mixTable(qt, r, cum, T, NG, G){
  const tabs = SEW.P.regen.map(a => cellTable(qt, r + Math.min(a, cum), T, NG, G));
  return tabs[0].map((row, e) => { const m = new Float32Array(NG + 1); for(let k = 0; k <= NG; k++){ let s = 0; for(const t of tabs) s += t[e][k]; m[k] = s / tabs.length; } return m; });
}
// マス i の残りが r2 になった時の値(次のターンの始めの再生を入れて)
function regenValue(rp, g, ep, qt, i, r2, f2){
  const x = rp[i], cum2 = g.base[i] - r2;
  if(Math.abs(r2) > SEW.P.yellow && cum2 / g.base[i] > x.best){
    // 縫ったマス自身が戻る
    let s = 0; for(const a of SEW.P.regen) s += looValue(ep, qt, i, r2 + Math.min(a, cum2), f2);
    return s / SEW.P.regen.length;
  }
  return looValue(ep, qt, i, r2, f2, x.W);
}

// (比べる用)再生の前の手を、戻る量ごとに盤の値を全部作り直して評価する。遅い
function regenValueSlow(rv2, g, f2, T, qt, prm, ep, i){
  let t = -1, best = -Infinity;
  for(let k = 0; k < rv2.length; k++){
    if(Math.abs(rv2[k]) <= SEW.P.yellow) continue;
    const q = (g.base[k] - rv2[k]) / g.base[k]; if(q > best){ best = q; t = k; }
  }
  if(t < 0) return looValue(ep, qt, i, rv2[i], f2);
  let s = 0;
  for(const amt of SEW.P.regen){
    const cum = g.base[t] - rv2[t], rr = rv2[t] + Math.min(amt, cum);
    if(t === i) s += looValue(ep, qt, i, rr, f2);
    else { const rv3 = rv2.slice(); rv3[t] = rr; s += boardProb(rv3, f2, T, qt, prm); }
  }
  return s / SEW.P.regen.length;
}

// 今の局面で打つ手。g は beginTurn の後(今のターンの強さ・布の特性が出ている)
// 推奨手。ふだんの選び方の手を、設定があれば試し打ちで確かめる(終盤は chooseEndMC、削りは chooseBulkMC)。
// 試し打ちの中(ctx._roll)では確かめない
function choose(g, cfg, ctx){
  const m = choosePlain(g, cfg, ctx);
  const P = ctx.prm.bulkMC;
  if(!P || ctx._roll || m.finish || m.end) return m;
  return chooseBulkMC(g, cfg, ctx, m, P);
}
function choosePlain(g, cfg, ctx){
  const j = SEW.judge(g);
  const allYellow = g.base.every((b, i) => Math.abs(b - g.cum[i]) <= SEW.P.yellow);
  if(allYellow && j.total <= ctx.T) return { finish: true, why: '★3の範囲' };
  if(g.focus < 5) return { finish: true, why: '集中力切れ' };
  if(ctx.prm.endOn && g.base.every((b, i) => Math.abs(b - g.cum[i]) <= ctx.prm.endR)){
    const m = ctx.prm.endMC && !ctx._roll ? chooseEndMC(g, cfg, ctx) : chooseEnd(g, cfg, ctx);
    if(m){ m.end = true; return m; }
  }
  const best = bestAction(g, cfg, ctx);
  // 精神統一(固定の最後のターンか、固定していない時)
  const seishin = SEW.SKILL.seishin;
  const upTurn = g.cloth === 'rainbow' && SEW.isTraitTurn(g.turn + 1) && SEW.rainbowMode(g.turn + 1) === 'up';
  if(seishin.lv <= cfg.level && g.lockRem <= 1 && g.focus >= seishin.cost + 5 && !(ctx.prm.noLockOnUp && upTurn) && lockWorth(g, cfg, ctx)){
    const lg = lockGain(g, cfg, ctx);
    if(lg > ctx.prm.lockMin) return { skill: 'seishin', why: `固定の得 ${lg.toFixed(1)}` };
    // 削りがまだ多く残っている間は、強い・最強の固定を続ける(小さいマスができて、1手の得が小さく見えても)
    if(ctx.prm.bulkLock !== null && (g.power === 'strong' || g.power === 'strongest') && best && best.net > ctx.prm.bulkLockNet){
      const rem = g.base.reduce((s, b, i) => s + Math.max(0, b - g.cum[i] - ctx.prm.r1), 0);
      if(rem >= ctx.prm.bulkLock) return { skill: 'seishin', why: `削りが残り ${rem}` };
    }
  }
  if(!best) return { finish: true, why: '打てる手がない' };
  // 全マス黄色で、どの手も得にならないなら仕上げる
  if(allYellow && best.net <= 0) return { finish: true, why: '直す得がない' };
  return { skill: best.a.skill, anchor: best.a.anchor, net: best.net };
}

/* ---- 先読み(試し打ち) ----
   候補の手(ふだんの選び方で上位の手)ごとに、その手を打ってから最後まで、ふだんの選び方で打ち切る試しを何本か回し、
   ★3 になった本数が一番多い手を選ぶ。どの候補も同じ乱数の並び(本数ごとに同じ種)で試す(比べる時のぶれを減らす)。 */
function candidates(g, cfg, ctx, K){
  const out = [], seen = new Set();
  const push = m => { const k = JSON.stringify([m.finish ? 'F' : m.skill, m.anchor || null]); if(!seen.has(k)){ seen.add(k); out.push(m); } };
  push(choose(g, cfg, ctx));
  // 終盤: ★3 になる確率の上位
  if(ctx.prm.endOn && g.base.every((b, i) => Math.abs(b - g.cum[i]) <= ctx.prm.endR)){
    const L = chooseEnd(g, cfg, ctx, true);
    for(const m of L){ if(out.length >= K) break; if(m.pStar3 >= ctx.prm.endMinP) push(m); }
    if(out.length >= 2) return out.slice(0, K);
  }
  // 精神統一(固定できる時)
  const sei = SEW.SKILL.seishin;
  if(sei.lv <= cfg.level && g.lockRem <= 1 && g.focus >= sei.cost + 5) push({ skill: 'seishin' });
  // ふだんの評価で上位の手
  const scored = [];
  for(const a of ctx.actions){ const e = evalAction(g, cfg, ctx, a); if(e) scored.push(e); }
  scored.sort((x, y) => y.net - x.net);
  for(const e of scored){ if(out.length >= K) break; push({ skill: e.a.skill, anchor: e.a.anchor }); }
  return out.slice(0, K);
}
// 終盤の際どい判断だけ試し打ちで確かめる。上位の手の見込みが近い時に、候補ごとに同じ種で R 本打ち切り、
// ふだんの手より片方だけ★3 の局の差で z 以上はっきり良い時だけ乗り換える
function chooseEndMC(g, cfg, ctx){
  const P = ctx.prm.endMC;
  const L = chooseEnd(g, cfg, ctx, true);
  if(!L.length) return null;
  const base = L[0];
  if(!isFinite(base.pStar3)) return base;
  if(base.pStar3 < ctx.prm.endMinP) return null;
  const cands = [base];
  for(const m of L.slice(1)){
    if(cands.length >= P.K) break;
    if(!isFinite(m.pStar3) || m.pStar3 < P.lo) continue;
    if(base.pStar3 - m.pStar3 > P.gap) break;
    cands.push(m);
  }
  if(cands.length < 2 || base.pStar3 > P.hi) return base;
  return mcCompare(g, cfg, ctx, cands, P);
}
// 削りの手を試し打ちで確かめる。候補は ふだんの手(base)・精神統一(固定できる時)・ふだんの評価の上位で、P.K 個まで
function chooseBulkMC(g, cfg, ctx, base, P){
  const key = m => JSON.stringify([m.skill, m.anchor || null]);
  const cands = [base], seen = new Set([key(base)]);
  const push = m => { const k = key(m); if(!seen.has(k)){ seen.add(k); cands.push(m); } };
  const sei = SEW.SKILL.seishin;
  if(cands.length < P.K && sei.lv <= cfg.level && g.lockRem <= 1 && g.focus >= sei.cost + 5) push({ skill: 'seishin' });
  const sc = [];
  for(const a of ctx.actions){ const e = evalAction(g, cfg, ctx, a); if(e) sc.push(e); }
  sc.sort((x, y) => y.net - x.net);
  for(const e of sc){ if(cands.length >= P.K) break; push({ skill: e.a.skill, anchor: e.a.anchor, net: e.net }); }
  if(cands.length < 2) return base;
  return mcCompare(g, cfg, ctx, cands, P);
}
// 候補(先頭がふだんの手)ごとに同じ種で P.R 本ずつ最後まで打ち切り、ふだんの手より「片方だけ★3」の本数の差で
// z ≥ P.z はっきり良い手があれば、その手に乗り換える。種は局面と P.seed から作る(同じ局面では同じ手)
function mcCompare(g, cfg, ctx, cands, P){
  if(P.batch) return mcRace(g, cfg, ctx, cands, P);
  const base = cands[0];
  let h = (P.seed + g.turn * 7919 + g.focus * 104729) >>> 0;
  for(let i = 0; i < g.n; i++) h = (Math.imul(h ^ (g.cum[i] + 1000), 2654435761) + i) >>> 0;
  // 本数ごとに全候補を打つ(同じ種どうしで比べるため)。P.ms(ミリ秒)を過ぎたら、そこまでの本数で比べる
  // (遅い端末で待たせすぎないため。本数が減ると乗り換えの基準に届きにくくなり、ふだんの手に近づく)
  const t0 = P.ms ? Date.now() : 0;
  const res = cands.map(() => []);
  let R = 0;
  ctx._roll = true;
  for(let j = 0; j < P.R; j++){
    for(let k = 0; k < cands.length; k++) res[k].push(rollout(g, cfg, ctx, cands[k], (h + j * 9973) >>> 0));
    R = j + 1;
    if(P.ms && Date.now() - t0 > P.ms) break;
  }
  ctx._roll = false;
  let best = base, bestZ = -Infinity;
  for(let k = 1; k < cands.length; k++){
    let a = 0, b = 0;
    for(let j = 0; j < R; j++){ if(res[k][j] && !res[0][j]) a++; if(res[0][j] && !res[k][j]) b++; }
    const z = a + b ? (a - b) / Math.sqrt(a + b) : 0;
    if(z >= P.z && z > bestZ){ bestZ = z; best = cands[k]; }
  }
  return best;
}
// mcCompare の打ち切りあり版(P.batch 本ずつ回す)。そのつど、ふだんの手との「片方だけ★3」を数え、
// 残りの本数を全部勝っても z ≥ P.z に届かない候補と、z ≤ −P.drop のはっきり悪い候補は、そこで打ち切る。
// 乗り換えは、打ち切られずに残った候補を、最後まで回した本数で z ≥ P.z の時だけ(基準は打ち切りなしと同じ)
function mcRace(g, cfg, ctx, cands, P){
  const base = cands[0];
  let h = (P.seed + g.turn * 7919 + g.focus * 104729) >>> 0;
  for(let i = 0; i < g.n; i++) h = (Math.imul(h ^ (g.cum[i] + 1000), 2654435761) + i) >>> 0;
  const t0 = P.ms ? Date.now() : 0;
  const res = cands.map(() => []);
  let alive = cands.map((c, k) => k).slice(1);
  const dz = (k, n) => { let a = 0, b = 0; for(let j = 0; j < n; j++){ if(res[k][j] && !res[0][j]) a++; if(res[0][j] && !res[k][j]) b++; } return [a, b]; };
  let n = 0;
  ctx._roll = true;
  while(n < P.R && alive.length){
    const to = Math.min(P.R, n + P.batch);
    for(let j = n; j < to; j++){
      const sd = (h + j * 9973) >>> 0;
      res[0].push(rollout(g, cfg, ctx, base, sd));
      for(const k of alive) res[k].push(rollout(g, cfg, ctx, cands[k], sd));
    }
    n = to;
    const rest = P.R - n;
    alive = alive.filter(k => {
      const [a, b] = dz(k, n);
      const zNow = a + b ? (a - b) / Math.sqrt(a + b) : 0;
      const zMax = (a + rest + b) ? (a + rest - b) / Math.sqrt(a + rest + b) : 0;
      return zMax >= P.z && zNow > -(P.drop || 1.5);
    });
    if(P.ms && Date.now() - t0 > P.ms) break;
  }
  ctx._roll = false;
  let best = base, bestZ = -Infinity;
  for(const k of alive){
    const [a, b] = dz(k, n);
    const z = a + b ? (a - b) / Math.sqrt(a + b) : 0;
    if(z >= P.z && z > bestZ){ bestZ = z; best = cands[k]; }
  }
  return best;
}
function rollout(g, cfg, ctx, first, seed, opts){
  const rng = SEW.makeRng(seed);
  const g2 = SEW.cloneGame(g);
  let res = SEW.act(g2, first, cfg, rng);
  if(!res.ok && !first.finish) return 0;
  if(!g2.finished) SEW.beginTurn(g2, cfg, rng);
  for(let k = 0; k < 200 && !g2.finished; k++){
    const m = choose(g2, cfg, ctx);
    res = SEW.act(g2, m, cfg, rng);
    if(!res.ok && !m.finish){ SEW.act(g2, { finish: true }, cfg, rng); break; }
    if(!g2.finished) SEW.beginTurn(g2, cfg, rng);
  }
  if(!g2.finished) SEW.act(g2, { finish: true }, cfg, rng);
  return SEW.judge(g2).star === 3 ? 1 : 0;
}
// mc: { K: 候補の数, R: 1候補あたりの試しの本数, seed: 種の始め }
function chooseMC(g, cfg, ctx, mc){
  const base = choose(g, cfg, ctx);
  if(base.finish) return base;
  const cands = candidates(g, cfg, ctx, mc.K);
  if(cands.length <= 1) return base;
  let best = null;
  for(const c of cands){
    let w = 0;
    for(let j = 0; j < mc.R; j++) w += rollout(g, cfg, ctx, c, (mc.seed + j * 7919) >>> 0, null);
    if(!best || w > best.w) best = { w, c };
  }
  return Object.assign({ mcWins: best.w, mcRuns: mc.R }, best.c);
}

/* ---- 1局を打ち切る(試験用) ---- */
function playGame(recipe, cfg, seed, ctx, opts){
  const mc = opts && opts.mc;
  const rng = SEW.makeRng(seed);
  const g = SEW.newGame(recipe, cfg, rng, opts);
  SEW.beginTurn(g, cfg, rng);
  let moves = 0;
  while(!g.finished && moves < 200){
    const m = mc ? chooseMC(g, cfg, ctx, Object.assign({}, mc, { seed: (seed * 131 + moves * 977 + 12345) >>> 0 })) : choose(g, cfg, ctx);
    const res = SEW.act(g, m, cfg, rng);
    if(!res.ok && !m.finish){ SEW.act(g, { finish: true }, cfg, rng); break; }
    moves++;
    if(!g.finished) SEW.beginTurn(g, cfg, rng);
  }
  if(!g.finished) SEW.act(g, { finish: true }, cfg, rng);
  const j = SEW.judge(g);
  return { star: j.star, total: j.total, focus: g.focus, turns: g.turn };
}

const SEW_AI = { DEF, prepare, choose, chooseMC, bestAction, evalAction, playGame, finishTable, rollout, candidates };
root.SEW_AI = SEW_AI;
if(typeof module !== 'undefined' && module.exports) module.exports = SEW_AI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
