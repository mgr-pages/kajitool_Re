#!/usr/bin/env node
/* さいほうの推奨手(sew-ai.js)で1局を打ち、1手ずつの局面と手を出す(作業用)。
   使い方: node tools/sew-trace.js [レシピ名] [種] [設定のJSON] [針]
   1行 = T(終えたターン数) 強さ(固=精神統一の残り) 集中力 残り[マスごとの 基準値−縫った量] 布の特性 → 手 評価 結果(マス:値、!は会心) */
'use strict';
const path = require('path');
const SEW = require(path.join(__dirname, '..', 'sew-engine.js'));
const AI = require(path.join(__dirname, '..', 'sew-ai.js'));
const { SEW_RECIPES } = require(path.join(__dirname, '..', 'sew-recipes.js'));
const nm = process.argv[2] || 'トーテムケープ上', seed = +(process.argv[3] || 1000);
const params = process.argv[4] ? JSON.parse(process.argv[4]) : {};
const cfg = { level: 80, needle: process.argv[5] || 'light', star: 3, kotsu: true };
const rec = SEW_RECIPES.find(r => r.name === nm);
const ctx = AI.prepare(rec, cfg, params);
const rng = SEW.makeRng(seed);
const g = SEW.newGame(rec, cfg, rng);
let ev = SEW.beginTurn(g, cfg, rng);
console.log(nm, rec.cloth, 'cycle', rec.cycle.join(','), 'base', g.base.join(','), 'focus', g.focus);
const PJ = SEW.POWER_JA;
for(let k = 0; k < 80 && !g.finished; k++){
  const m = AI.choose(g, cfg, ctx);
  const rem = g.base.map((b, i) => b - g.cum[i]);
  const extra = ev.filter(e => e.kind !== 'turnStart').map(e => e.kind + (e.cell !== undefined ? '@' + e.cell : '') + (e.amount ? '+' + e.amount : '') + (e.mode ? ':' + e.mode : '')).join(' ');
  const res = SEW.act(g, m, cfg, rng);
  const sews = res.events.filter(e => e.kind === 'sew').map(e => `${e.cell}:${e.value}${e.crit ? '!' : ''}`).join(' ');
  console.log(`T${g.turn} ${PJ[g.power] || g.power}${g.lockRem ? '(固' + g.lockRem + ')' : ''} 集${g.focus} 残[${rem.join(',')}] ${extra} → ${m.finish ? 'しあげる(' + m.why + ')' : SEW.SKILL[m.skill].name + (m.anchor ? `(${m.anchor.r},${m.anchor.c})` : '')} ${m.net !== undefined ? 'net' + m.net.toFixed(1) : (m.why || '')} ${sews}`);
  if(!g.finished) ev = SEW.beginTurn(g, cfg, rng);
}
const j = SEW.judge(g); console.log('結果 ★', j.star, '誤差', j.total, '残り', g.base.map((b, i) => b - g.cum[i]).join(','));
