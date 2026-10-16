#!/usr/bin/env node
/* =====================================================================
   さいほうのルール(sew-engine.js)の回帰テスト
   全レシピから、種を固定してでたらめに近い手(半分は残りに合った手)を打ち続け、
   起きたこと(値・会心・布の特性・判定)を全部つないだ指紋を作って、記録した値と比べる。
   ルールを1か所でも変えると指紋が変わる。

   指紋は2つ:
     ref: 照合用の扱い(虹布の会心ターン +24%・必殺チャージあり)。
          2026-10-14 に、この扱いで同じ種・同じ手の2万局(約68万手)を照合し、
          全手で一致した(判定20万件・会心率2万件・表の値も一致)。その時のエンジンでの値。
     app: アプリの扱い(虹布の会心ターン7倍・ねらいぬいと足し算、必殺チャージなし)。

   使い方(リポジトリの直下で):
     node tests/sew-rules.js            記録した指紋と比べる。違えば終了コード1
     node tests/sew-rules.js --print    今の指紋を出す(ルールを意図して変えた時に、下の EXPECT を書き換える)
   ===================================================================== */
'use strict';
const path = require('path');
const SEW = require(path.join(__dirname, '..', 'sew-engine.js'));
const { SEW_RECIPES } = require(path.join(__dirname, '..', 'sew-recipes.js'));

const EXPECT = { ref: 'e8b39cb0', app: 'f159d6b3' };
const GAMES = 3000;

function fnv(s, h){
  h = (h === undefined ? 2166136261 : h) >>> 0;
  for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function run(opts){
  const R = SEW.makeRng(20261014);
  const rnd = () => R.next(), pick = a => a[Math.floor(rnd() * a.length)];
  const needles = Object.keys(SEW.NEEDLES);
  let h = undefined, stars = [0, 0, 0, 0, 0];
  for(let gi = 0; gi < GAMES; gi++){
    const rec = pick(SEW_RECIPES);
    const cfg = { level: rnd() < 0.5 ? 70 + Math.floor(rnd() * 11) : 1 + Math.floor(rnd() * 80), needle: pick(needles), star: Math.floor(rnd() * 4), kotsu: rnd() < 0.5 };
    const rng = SEW.makeRng(Math.floor(rnd() * 4294967296));
    const g = SEW.newGame(rec, cfg, rng, opts);
    const skills = SEW.SKILLS.filter(s => s.lv <= cfg.level);
    const log = [JSON.stringify(g.openingEvents)];
    log.push(JSON.stringify(SEW.beginTurn(g, cfg, rng)));
    for(let step = 0; step < 60 && !g.finished; step++){
      let move = null;
      if(rnd() < 0.02) move = { finish: true };
      else if(rnd() < 0.6){
        const pos = g.base.map((b, i) => [b - g.cum[i], i]).filter(x => x[0] > 0);
        if(pos.length){
          const [r, i] = pick(pos);
          const single = skills.filter(s => s.target === 'single' && s.kind === 'sew');
          const fit = single.filter(s => s.mul * 15 * SEW.POWER[g.power] <= r + 6);
          move = { skill: (fit.length ? pick(fit) : pick(single)).id, anchor: { r: g.pos[i][0], c: g.pos[i][1] } };
        }
      }
      if(!move){
        const sk = pick(skills);
        if(sk.kind === 'muga' && !(g.hsCharged && !g.hsUsed)) continue;
        const anchor = { r: 1 + Math.floor(rnd() * rec.rows), c: 1 + Math.floor(rnd() * rec.cols) };
        if((sk.kind === 'hogushi' || sk.kind === 'shitsuke') && g.cellAt[anchor.r * 8 + anchor.c] === undefined) continue;
        move = { skill: sk.id, anchor };
      }
      log.push(JSON.stringify(SEW.act(g, move, cfg, rng).events));
      if(!g.finished) log.push(JSON.stringify(SEW.beginTurn(g, cfg, rng)));
    }
    const j = SEW.judge(g);
    stars[j.star + 1]++;
    h = fnv(log.join('|') + `#${j.star}/${j.total}`, h);
  }
  return { fp: h.toString(16).padStart(8, '0'), stars };
}

const res = { ref: run({ rainbowAdd: true, hsCharge: true }), app: run({}) };
if(process.argv.includes('--print')){
  console.log(JSON.stringify({ ref: res.ref.fp, app: res.app.fp }));
  process.exit(0);
}
let ok = true;
for(const k of ['ref', 'app']){
  const same = res[k].fp === EXPECT[k];
  if(!same) ok = false;
  console.log(`${k}: ${res[k].fp} ${same ? '一致' : `不一致(記録 ${EXPECT[k] || 'なし'})`}`);
}
process.exit(ok ? 0 : 1);
