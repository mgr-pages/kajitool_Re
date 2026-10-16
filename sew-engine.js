/* =====================================================================
   さいほう職人のルール(盤・ターン・ぬいパワー・値・会心・布の特性・できのよさ)
   ・鍛冶の engine.js とは別の名前の空間 SEW に入れる(同じ画面に読み込んでもぶつからない)。
   ・ブラウザでは通常の <script> で読み込む(sew-recipes.js の後)。Node では require できる。
   ・ルールの決めごと(利用者の決定):
       1. 虹布の会心ターンは会心率7倍。ねらいぬいと重なる時は足し算(7 + 7 = 14倍)。
          照合用に、会心率 +24%(足し算)の扱いも持っている(opts.rainbowAdd)。
       2. 必殺チャージは起こさない(照合用に opts.hsCharge で起こせる)。
   ・乱数は rng.next()(0以上1未満)と rng.nextInt(n) を持つものを渡す。
     乱数を引く順番は決めてある(同じ種・同じ手なら同じ結果になる)。
     回帰テストは tests/sew-rules.js。
   ===================================================================== */
'use strict';
(function(root){

const P = {
  kotsu: 0.01,            // コツ(そのレシピのコツを取得済み)
  passive: 0.001,         // 会心率アップ(Lv10 以上で合計 +0.1%)
  aim: 7,                 // ねらいぬい
  rainbowUp: 7,           // 虹布の会心ターン(利用者の決定。ねらいぬいと足し算)
  rainbowUpAdd: 0.24,     // 照合用の虹布の会心ターン(+24%、足し算)。opts.rainbowAdd の時だけ使う
  glow: 0.24,             // 光布の光ったマス(+24%)
  muga: 2,                // 必殺「無我の境地」のあと
  shiftCrit: 2,           // シフト会心(シフトで出た会心×２)
  hsBase: 0.00233,        // 必殺チャージ(照合用。opts.hsCharge の時だけ)
  traitFirst: 5, traitEvery: 4,                 // 布の特性: 5・9・13…ターン目の始め
  regen: [12, 13, 14, 15, 16],
  rainbowUpCost: 1.5,
  glowMul: 2,
  recover: { lv: 70, below: 10, chance: 0.1, amount: 30 },
  yellow: 4, penalty: 9,  // 差4以内が黄色。差5〜8は9として数える
  maxCum: 999,
};
const POWER = { weak: 0.5, normal: 1, critx2: 1, strong: 1.5, strongest: 2, unknown: 1 };
const POWER5 = ['weak', 'normal', 'strong', 'strongest', 'critx2'];   // 「？」とシフトの行き先
const POWER_JA = { weak: '弱い', normal: '普通', strong: '強い', strongest: '最強', critx2: '会心×２', unknown: '？' };

const NEEDLES = {
  copper:   { name: '銅',       focus: 0,  crit: [0.010, 0.011, 0.012, 0.020] },
  iron:     { name: '鉄',       focus: 10, crit: [0.015, 0.016, 0.017, 0.025] },
  silver:   { name: '銀',       focus: 15, crit: [0.020, 0.021, 0.022, 0.030] },
  platinum: { name: 'プラチナ', focus: 25, crit: [0.025, 0.026, 0.027, 0.035] },
  super:    { name: '超',       focus: 35, crit: [0.030, 0.031, 0.032, 0.040] },
  miracle:  { name: '奇跡',     focus: 50, crit: [0.033, 0.034, 0.035, 0.043], opening: { type: 'focus', chance: 0.3, amount: 30 } },
  light:    { name: '光',       focus: 45, crit: [0.036, 0.037, 0.038, 0.046], opening: { type: 'charge', chance: 0.1 } },
};
// 職人Lv 1〜80 で決まる集中力
const FOCUS_BASE = [50,51,54,56,58,61,62,65,68,68,71,74,74,77,79,82,82,85,88,88,91,94,94,97,100,100,103,105,108,108,
  111,112,112,114,118,121,122,122,124,128,131,133,136,138,138,141,141,143,146,148,151,151,153,156,158,161,161,163,166,168,
  170,170,172,174,176,179,181,183,185,187,189,191,193,195,197,199,201,203,205,207];

// 特技。target は当たる形(選んだマスからのずれ [行, 列])
const SKILLS = [
  { id: 'nuu',      name: 'ぬう',         lv: 1,  cost: 5,  kind: 'sew', mul: 1,    target: 'single' },
  { id: 'yoko',     name: 'ヨコぬい',     lv: 2,  cost: 8,  kind: 'sew', mul: 1,    target: 'row2' },
  { id: 'kagen',    name: 'かげんぬい',   lv: 3,  cost: 10, kind: 'sew', mul: 0.5,  target: 'single' },
  { id: 'taki',     name: '滝のぼり',     lv: 5,  cost: 8,  kind: 'sew', mul: 1,    target: 'col2' },
  { id: 'tasuki',   name: 'たすきぬい',   lv: 7,  cost: 7,  kind: 'sew', mul: 1,    target: 'diag_up2' },
  { id: 'nibai',    name: '2倍ぬい',      lv: 13, cost: 9,  kind: 'sew', mul: 2,    target: 'single' },
  { id: 'suihei',   name: '水平ぬい',     lv: 15, cost: 10, kind: 'sew', mul: 1,    target: 'row3' },
  { id: 'seishin',  name: '精神統一',     lv: 17, cost: 7,  kind: 'lock' },
  { id: 'otaki',    name: '大滝のぼり',   lv: 19, cost: 10, kind: 'sew', mul: 1,    target: 'col3' },
  { id: 'nerai',    name: 'ねらいぬい',   lv: 23, cost: 16, kind: 'sew', mul: 1,    target: 'single', aim: true },
  { id: 'gyaku',    name: '逆たすきぬい', lv: 25, cost: 7,  kind: 'sew', mul: 1,    target: 'diag_down2' },
  { id: 'hogushi',  name: '糸ほぐし',     lv: 27, cost: 16, kind: 'hogushi', target: 'single' },
  { id: 'sanbai',   name: '3倍ぬい',      lv: 33, cost: 12, kind: 'sew', mul: 3,    target: 'single' },
  { id: 'shift',    name: 'ぬいパワーシフト', lv: 38, cost: 7, kind: 'shift' },
  { id: 'shitsuke', name: 'しつけがけ',   lv: 47, cost: 13, kind: 'shitsuke', target: 'single' },
  { id: 'makikomi', name: '巻きこみぬい', lv: 52, cost: 13, kind: 'sew', target: 'plus5', center: 1.5, around: 0.75 },
  { id: 'hankagen', name: '半かげんぬい', lv: 75, cost: 12, kind: 'sew', mul: 0.75, target: 'single' },
  { id: 'midare',   name: 'みだれぬい',   lv: 80, cost: 7,  kind: 'midare', muls: [2, 1, 1, 0.5] },
  { id: 'muga',     name: '無我の境地',   lv: 40, cost: 0,  kind: 'muga' },
];
const SKILL = {}; for(const s of SKILLS) SKILL[s.id] = s;
const PATTERNS = {
  single: [[0, 0]], row2: [[0, 0], [0, 1]], col2: [[0, 0], [-1, 0]], diag_up2: [[0, 0], [-1, 1]], diag_down2: [[0, 0], [-1, -1]],
  row3: [[0, -1], [0, 0], [0, 1]], col3: [[-1, 0], [0, 0], [1, 0]], plus5: [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]],
};
const MOVABLE = new Set(['row2', 'col2', 'row3', 'col3', 'diag_up2', 'diag_down2']);
const DIAG = new Set(['diag_up2', 'diag_down2']);

// できのよさの境界(誤差の合計がこれ以下)。oldLimit は実装時期の古い一部のレシピ
const EVAL = {
  4: { star3: 2, star2: 7, star1: 16, star0: 29 }, 6: { star3: 4, star2: 11, star1: 24, star0: 39 },
  7: { star3: 5, star2: 17, star1: 27, star0: 30 }, 9: { star3: 8, star2: 17, star1: 36, star0: 49 },
};
const EVAL_OLD = {
  4: { star3: 1, star2: 5, star1: 16, star0: 29 }, 6: { star3: 3, star2: 8, star1: 24, star0: 39 }, 9: { star3: 6, star2: 13, star1: 36, star0: 49 },
};

/* ---- 乱数(種を決めれば同じ並びになる) ---- */
function makeRng(seed){
  let st = seed >>> 0;
  return {
    next(){
      st = st + 1831565813 >>> 0;
      let n = st;
      n = Math.imul(n ^ n >>> 15, n | 1);
      n ^= n + Math.imul(n ^ n >>> 7, n | 61);
      return ((n ^ n >>> 14) >>> 0) / 4294967296;
    },
    nextInt(k){ return Math.floor(this.next() * k); },
    get state(){ return st >>> 0; },
  };
}

/* ---- 当たるマス ---- */
// 範囲が布からはみ出す時に、収まる位置へずらす
function clampAnchor(type, pat, a, rows, cols){
  if(!MOVABLE.has(type)) return { r: a.r, c: a.c };
  let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
  for(const [dr, dc] of pat){ r0 = Math.min(r0, dr); r1 = Math.max(r1, dr); c0 = Math.min(c0, dc); c1 = Math.max(c1, dc); }
  const rLo = 1 - r0, rHi = rows - r1, cLo = 1 - c0, cHi = cols - c1;
  const cl = (v, lo, hi) => (lo > hi || v < lo) ? lo : v > hi ? hi : v;
  if(DIAG.has(type)){
    const off = pat.find(([dr, dc]) => dr !== 0 || dc !== 0) || [0, 0];
    const sr = -Math.sign(off[0]), sc = -Math.sign(off[1]);
    const br = a.r < rLo ? rLo - a.r : a.r > rHi ? rHi - a.r : 0;
    const bc = a.c < cLo ? cLo - a.c : a.c > cHi ? cHi - a.c : 0;
    const L = Math.max(Math.abs(br), Math.abs(bc));
    return { r: cl(a.r + L * sr, rLo, rHi), c: cl(a.c + L * sc, cLo, cHi) };
  }
  return { r: cl(a.r, rLo, rHi), c: cl(a.c, cLo, cHi) };
}
// 特技と選んだ位置から、実在するマスの [番号, 倍率] の並び
function targetsOf(game, skill, anchor){
  const pat = PATTERNS[skill.target];
  const a = clampAnchor(skill.target, pat, anchor, game.rows, game.cols);
  const out = [];
  pat.forEach(([dr, dc], k) => {
    const i = game.cellAt[(a.r + dr) * 8 + (a.c + dc)];
    if(i === undefined) return;
    const mul = skill.target === 'plus5' ? (k === 0 ? skill.center : skill.around) : skill.mul;
    out.push([i, mul]);
  });
  return out;
}

/* ---- 1局 ---- */
// cfg: { level, needle(NEEDLES のキー), star(0〜3), kotsu(true/false) }
// opts: { rainbowAdd: 虹布の会心ターンを +24%(足し算)にする, hsCharge: 必殺チャージを起こす }(どちらも照合用)
function newGame(recipe, cfg, rng, opts){
  opts = opts || {};
  const nd = NEEDLES[cfg.needle];
  const g = {
    recipe, rows: recipe.rows, cols: recipe.cols, cloth: recipe.cloth, oldLimit: recipe.oldLimit,
    n: recipe.cells.length,
    pos: recipe.cells.map(c => [c.r, c.c]),
    base: recipe.cells.map(c => c.base),
    cum: recipe.cells.map(() => 0),
    shitsuke: recipe.cells.map(() => false),
    cellAt: {},
    cycle: recipe.cycle.slice(), cycleIdx: 0,
    turn: 0,                 // 終えたターンの数(今のターンは turn + 1)
    focus: FOCUS_BASE[cfg.level - 1] + nd.focus,
    power: 'normal', started: false,
    lockRem: 0, lockedPower: null, lockedShift: false,
    forced: null, shiftCrit: false, randomCrit: false,
    glow: -1,
    hsCharged: false, hsUsed: false, muga: false, recoverUsed: false,
    finished: false, opts,
  };
  recipe.cells.forEach((c, i) => { g.cellAt[c.r * 8 + c.c] = i; });
  const op = nd.opening;
  const skipCharge = op && op.type === 'charge' && cfg.level < SKILL.muga.lv;
  const ev = [];
  if(op && !skipCharge && rng.next() < op.chance){
    if(op.type === 'focus'){ g.focus += op.amount; ev.push({ kind: 'openingFocus', amount: op.amount }); }
    else { g.hsCharged = true; ev.push({ kind: 'openingCharge' }); }
  }
  g.openingEvents = ev;
  return g;
}
function cloneGame(g){
  return Object.assign({}, g, { cum: g.cum.slice(), shitsuke: g.shitsuke.slice(), cycle: g.cycle });
}
function isTraitTurn(t){ return t >= P.traitFirst && (t - P.traitFirst) % P.traitEvery === 0; }
function rainbowMode(t){ return ((t - P.traitFirst) / P.traitEvery) % 2 === 0 ? 'half' : 'up'; }

// ターンの始め: ぬいパワー → 布の特性 → まれに集中力回復。起きたことを返す
function beginTurn(g, cfg, rng){
  const ev = [];
  if(g.started || g.finished) return ev;
  let p, drawn = null, sc = false;
  if(g.lockRem > 0 && g.lockedPower){ p = g.lockedPower; sc = g.lockedShift; }
  else if(g.forced){ p = g.forced; g.forced = null; sc = p === 'critx2'; }
  else {
    p = g.cycle.length ? g.cycle[g.cycleIdx] : 'normal';
    if(p === 'unknown'){ p = POWER5[rng.nextInt(POWER5.length)]; drawn = p; }
  }
  g.power = p; g.shiftCrit = sc; g.randomCrit = drawn === 'critx2';
  const t = g.turn + 1;
  g.glow = -1;
  if(isTraitTurn(t)){
    if(g.cloth === 'light'){
      const cand = [];
      for(let i = 0; i < g.n; i++) if(g.base[i] - g.cum[i] >= P.yellow + 1) cand.push(i);
      if(cand.length){ g.glow = cand[rng.nextInt(cand.length)]; ev.push({ kind: 'glow', cell: g.glow }); }
    } else if(g.cloth === 'regen'){
      const r = applyRegen(g, rng); if(r) ev.push(r);
    } else if(g.cloth === 'rainbow'){
      ev.push({ kind: 'rainbow', mode: rainbowMode(t) });
    }
  }
  if(cfg.level >= P.recover.lv && !g.recoverUsed && g.focus <= P.recover.below && rng.next() < P.recover.chance){
    g.focus += P.recover.amount; g.recoverUsed = true; ev.push({ kind: 'recover', amount: P.recover.amount });
  }
  ev.push({ kind: 'turnStart', turn: t, power: p, drawn });
  g.started = true;
  return ev;
}
function applyRegen(g, rng){
  const cand = [];
  for(let i = 0; i < g.n; i++) if(Math.abs(g.base[i] - g.cum[i]) > P.yellow) cand.push(i);
  if(!cand.length) return null;
  let best = -Infinity;
  for(const i of cand){ const q = g.cum[i] / g.base[i]; if(q > best) best = q; }
  const top = cand.filter(i => g.cum[i] / g.base[i] === best);
  const i = top.length === 1 ? top[0] : top[rng.nextInt(top.length)];
  const amt = P.regen[rng.nextInt(P.regen.length)];
  const d = Math.min(amt, g.cum[i]);
  g.cum[i] -= d;
  return { kind: 'regen', cell: i, amount: d };
}

// その特技を、このターンに使う時の消費集中力
function costOf(g, skill){
  if(skill.kind === 'muga') return 0;
  const c = skill.cost || 0;
  if(g.cloth !== 'rainbow') return c;
  const t = g.turn + 1;
  if(!isTraitTurn(t)) return c;
  return Math.ceil(c * (rainbowMode(t) === 'half' ? 0.5 : P.rainbowUpCost));
}
// そのマスへの会心率
function critRate(g, cfg, cell, aim){
  let b = NEEDLES[cfg.needle].crit[cfg.star];
  if(cfg.kotsu) b += P.kotsu;
  if(cfg.level >= 10) b += P.passive;
  const t = g.turn + 1;
  const up = g.cloth === 'rainbow' && isTraitTurn(t) && rainbowMode(t) === 'up';
  let a;
  if(g.opts.rainbowAdd){
    a = b * (aim ? P.aim : 1) + (up ? P.rainbowUpAdd : 0);
  } else {
    const m = (aim ? P.aim : 0) + (up ? P.rainbowUp : 0);
    a = b * (m || 1);
  }
  if(g.glow === cell) a += P.glow;
  if(g.muga) a *= P.muga;
  if(g.power === 'critx2' && g.shiftCrit) a *= P.shiftCrit;
  return a;
}
function cellMul(g, i){ let m = 1; if(g.shitsuke[i]) m *= 2; if(g.glow === i) m *= P.glowMul; return m; }
// 1マスの値(会心の前)
function rollValue(base, mul, power, cm){ return Math.ceil(Math.ceil(Math.ceil(base * mul) * POWER[power]) * cm); }

function sewCell(g, cfg, rng, i, mul, aim, ev){
  const cm = cellMul(g, i), rem = g.base[i] - g.cum[i], b = 12 + rng.nextInt(7);
  let v = rollValue(b, mul, g.power, cm), crit = false, capped = false;
  if(rem > 0) crit = rng.next() < critRate(g, cfg, i, aim);
  if(crit) v *= 2;
  if(crit && v > rem){ v = rem; capped = true; }
  if(g.cum[i] + v > P.maxCum) v = Math.max(0, P.maxCum - g.cum[i]);
  g.cum[i] += v; g.shitsuke[i] = false;
  ev.push({ kind: 'sew', cell: i, value: v, base: b, crit, capped });
  return v;
}

// 手: { skill: 特技の id, anchor: {r, c}(1マス・複数マスの特技・しつけがけ・糸ほぐし) } か { finish: true }
// 集中力が足りない・当たるマスがない時は何もしないで { ok: false } を返す
function act(g, move, cfg, rng){
  const ev = beginTurn(g, cfg, rng);
  if(g.finished) return { ok: false, events: ev };
  if(move.finish){ g.finished = true; ev.push(Object.assign({ kind: 'finish' }, judge(g))); return { ok: true, events: ev }; }
  const sk = SKILL[move.skill];
  if(!sk) throw new Error('不明な特技: ' + move.skill);
  if(cfg.level < sk.lv) throw new Error(`${sk.name} は職人Lv${sk.lv} から`);
  const cost = costOf(g, sk);
  if(cost > g.focus){ ev.push({ kind: 'noFocus', cost }); return { ok: false, events: ev }; }
  let dmg = 0;
  if(sk.kind === 'sew'){
    const tg = targetsOf(g, sk, move.anchor);
    if(!tg.length){ ev.push({ kind: 'noTarget' }); return { ok: false, events: ev }; }
    for(const [i, mul] of tg) dmg += sewCell(g, cfg, rng, i, mul, sk.aim === true, ev);
  } else if(sk.kind === 'midare'){
    const idx = []; for(let i = 0; i < g.n; i++) idx.push(i);
    const k = Math.min(sk.muls.length, g.n), pick = [];
    for(let h = 0; h < k; h++){ const j = h + rng.nextInt(g.n - h); [idx[h], idx[j]] = [idx[j], idx[h]]; pick.push(idx[h]); }
    for(let h = 0; h < k; h++) dmg += sewCell(g, cfg, rng, pick[h], sk.muls[h], false, ev);
  } else if(sk.kind === 'hogushi'){
    const i = g.cellAt[move.anchor.r * 8 + move.anchor.c];
    if(i === undefined) throw new Error('糸ほぐし: マスがありません');
    const b = 6 + rng.nextInt(4);
    let v = Math.ceil(-b * POWER[g.power] * cellMul(g, i));
    if(g.cum[i] + v < 0) v = -g.cum[i];
    g.cum[i] += v; g.shitsuke[i] = false;
    ev.push({ kind: 'sew', cell: i, value: v, base: b, crit: false, capped: v === 0 });
  } else if(sk.kind === 'lock'){
    g.lockedPower = g.power; g.lockedShift = g.shiftCrit; g.lockRem = 3 + 1;
    ev.push({ kind: 'lock', power: g.power });
  } else if(sk.kind === 'shift'){
    const opts = POWER5.filter(p => p !== g.power);
    g.forced = opts[rng.nextInt(opts.length)];
    ev.push({ kind: 'shift', from: g.power, to: g.forced });
  } else if(sk.kind === 'shitsuke'){
    const i = g.cellAt[move.anchor.r * 8 + move.anchor.c];
    if(i === undefined) throw new Error('しつけがけ: マスがありません');
    g.shitsuke[i] = true;
  } else if(sk.kind === 'muga'){
    if(!g.hsCharged || g.hsUsed) throw new Error('必殺: チャージがありません');
    g.muga = true; g.hsUsed = true; g.hsCharged = false; ev.push({ kind: 'muga' });
  }
  g.focus -= cost;
  ev.push({ kind: 'used', skill: sk.id, cost });
  endTurn(g, cfg, rng, dmg, ev);
  return { ok: true, events: ev };
}
function endTurn(g, cfg, rng, dmg, ev){
  if(g.opts.hsCharge && dmg > 0 && !g.hsCharged && !g.hsUsed && cfg.level >= SKILL.muga.lv){
    if(rng.next() < P.hsBase * dmg * NEEDLES[cfg.needle].crit[cfg.star]){ g.hsCharged = true; ev.push({ kind: 'charge' }); }
  }
  if(g.lockRem > 0){ g.lockRem -= 1; if(g.lockRem === 0){ g.lockedPower = null; g.lockedShift = false; } }
  if(g.lockRem === 0 && g.cycle.length) g.cycleIdx = (g.cycleIdx + 1) % g.cycle.length;
  g.turn += 1; g.started = false; g.shiftCrit = false; g.randomCrit = false; g.glow = -1;
}

// できのよさ。誤差: 差4以内はそのまま、5〜8は9、9以上はそのまま
function cellError(d){ const a = Math.abs(d); return a <= P.yellow ? a : a < P.penalty ? P.penalty : a; }
function judge(g){
  let total = 0, raw = 0;
  for(let i = 0; i < g.n; i++){ const d = g.base[i] - g.cum[i]; raw += Math.abs(d); total += cellError(d); }
  const tb = (g.oldLimit && EVAL_OLD[g.n]) || EVAL[g.n];
  const star = total <= tb.star3 ? 3 : total <= tb.star2 ? 2 : total <= tb.star1 ? 1 : total <= tb.star0 ? 0 : -1;  // -1 は失敗
  return { star, total, raw };
}

const SEW = {
  P, POWER, POWER5, POWER_JA, NEEDLES, FOCUS_BASE, SKILLS, SKILL, PATTERNS, EVAL, EVAL_OLD,
  makeRng, clampAnchor, targetsOf, newGame, cloneGame, beginTurn, act, costOf, critRate, rollValue, judge, cellError,
  isTraitTurn, rainbowMode,
};
root.SEW = SEW;
if(typeof module !== 'undefined' && module.exports) module.exports = SEW;
})(typeof globalThis !== 'undefined' ? globalThis : this);
