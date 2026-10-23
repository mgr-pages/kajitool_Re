#!/usr/bin/env node
/* =====================================================================
   裁縫の画面を、ボタンを押す操作だけで1局最後まで打つ(画面の確かめ用。作業用)。
   ゲームの代わりに、乱数で進めるエンジン(SEW.beginTurn・SEW.act)で起きたことを決め、それを画面のボタンで入れていく。
   毎手、画面の局面(縫った量・集中力・ターン)とエンジンの局面が同じかを確かめ、違えばそこで止める。
   確かめること(違えば「問題: …」と出す):
   ・再生布: 戻るマスを、わざとエンジンの見込み(SEW.regenCandidates)の外のマスに移しても、押して選べる
     (2026-10-20 の報告の場面)。押せるマスは「縫った量が1以上のマス」と同じ。
   ・光布: 光らないマスは押せない。
   ・みだれぬい: 当たったマスを全部入れるまで主ボタンが押せず「n / 4」の数が合う。全部入れたら、ほかのマスは押せず入力も開かない。
     入れたマスは押して直せる。
   ・1手目は主ボタンが「推奨手を計算」。
   ・推奨手の「ここ」の印と「マス◯ を選ぶ」は、縫うマスの1つで、そこを選べば特技の形がずれずに同じマスに当たる
     (たすきぬいなら左下・逆たすきぬいなら右下。2026-10-23 の報告: たすきぬいで縫わないマスを示していた)。
   使い方: 画面を http://localhost:8123/ で出しておく(例: npx http-server -p 8123 -c-1 -s .。環境変数 SEW_URL で変えられる)。
     node tools/sew-click.js レシピ名 種 [画像の出力先] [画像の名前の頭]
   画像の出力先を渡すと、戻ったマスを選ぶ所・みだれぬいの入力の途中と後・最初のたすきぬいか逆たすきぬいの推奨・結果の画面を撮る。
   画像は日本語のフォントで撮る(中国語のフォントは使わない。引き継ぎ資料の 6 の「画面の画像」)。
   最後の行: レシピ・種・回数(power ぬいパワーを選んだ・regen 戻ったマスを選んだ・regenOutside そのうち見込みの外・cand 候補のボタンで入れた・
   keys テンキーで入れた・midare みだれぬい・moves 使った手・diag 推奨手のたすきぬい・逆たすきぬい)・終わりの局面・ページのエラー。
   記録の送信(script.google.com)は止めて打つので、終わりに「Failed to load resource」が出ることがある(アプリのエラーではない)。
   ===================================================================== */
const { chromium } = require('playwright');
const URL = process.env.SEW_URL || 'http://localhost:8123/sew.html';
(async () => {
  const [recipeName, seed, dir, tag0] = process.argv.slice(2);
  if (!recipeName || !seed) { console.error('使い方: node tools/sew-click.js レシピ名 種 [画像の出力先] [画像の名前の頭]'); process.exit(2); }
  const tag = tag0 || 'sew';
  const shot = async (p, name) => { if (dir) await p.screenshot({ path: `${dir}/${tag}-${name}.png` }); };
  let bad = 0;
  const problem = (...a) => { bad++; console.log('問題:', ...a); };
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route(/script\.google\.com/, r => r.abort());
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL);
  await p.evaluate(() => localStorage.clear());
  await p.goto(URL);
  await p.waitForTimeout(300);
  await p.click('#s-recipe');
  await p.fill('#pkSearch', recipeName);
  await p.waitForTimeout(150);
  await p.click('.pk-item');
  await p.waitForTimeout(200);
  await p.evaluate(s => { window.__rng = SEW.makeRng(s); window.__sim = SEW.cloneGame(S.g); window.__sim.recipe = S.g.recipe; }, +seed);
  const cnt = { power: 0, regen: 0, noRegen: 0, glow: 0, noGlow: 0, glowDis: 0, cand: 0, keys: 0, midare: 0, moves: 0 };
  const exact = t => new RegExp('^' + String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
  // 画面の数字は進み(縫った量)。v は残りで渡し、マス i の基準値から進みに直して入れる
  async function enterValue(r, i){
    await p.waitForSelector('#numModal.show');
    const v = await p.evaluate(([i, r]) => S.g.base[i] - r, [i, r]);
    const c = p.locator('#numCand button.cand', { hasText: exact(v) });
    if (await c.count() && await c.first().isVisible()) { await c.first().click(); cnt.cand++; return; }
    const more = p.locator('#numCand .cand-more');
    if (await more.count() && await more.isVisible()) await more.click();
    for (const d of String(Math.abs(v))) await p.locator('#numKeys .keys button', { hasText: exact(d) }).click();
    if (v < 0) await p.click('#nSign');
    await p.click('#numKeys button.ok');
    cnt.keys++;
  }
  const cell = i => p.locator(`button.scell[onclick="tapCell(${i})"]`);
  let shots = 0;
  for (let k = 0; k < 300; k++) {
    const st = await p.evaluate(() => S.phase);
    if (st === 'turn') {
      const ev = await p.evaluate(() => { const ev = SEW.beginTurn(__sim, cfgOf(), __rng); return { ev, power: __sim.power, glow: __sim.glow, shiftCrit: __sim.shiftCrit }; });
      let t = await p.evaluate(() => S.turnIn);
      if (!t.power) {
        await p.waitForSelector('#powModal.show');
        await p.locator('#powRow button', { hasText: exact(await p.evaluate(pw => SEW.POWER_JA[pw], ev.power)) }).click();
        cnt.power++;
        t = await p.evaluate(() => S.turnIn);
      }
      if (t.needRegen && !t.regen) {
        // 報告の場面をまねる: 戻るマスを、エンジンの見込み(regenCandidates)の外の「縫った量が1以上のマス」に移す
        let rg = ev.ev.find(e => e.kind === 'regen');
        if (rg) rg = await p.evaluate(rg => {
          __sim.cum[rg.cell] += rg.amount;   // エンジンの戻りを取り消す
          const c = SEW.regenCandidates(__sim), out = __sim.base.map((b, i) => i).filter(i => __sim.cum[i] > 0 && !c.includes(i));
          const pool = out.length ? out : __sim.base.map((b, i) => i).filter(i => __sim.cum[i] > 0);
          const j = pool[__rng.nextInt(pool.length)], d = Math.min(SEW.P.regen[__rng.nextInt(SEW.P.regen.length)], __sim.cum[j]);
          __sim.cum[j] -= d;
          return { cell: j, amount: d, outside: out.length > 0 };
        }, rg);
        // 押せるマス = 縫った量が1以上のマス
        const want = await p.evaluate(() => S.g.base.map((b, i) => S.g.cum[i] > 0));
        for (let i = 0; i < want.length; i++) if ((await cell(i).isDisabled()) === want[i]) problem('戻りの押せる/押せないが違う', i, want[i]);
        if (rg && shots < 2) { await shot(p, 'regenpick'); shots++; }
        if (rg) {
          await cell(rg.cell).click();
          await enterValue(await p.evaluate(i => __sim.base[i] - __sim.cum[i], rg.cell), rg.cell);
          cnt.regen++; if (rg.outside) cnt.regenOutside = (cnt.regenOutside || 0) + 1;
        } else { await p.locator('#inputPanel button', { hasText: '戻らなかった' }).click(); cnt.noRegen++; }
      }
      t = await p.evaluate(() => S.turnIn);
      if (t && t.needGlow && t.glow === null) {
        // 光らないマス(残りが小さいマス)を先に押して、理由が出るかを見る
        const small = await p.evaluate(() => S.g.base.findIndex((b, i) => b - S.g.cum[i] < SEW.P.yellow + 1));
        if (small >= 0) {
          const dis = await cell(small).isDisabled();
          await cell(small).click({ force: true });
          const still = await p.evaluate(() => S.phase === 'turn' && S.turnIn.glow === null);
          if (!dis || !still) problem('光らないマスが選べてしまう', small, dis, still);
          else { cnt.glowDis++; if (shots++ < 1) await shot(p, 'glowpick'); }
        }
        if (ev.glow >= 0) { await cell(ev.glow).click(); cnt.glow++; }
        else { await p.locator('#inputPanel button', { hasText: '光らなかった' }).click(); cnt.noGlow++; }
      }
      // 1手目は「推奨手を計算」を押してから計算する(鍛冶と同じ)
      if (await p.evaluate(() => S.phase === 'turn' && S.g.turn === 0)) {
        if (!shots) { await shot(p, 'first'); shots++; }
        const lbl = await p.locator('#calcBtn').innerText();
        if (!lbl.includes('推奨手を計算')) problem('1手目の主ボタンが「推奨手を計算」でない', lbl);
        await p.click('#calcBtn'); cnt.firstCalc = 1;
      }
      await p.waitForFunction(() => S.phase === 'move' && S.rec, null, { timeout: 90000 });
      if (ev.ev.some(e => e.kind === 'recover')) {
        await p.locator('#inputPanel button', { hasText: '集中力が回復した' }).click();
        cnt.recover = (cnt.recover || 0) + 1;
        await p.waitForFunction(() => S.phase === 'move' && S.rec, null, { timeout: 90000 });
      }
      const msg = await p.evaluate(() => S.msg);
      if (msg) problem('メッセージが残っている', msg);
    }
    await p.waitForFunction(() => S.phase === 'move' && S.rec, null, { timeout: 90000 }).catch(() => {});
    // ぬいパワーが決まっているターンは、画面が自分でターンを始める(上の 'turn' を通らない)。
    // エンジンもここでターンを始め、集中力が回復したら画面のボタンで入れる
    if (st !== 'turn' && !(await p.evaluate(() => __sim.started))) {
      const ev = await p.evaluate(() => SEW.beginTurn(__sim, cfgOf(), __rng));
      if (ev.some(e => e.kind === 'recover')) {
        await p.locator('#inputPanel button', { hasText: '集中力が回復した' }).click();
        cnt.recover = (cnt.recover || 0) + 1;
        await p.waitForFunction(() => S.phase === 'move' && S.rec, null, { timeout: 90000 });
      }
    }
    const rec = await p.evaluate(() => S.rec);
    if (!rec) { problem('推奨手が無い', await p.evaluate(() => S.phase)); break; }
    if (rec.finish) {
      await p.click('#calcBtn');
      await p.waitForSelector('#outcomeModal.show');
      await shot(p, 'outcome');
      await p.locator('#outcomeRow button.cur').click();
      break;
    }
    // 推奨手の「ここ」の印と「マス◯ を選ぶ」: 縫うマスの1つで、そこを選べば形がずれずに同じマスに当たること(2026-10-23 の報告:
    // たすきぬいで縫わないマスを示していた)
    const pt = await p.evaluate(m => {
      const sk = SEW.SKILL[m.skill];
      if (!sk.target || !m.anchor) return null;
      const g = S.g, key = t => t.map(x => x[0]).sort().join(',');
      const on = [...document.querySelectorAll('#sboard button.scell.anchor')].map(b => +b.getAttribute('onclick').match(/\d+/)[0]);
      const txt = (document.querySelector('#rec .rec-skill .tgt') || {}).textContent || '';
      const i = on[0], pos = i === undefined ? null : g.recipe.cells[i];
      const ca = pos && SEW.clampAnchor(sk.target, SEW.PATTERNS[sk.target], { r: pos.r, c: pos.c }, g.rows, g.cols);
      return { name: sk.name, diag: sk.target.startsWith('diag'), on, txt, cell: i,
               sewn: i !== undefined && SEW.targetsOf(g, sk, m.anchor).some(x => x[0] === i),
               same: !!pos && key(SEW.targetsOf(g, sk, { r: pos.r, c: pos.c })) === key(SEW.targetsOf(g, sk, m.anchor)),
               noShift: !!ca && ca.r === pos.r && ca.c === pos.c };
    }, rec);
    if (pt) {
      if (pt.on.length !== 1 || !pt.sewn || !pt.same || !pt.noShift || pt.txt !== `マス${pt.cell + 1} を選ぶ`)
        problem('推奨手の選ぶマスが違う', JSON.stringify(pt));
      if (pt.diag) { if (!cnt.diag) await shot(p, 'diag'); cnt.diag = (cnt.diag || 0) + 1; }
    }
    const res = await p.evaluate(m => { const r = SEW.act(__sim, { skill: m.skill, anchor: m.anchor }, cfgOf(), __rng);
      return { ok: r.ok, vals: r.events.filter(e => e.kind === 'sew' || e.kind === 'hogushi').map(e => [e.cell, __sim.base[e.cell] - __sim.cum[e.cell]]) }; }, rec);
    await p.click('#calcBtn');   // 使った
    cnt.moves++;
    const midare = await p.evaluate(() => S.midare);
    if (midare) {
      const seen = new Set(), need = await p.evaluate(() => midareNeed());
      const order = res.vals.filter(([i]) => !seen.has(i) && seen.add(i));
      if (order.length !== need) problem('みだれぬいの当たったマスの数が違う', order.length, need);
      for (let h = 0; h < order.length; h++) {
        const [i, v] = order[h];
        const dis = await p.locator('#calcBtn').isDisabled(), lbl = await p.locator('#calcBtn').innerText();
        if (!dis || !lbl.includes(`${h} / ${need}`)) problem('入れ終わる前に主ボタンが押せる/数が違う', h, dis, JSON.stringify(lbl));
        if (h === 2 && cnt.midare === 0) await shot(p, 'midare-mid');
        await cell(i).click(); await enterValue(v, i);
      }
      // 全部入れたら: 主ボタンは「入力おわり」、ほかのマスは押せない(押しても何も開かない)
      const lbl = await p.locator('#calcBtn').innerText();
      if (await p.locator('#calcBtn').isDisabled() || !lbl.includes('入力おわり')) problem('全部入れたのに入力おわりが押せない', JSON.stringify(lbl));
      const other = await p.evaluate(s => S.g.base.map((b, i) => i).filter(i => !s.includes(i)), order.map(x => x[0]));
      for (const i of other) {
        if (!(await cell(i).isDisabled())) problem('5マス目が押せる見た目', i);
        await cell(i).click({ force: true });
        if (await p.evaluate(() => document.getElementById('numModal').classList.contains('show'))) { problem('5マス目の入力が開いた', i); await p.evaluate(() => closeNum()); }
      }
      if (other.length && cnt.midare === 0) await shot(p, 'midare-full');
      // 入れたマスは押して直せる(同じ値を入れ直す)
      if (order.length) { await cell(order[0][0]).click(); await enterValue(order[0][1], order[0][0]); }
      await p.click('#calcBtn');  // 入力おわり
      cnt.midare++;
    } else {
      const last = new Map(res.vals);
      for (let j = 0; j < 20; j++) {
        const pi = await p.evaluate(() => S.phase === 'input' && S.pend.length ? S.pend[0].i : -1);
        if (pi < 0) break;
        await enterValue(last.get(pi), pi);
      }
    }
    await p.waitForTimeout(30);
    const diff = await p.evaluate(() => JSON.stringify([S.g.cum, S.g.focus, S.g.turn]) === JSON.stringify([__sim.cum, __sim.focus, __sim.turn]) ? '' : JSON.stringify({ ui: [S.g.cum, S.g.focus, S.g.turn], sim: [__sim.cum, __sim.focus, __sim.turn] }));
    if (diff) { problem('局面が違う', diff); break; }
  }
  const fin = await p.evaluate(() => ({ turn: S.g ? S.g.turn : null, sim: SEW.judge(__sim) }));
  console.log(recipeName, '種', seed, JSON.stringify(cnt), '終わり', JSON.stringify({ turn: fin.turn, star: fin.sim.star, total: fin.sim.total }), 'エラー:', errs.join(' | ') || 'なし', bad ? `問題 ${bad}件` : '問題なし');
  await b.close();
  process.exit(bad ? 1 : 0);
})();
