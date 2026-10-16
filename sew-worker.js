/* =====================================================================
   裁縫の推奨手を画面とは別のスレッドで計算する Worker(sew-ui.js から使う)。
   終盤の試し打ち(先読み)は数秒かかることがあるので、計算中も画面が固まらないようにする。
   ===================================================================== */
// sew-ui.js から渡された版の印を、読み込むファイルにも付ける(古いファイルが使われないように)
importScripts('sew-recipes.js' + self.location.search, 'sew-engine.js' + self.location.search, 'sew-ai.js' + self.location.search);

const CTX = new Map();     // レシピ・設定ごとの準備(表づくりが重いので使い回す)
self.onmessage = function(e){
  const q = e.data;
  try{
    const recipe = SEW_RECIPES.find(r => r.id === q.recipeId);
    const g = Object.assign({}, q.g, { recipe, opts: q.g.opts || {} });
    const key = [q.recipeId, q.cfg.level, q.cfg.needle, q.cfg.star, q.cfg.kotsu ? 1 : 0, JSON.stringify(q.prm)].join('/');
    let ctx = CTX.get(key);
    if(!ctx){ ctx = SEW_AI.prepare(recipe, q.cfg, q.prm); CTX.set(key, ctx); }
    self.postMessage({ id: q.id, move: SEW_AI.choose(g, q.cfg, ctx) });
  }catch(err){
    // 失敗したら画面側で計算し直す(sew-ui.js は move が無い時に自分で計算する)
    self.postMessage({ id: q.id, move: null, error: String(err) });
  }
};
