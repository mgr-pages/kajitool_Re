#!/usr/bin/env node
/* =====================================================================
   裁縫の画面を、ボタンを押す操作だけで1局最後まで打つ(画面の確かめ用。作業用)。
   ゲームの代わりに、乱数で進めるエンジン(SEW.beginTurn・SEW.act)で起きたことを決め、それを画面のボタンで入れていく。
   毎手、画面の局面(縫った量・集中力・ターン)とエンジンの局面が同じかを確かめ、違えばそこで止める。
   確かめること(違えば「問題: …」と出す):
   ・再生布: 手の直後に戻りが起きるターンは、「使った」の後にまず戻ったマスを選び、それから値を入れる(利用者 2026-10-26)。
     戻るマスを、わざとエンジンの見込み(SEW.regenCandidates)の外のマスに移しても、押して選べる(2026-10-20 の報告の場面)。
     押せるマスは「縫った量が1以上のマス」と「その手で縫うマス」(みだれぬいは全マス)と同じ。選ぶ間は、使った手の印(「ここ」・「入力」の札・
     「マス◯ を選ぶ」)を出さない。値はゲームに見える戻った後の値を入れる。
     縫ったマスが戻った時はテンキーで入れ、ほかの値は候補のボタンにある(無ければ問題)。次のターンの始めに戻りを聞き直さない。
   ・光布: 光らないマスは押せない。
   ・みだれぬい: 当たったマスを全部入れるまで主ボタンが押せず「n / 4」の数が合う。全部入れたら、ほかのマスは押せず入力も開かない
     (当たっていないのに戻ったマスは、戻った後の値を入れ、押して直せる)。入れたマスは押して直せる。
   ・1手目は主ボタンが「推奨手を計算」。
   ・推奨手の「ここ」の印と「マス◯ を選ぶ」は、縫うマスの1つで、そこを選べば特技の形がずれずに同じマスに当たる
     (たすきぬいなら左下・逆たすきぬいなら右下。2026-10-23 の報告: たすきぬいで縫わないマスを示していた)。
   使い方: 画面を http://localhost:8123/ で出しておく(例: npx http-server -p 8123 -c-1 -s .。環境変数 SEW_URL で変えられる)。
     node tools/sew-click.js レシピ名 種 [画像の出力先] [画像の名前の頭]
   環境変数 SEW_NOREGEN(0〜1)を渡すと、再生布の戻りのターンをその割合で「戻らなかった」ことにして打つ(エンジンの戻りを取り消して、
   「戻らなかった」を押す。既定 0)。
   画像の出力先を渡すと、戻ったマスを選ぶ所・縫ったマスが戻った値の入力・みだれぬいの入力の途中と後・最初のたすきぬいか逆たすきぬいの推奨・
   結果の画面を撮る。画像は日本語のフォントで撮る(中国語のフォントは使わない。引き継ぎ資料の 6 の「画面の画像」)。
   最後の行: レシピ・種・回数(power ぬいパワーを選んだ・regen 戻ったマスを選んだ・regenOutside そのうち見込みの外・regenSewn そのうち縫ったマスが戻った・
   noRegen 戻らなかった・regenNoSew 値を入れない手(精神統一など)の直後に戻りを聞いた・cand 候補のボタンで入れた・keys テンキーで入れた・midare みだれぬい・midareRegen その直後に戻った・midareRegenOut そのうち
   当たっていないマスが戻った・moves 使った手・diag 推奨手のたすきぬい・逆たすきぬい)・
   終わりの局面・ページのエラー。
   記録の送信(script.google.com)は止めて打つので、終わりに「Failed to load resource」が出ることがある(アプリのエラーではない)。
   ===================================================================== */
const { chromium } = require('playwright');
const URL = process.env.SEW_URL || 'http://localhost:8123/sew.html';
const NOREGEN = Number(process.env.SEW_NOREGEN) || 0;
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
  // 画面の数字は進み(縫った量)。r は残りで渡し、マス i の基準値から進みに直して入れる。
  // keysOk: 候補のボタンが出ず、テンキーで入れるはずのマス(縫ったマスが戻った時)。それ以外は、値が候補のボタンに無ければ問題
  async function enterValue(r, i, keysOk) {
    await p.waitForSelector('#numModal.show');
    const v = await p.evaluate(([i, r]) => S.g.base[i] - r, [i, r]);
    const c = p.locator('#numCand button.cand', { hasText: exact(v) });
    if (keysOk && await p.locator('#numCand button.cand').count() && await p.locator('#numCand').isVisible()) problem('縫ったマスが戻った値に候補が出た', `マス${i + 1}`);
    if (await c.count() && await c.first().isVisible()) { await c.first().click(); cnt.cand++; return; }
    if (!keysOk) problem('値が候補に無い', `マス${i + 1}`, v);
    const more = p.locator('#numCand .cand-more');
    if (await more.count() && await more.isVisible()) await more.click();
    for (const d of String(Math.abs(v))) await p.locator('#numKeys .keys button', { hasText: exact(d) }).click();
    if (v < 0) await p.click('#nSign');
    await p.click('#numKeys button.ok');
    cnt.keys++;
  }
  const cell = i => p.locator(`button.scell[onclick="tapCell(${i})"]`);
  const simRem = i => p.evaluate(i => __sim.base[i] - __sim.cum[i], i);
  let shots = 0;
  // 再生布で手の直後に戻りが起きるターンは、エンジンの次のターンの始めを手の直後に起こす(画面ではそこで戻ったマスを選ぶ)。その時の出来事
  let early = null;
  for (let k = 0; k < 300; k++) {
    const st = await p.evaluate(() => S.phase);
    if (st === 'turn') {
      const ev = early || await p.evaluate(() => { const ev = SEW.beginTurn(__sim, cfgOf(), __rng); return { ev, power: __sim.power, glow: __sim.glow, shiftCrit: __sim.shiftCrit }; });
      early = null;
      let t = await p.evaluate(() => S.turnIn);
      if (!t.power) {
        await p.waitForSelector('#powModal.show');
        await p.locator('#powRow button', { hasText: exact(await p.evaluate(pw => SEW.POWER_JA[pw], ev.power)) }).click();
        cnt.power++;
        t = await p.evaluate(() => S.turnIn);
      }
      // 戻りは手の直後に入れてあるので、ターンの始めには聞かない
      if (t.needRegen && !t.regen) { problem('ターンの始めに戻りを聞いた', `${await p.evaluate(() => S.g.turn + 1)}ターン目`); break; }
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
    // エンジンもここでターンを始め(手の直後に始めてあればその出来事を使い)、集中力が回復したら画面のボタンで入れる
    if (st !== 'turn') {
      let ev = null;
      if (early) { ev = early.ev; early = null; }
      else if (!(await p.evaluate(() => __sim.started))) ev = await p.evaluate(() => SEW.beginTurn(__sim, cfgOf(), __rng));
      if (ev && ev.some(e => e.kind === 'recover')) {
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
    // 再生布で手の直後に戻りが起きるターン: エンジンの次のターンの始めを、ここで起こす。
    // 報告の場面をまねる: 戻るマスを、エンジンの見込み(regenCandidates)の外の「縫った量が1以上のマス」に移す
    let rg = null;
    if (await p.evaluate(() => __sim.cloth === 'regen' && !__sim.finished && SEW.isTraitTurn(__sim.turn + 1))) {
      early = await p.evaluate(() => { const ev = SEW.beginTurn(__sim, cfgOf(), __rng); return { ev, power: __sim.power, glow: __sim.glow, shiftCrit: __sim.shiftCrit }; });
      const e0 = early.ev.find(e => e.kind === 'regen');
      // 戻らなかったことにする(SEW_NOREGEN): エンジンの戻りを取り消す
      const skip = NOREGEN > 0 && e0 && await p.evaluate(([e0, q]) => { if (__rng.next() >= q) return false; __sim.cum[e0.cell] += e0.amount; return true; }, [e0, NOREGEN]);
      if (e0 && !skip) rg = await p.evaluate(rg => {
        __sim.cum[rg.cell] += rg.amount;   // エンジンの戻りを取り消す
        const c = SEW.regenCandidates(__sim), has = __sim.base.map((b, i) => i).filter(i => __sim.cum[i] > 0);
        const out = has.filter(i => !c.includes(i)), pool = out.length ? out : has;
        if (!pool.length) return null;
        const j = pool[__rng.nextInt(pool.length)], d = Math.min(SEW.P.regen[__rng.nextInt(SEW.P.regen.length)], __sim.cum[j]);
        __sim.cum[j] -= d;
        return { cell: j, amount: d, outside: out.length > 0 };
      }, e0);
    }
    const hits = new Set(res.vals.map(x => x[0]));
    // 押せるマス(戻ったマスを選ぶ時): 縫った量が1以上のマスと、その手で縫うマス(みだれぬいは全マス)。使う前の画面の局面で決める
    const want = await p.evaluate(m => { const sk = SEW.SKILL[m.skill], g = S.g;
      const tg = sk.kind === 'sew' && sk.target ? SEW.targetsOf(g, sk, m.anchor).map(x => x[0]) : [];
      return g.base.map((b, i) => g.cum[i] > 0 || sk.kind === 'midare' || tg.includes(i)); }, rec);
    await p.click('#calcBtn');   // 使った
    cnt.moves++;
    const waiting = await p.evaluate(() => !!(S.regenIn && S.regenIn.wait));
    if (rg && !waiting) { problem('手の直後に戻りを聞かなかった', `マス${rg.cell + 1}`); break; }
    if (waiting) {
      if (!early) { problem('戻りが起きないターンに戻りを聞いた'); break; }
      const lbl = await p.locator('#calcBtn').innerText();
      if (!lbl.includes('再生したマスをタップ') || !(await p.locator('#calcBtn').isDisabled())) problem('戻ったマスを選ぶ時の主ボタンが違う', JSON.stringify(lbl));
      if (await p.evaluate(() => document.getElementById('numModal').classList.contains('show'))) problem('戻ったマスを選ぶ前に値の入力が開いた');
      // 押すのは戻ったマスなので、使った手の印(「ここ」・「入力」の札・「マス◯ を選ぶ」)は出ていない
      const marks = await p.evaluate(() => ({ anchor: document.querySelectorAll('#sboard .scell.anchor').length, pend: document.querySelectorAll('#sboard .scell.pend').length,
        tgt: (document.querySelector('#rec .rec-skill .tgt') || {}).textContent || '' }));
      if (marks.anchor || marks.pend || marks.tgt) problem('戻ったマスを選ぶ間に、使った手の印が出ている', JSON.stringify(marks));
      for (let i = 0; i < want.length; i++) if ((await cell(i).isDisabled()) === want[i]) problem('戻りの押せる/押せないが違う', i, want[i]);
      if (rg && shots < 3) { await shot(p, 'regenpick'); shots++; }
      if (!hits.size) cnt.regenNoSew = (cnt.regenNoSew || 0) + 1;
      if (rg) {
        await cell(rg.cell).click();
        cnt.regen++; if (rg.outside) cnt.regenOutside = (cnt.regenOutside || 0) + 1;
        if (hits.has(rg.cell)) cnt.regenSewn = (cnt.regenSewn || 0) + 1;
      } else { await p.locator('#inputPanel button', { hasText: '戻らなかった' }).click(); cnt.noRegen++; }
    }
    const X = rg ? rg.cell : -1;
    const midare = await p.evaluate(() => S.midare);
    if (midare) {
      const seen = new Set(), need = await p.evaluate(() => midareNeed());
      const order = res.vals.filter(([i]) => !seen.has(i) && seen.add(i)).map(([i]) => i);
      if (order.length !== need) problem('みだれぬいの当たったマスの数が違う', order.length, need);
      for (let h = 0; h < order.length; h++) {
        const i = order[h];
        const dis = await p.locator('#calcBtn').isDisabled(), lbl = await p.locator('#calcBtn').innerText();
        if (!dis || !lbl.includes(`${h} / ${need}`)) problem('入れ終わる前に主ボタンが押せる/数が違う', h, dis, JSON.stringify(lbl));
        if (h === 2 && cnt.midare === 0) await shot(p, 'midare-mid');
        await cell(i).click(); await enterValue(await simRem(i), i, i === X);
      }
      if (X >= 0) cnt.midareRegen = (cnt.midareRegen || 0) + 1;
      // 当たっていないマスが戻った: 4マス入れたら、そのマスの戻った後の値を聞く
      if (X >= 0 && !hits.has(X)) {
        cnt.midareRegenOut = (cnt.midareRegenOut || 0) + 1;
        if (cnt.midareRegenOut === 1) await shot(p, 'midare-regen');
        if (!(await p.evaluate(() => document.getElementById('numModal').classList.contains('show')))) problem('当たっていないマスが戻ったのに値を聞かない', `マス${X + 1}`);
        else await enterValue(await simRem(X), X, false);
      }
      // 全部入れたら: 主ボタンは「入力おわり」、ほかのマスは押せない(押しても何も開かない)。当たっていないのに戻ったマスは押せる
      const lbl = await p.locator('#calcBtn').innerText();
      if (await p.locator('#calcBtn').isDisabled() || !lbl.includes('入力おわり')) problem('全部入れたのに入力おわりが押せない', JSON.stringify(lbl));
      const other = await p.evaluate(s => S.g.base.map((b, i) => i).filter(i => !s.includes(i)), order);
      for (const i of other) {
        if (i === X) {
          if (await cell(i).isDisabled()) problem('当たっていないのに戻ったマスが押せない', i);
          continue;
        }
        if (!(await cell(i).isDisabled())) problem('5マス目が押せる見た目', i);
        await cell(i).click({ force: true });
        if (await p.evaluate(() => document.getElementById('numModal').classList.contains('show'))) { problem('5マス目の入力が開いた', i); await p.evaluate(() => closeNum()); }
      }
      if (other.length && cnt.midare === 0) await shot(p, 'midare-full');
      // 入れたマスは押して直せる(同じ値を入れ直す)
      if (order.length) { await cell(order[0]).click(); await enterValue(await simRem(order[0]), order[0], order[0] === X); }
      await p.click('#calcBtn');  // 入力おわり
      cnt.midare++;
    } else {
      for (let j = 0; j < 20; j++) {
        const pi = await p.evaluate(() => S.phase === 'input' && S.pend.length ? S.pend[0].i : -1);
        if (pi < 0) break;
        if (j === 0 && X >= 0 && pi !== X) problem('戻ったマスの値から聞かない', `マス${pi + 1}`, `マス${X + 1}`);
        if (pi === X && hits.has(X) && !cnt.regenSewnShot) { await shot(p, 'regen-sewn'); cnt.regenSewnShot = 1; }
        await enterValue(await simRem(pi), pi, pi === X && hits.has(X));
      }
    }
    await p.waitForTimeout(30);
    // 盤に出ている進みが、エンジン(ゲームの代わり)と同じか。ターンを始めていれば局面も比べる。
    // 手の直後に次のターンの始めを起こした時は、エンジンの集中力に回復が入っている(画面は、回復のボタンを押すまで入らない)
    const recAmt = early && early.ev.some(e => e.kind === 'recover') ? await p.evaluate(() => SEW.P.recover.amount) : 0;
    const diff = await p.evaluate(recAmt => {
      const shown = [...document.querySelectorAll('#sboard button.scell')].map(b => +b.querySelector('.rem').textContent);
      const want = __sim.cum.slice();
      if (JSON.stringify(shown) !== JSON.stringify(want)) return JSON.stringify({ 盤: shown, エンジン: want });
      const ui = S.g.started ? [S.g.cum, S.g.focus, S.g.turn] : [null, S.g.focus, S.g.turn];
      const sim = S.g.started ? [__sim.cum, __sim.focus - recAmt, __sim.turn] : [null, __sim.focus - recAmt, __sim.turn];
      return JSON.stringify(ui) === JSON.stringify(sim) ? '' : JSON.stringify({ ui, sim });
    }, recAmt);
    if (diff) { problem('局面が違う', diff); break; }
  }
  delete cnt.regenSewnShot;
  const fin = await p.evaluate(() => ({ turn: S.g ? S.g.turn : null, sim: SEW.judge(__sim) }));
  console.log(recipeName, '種', seed, JSON.stringify(cnt), '終わり', JSON.stringify({ turn: fin.turn, star: fin.sim.star, total: fin.sim.total }), 'エラー:', errs.join(' | ') || 'なし', bad ? `問題 ${bad}件` : '問題なし');
  await b.close();
  process.exit(bad ? 1 : 0);
})();
