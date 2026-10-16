#!/usr/bin/env node
/* さいほうの推奨手(sew-ai.js)で、レシピを何局か打ち切って成績を出す(作業用)。
   使い方: node tools/sew-try.js [レシピ名をカンマ区切り] [局数] [設定のJSON] [針]
     例: node tools/sew-try.js トーテムケープ上,族長のバンダナ 500 '{"r1":20}' light
   条件: 職人Lv80・針★3・コツあり。種は 1000 から局ごとに1ずつ。 */
'use strict';
const path = require('path');
const AI = require(path.join(__dirname, '..', 'sew-ai.js'));
const { SEW_RECIPES } = require(path.join(__dirname, '..', 'sew-recipes.js'));
const names = (process.argv[2] || 'トーテムケープ上,トライバルトップ,族長のバンダナ,ふしぎなブーツ,オスクトルブーツ,ポールスターボトム,月影の額当て,ノクトルケープ上,叡聖の博士服').split(',');
const N = +(process.argv[3] || 200);
const params = process.argv[4] ? JSON.parse(process.argv[4]) : {};
const cfg = { level: 80, needle: process.argv[5] || 'light', star: 3, kotsu: true };
const ci = (k, n) => { const p = k / n, h = 1.96 * Math.sqrt(p * (1 - p) / n); return `${(p * 100).toFixed(1)}%(${(Math.max(0, p - h) * 100).toFixed(1)}〜${(Math.min(1, p + h) * 100).toFixed(1)})`; };
for(const nm of names){
  const rec = SEW_RECIPES.find(r => r.name === nm);
  if(!rec){ console.log('レシピがない:', nm); continue; }
  const ctx = AI.prepare(rec, cfg, params);
  const st = [0, 0, 0, 0, 0]; let tot = 0, foc = 0, turns = 0;
  const t0 = Date.now();
  for(let s = 0; s < N; s++){ const r = AI.playGame(rec, cfg, 1000 + s, ctx); st[r.star + 1]++; tot += r.total; foc += r.focus; turns += r.turns; }
  console.log(`${nm} (${rec.cloth}・${rec.cells.length}マス・基準値の合計${rec.cells.reduce((a, c) => a + c.base, 0)}) ${N}局: ★3 ${ci(st[4], N)} ★2 ${(st[3] / N * 100).toFixed(1)}% ★1以下 ${((st[0] + st[1] + st[2]) / N * 100).toFixed(1)}% / 誤差の平均 ${(tot / N).toFixed(1)}・残り集中力 ${(foc / N).toFixed(0)}・ターン ${(turns / N).toFixed(1)}(${((Date.now() - t0) / N).toFixed(0)}ms/局)`);
}
