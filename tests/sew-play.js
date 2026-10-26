#!/usr/bin/env node
/* =====================================================================
   画面用の進め方(SEW.startTurn・SEW.applyMove)が、乱数で進める beginTurn・act と同じ局面になるかの照合。
   乱数で1局を進めながら、起きたこと(ぬいパワー・再生・光ったマス・回復・縫った後の残り)を画面用の関数で
   別の局面に入れていき、毎ターン、局面が同じかを確かめる。
   再生布で手の直後に戻りが起きるターンは、奇数番目の局では画面と同じ入れ方にする: 戻りを先に起こし、縫ったマスが戻った時は
   縫って戻った後の残りを applyMove に渡し、同じ残りを次のターンの始めの再生として startTurn に渡す(sew-ui.js の pickRegen)。
   偶数番目の局は、前の版の入れ方(縫った後の残りを渡し、戻りは次のターンの始めに入れる)のまま。
   使い方(リポジトリの直下で): node tests/sew-play.js   違えば終了コード1
   ===================================================================== */
'use strict';
const path = require('path');
const SEW = require(path.join(__dirname, '..', 'sew-engine.js'));
const { SEW_RECIPES } = require(path.join(__dirname, '..', 'sew-recipes.js'));

const GAMES = 3000;
const R = SEW.makeRng(20261016);
const rnd = () => R.next(), pick = a => a[Math.floor(rnd() * a.length)];
const needles = Object.keys(SEW.NEEDLES);
const KEYS = ['cum', 'shitsuke', 'focus', 'turn', 'power', 'shiftCrit', 'glow', 'lockRem', 'lockedPower', 'lockedShift',
              'cycleIdx', 'muga', 'hsUsed', 'hsCharged', 'recoverUsed', 'started', 'finished'];
let bad = 0, turns = 0, moves = 0, early = 0, earlySewn = 0;
function same(a, b, where){
  for(const k of KEYS){
    const x = JSON.stringify(a[k]), y = JSON.stringify(b[k]);
    if(x !== y){ if(bad < 10) console.log(`違い(${where}) ${k}: 乱数 ${x} / 画面 ${y}`); bad++; return false; }
  }
  // シフトの後: 乱数の側は行き先が入っている。画面の側は「分からない」印
  if(!!a.forced !== !!b.forced){ if(bad < 10) console.log(`違い(${where}) forced: ${a.forced} / ${b.forced}`); bad++; return false; }
  return true;
}
for(let gi = 0; gi < GAMES && bad < 10; gi++){
  const rec = pick(SEW_RECIPES);
  const cfg = { level: rnd() < 0.5 ? 70 + Math.floor(rnd() * 11) : 1 + Math.floor(rnd() * 80), needle: pick(needles), star: Math.floor(rnd() * 4), kotsu: rnd() < 0.5 };
  const rng = SEW.makeRng(Math.floor(rnd() * 4294967296));
  const g1 = SEW.newGame(rec, cfg, rng, {});
  const g2 = SEW.newGame(rec, cfg, { next: () => 1, nextInt: () => 0 }, {});
  g2.focus = g1.focus; g2.hsCharged = g1.hsCharged;      // 開始時の針の効果は画面で入れる
  const skills = SEW.SKILLS.filter(s => s.lv <= cfg.level);
  let pre = null;          // 手の直後に先に起こした、次のターンの始めの出来事(画面と同じ入れ方の局)
  for(let step = 0; step < 60 && !g1.finished && bad < 10; step++){
    // ターンの始め
    // (使えなかった手をやり直す時は、ターンはもう始まっているので見込みは比べない)
    const exp = g2.started ? null : SEW.expectedPower(g2);
    const ev = pre || SEW.beginTurn(g1, cfg, rng);
    const wasPre = !!pre; pre = null;
    if(exp && (exp.power !== g1.power || exp.shiftCrit !== g1.shiftCrit)){ console.log(`違い: 見込みのぬいパワー ${exp.power} / 実際 ${g1.power}`); bad++; break; }
    const rg = ev.find(e => e.kind === 'regen'), rc = ev.find(e => e.kind === 'recover');
    // (先に起こした局は、g2 に縫って戻った後の残りが入っているので、エンジンの見込みとは比べない。偶数番目の局で比べている)
    if(rg && !wasPre && !SEW.regenCandidates(g2).includes(rg.cell)){ console.log('違い: 再生したマスが候補に無い'); bad++; break; }
    SEW.startTurn(g2, cfg, { power: g1.power, shiftCrit: g1.shiftCrit, glow: g1.glow, recover: !!rc,
                            regen: rg ? { cell: rg.cell, remain: g1.base[rg.cell] - g1.cum[rg.cell] } : null });
    turns++;
    if(!same(g1, g2, `${rec.name} ${g1.turn + 1}ターン目の始め`)) break;
    // 手(sew-rules.js と同じく、半分は残りに合った手、残りはでたらめ)
    let move = null;
    if(rnd() < 0.02) move = { finish: true };
    else if(rnd() < 0.6){
      const pos = g1.base.map((b, i) => [b - g1.cum[i], i]).filter(x => x[0] > 0);
      if(pos.length){
        const [r, i] = pick(pos);
        const single = skills.filter(s => s.target === 'single' && s.kind === 'sew');
        const fit = single.filter(s => s.mul * 15 * SEW.POWER[g1.power] <= r + 6);
        move = { skill: (fit.length ? pick(fit) : pick(single)).id, anchor: { r: g1.pos[i][0], c: g1.pos[i][1] } };
      }
    }
    if(!move){
      const sk = pick(skills);
      if(sk.kind === 'muga' && !(g1.hsCharged && !g1.hsUsed)) continue;
      const anchor = { r: 1 + Math.floor(rnd() * rec.rows), c: 1 + Math.floor(rnd() * rec.cols) };
      if((sk.kind === 'hogushi' || sk.kind === 'shitsuke') && g1.cellAt[anchor.r * 8 + anchor.c] === undefined) continue;
      move = { skill: sk.id, anchor };
    }
    const res = SEW.act(g1, move, cfg, rng);
    if(!res.ok){ continue; }      // 使えなかった手(集中力が足りない等)はターンが進まない。画面でも入れない
    const remains = {};
    for(const e of res.events) if(e.kind === 'sew') remains[e.cell] = g1.base[e.cell] - g1.cum[e.cell];
    // 画面と同じ入れ方の局: 再生布で次のターンの始めに戻りが起きるなら、先に起こす。縫ったマスが戻ったら、縫って戻った後の残りを入れる
    if(gi % 2 === 1 && !g1.finished && g1.cloth === 'regen' && SEW.isTraitTurn(g1.turn + 1)){
      pre = SEW.beginTurn(g1, cfg, rng);
      early++;
      const r1 = pre.find(e => e.kind === 'regen');
      if(r1 && remains[r1.cell] !== undefined){ remains[r1.cell] = g1.base[r1.cell] - g1.cum[r1.cell]; earlySewn++; }
    }
    const r2 = SEW.applyMove(g2, move, cfg, { remains });
    moves++;
    if(!r2.ok){ console.log(`違い: 画面の側で手が使えなかった ${JSON.stringify(move)}`); bad++; break; }
    // 先に起こした局は、g1 がもう次のターンを始めているので、次のターンの始めで比べる
    if(!pre && !same(g1, g2, `${rec.name} ${g1.turn}ターン目の手 ${move.finish ? 'しあげる' : move.skill}`)) break;
  }
}
console.log(`${turns}ターン・${moves}手を照合(うち手の直後に戻りを先に入れた ${early}手・縫ったマスが戻った ${earlySewn}手): ${bad ? '違いあり' : 'すべて一致'}`);
process.exit(bad ? 1 : 0);
