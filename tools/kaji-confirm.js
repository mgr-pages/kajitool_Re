#!/usr/bin/env node
/* =====================================================================
   鍛冶: tools/kaji-select.js で選んだ案を、別の種で確かめる(先読みなし・乱数テープ)。
   使い方: node tools/kaji-confirm.js 選んだ案.json [局数] [種] '<条件の JSON>'
     選んだ案.json: kaji-select.js の out(pick: 商材 → { name, p })。条件: { hammer, start(商材 → 今の重みの上書き), zOk, out }
   商材ごとに、今の重み(start)と案(p)を同じ局どうしで打ち、z ≥ zOk(既定 1.5)の案を「確かめた」とする。
   ===================================================================== */
'use strict';
const fs = require('fs');
(async () => {
  const { runKaji } = require('./kaji-batch.js');
  const [pickF, nA, seedA, condA] = process.argv.slice(2);
  const P = JSON.parse(fs.readFileSync(pickF, 'utf8')).pick, N = +(nA || 600), seed = +(seedA || 202), C = JSON.parse(condA || '{}');
  const start = C.start || {}, zOk = C.zOk === undefined ? 1.5 : C.zOk;
  const items = Object.keys(P);
  const rows = await runKaji({ items, N, seed, hammer: C.hammer, label: 'kaji-confirm', variantsOf: it => [start[it] || {}, P[it].p] });
  const ok = {};
  let TA = 0, TB = 0, DA = 0, DB = 0;
  for(const it of items){
    let a = 0, b = 0, sa = 0, sb = 0;
    for(const g of rows[it]){ sa += g[0].great; sb += g[1].great; if(g[0].great && !g[1].great) a++; if(g[1].great && !g[0].great) b++; }
    const z = a + b ? (b - a) / Math.sqrt(a + b) : 0;
    TA += sa; TB += sb; DA += a; DB += b;
    console.log(`${it}: ${P[it].name} 今 ${(sa / N * 100).toFixed(1)}% → 案 ${(sb / N * 100).toFixed(1)}%(今だけ ${a}・案だけ ${b}、z=${z.toFixed(2)})${z >= zOk ? ' ○' : ''}`);
    if(z >= zOk) ok[it] = { name: P[it].name, p: P[it].p, z, rate: sb / N };
  }
  const T = N * items.length;
  console.log(`合計: 今 ${(TA / T * 100).toFixed(1)}% → 案 ${(TB / T * 100).toFixed(1)}%(z=${((DB - DA) / Math.sqrt(DA + DB)).toFixed(2)})・確かめた ${Object.keys(ok).length}/${items.length}`);
  if(C.out) fs.writeFileSync(C.out, JSON.stringify(ok, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
