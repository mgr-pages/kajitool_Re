/* =====================================================================
   トップページ(index.html)。鍛冶と裁縫のどちらを使うかを選ぶ。
   ・打ちかけの対局がある職人には、その旨を出す(各画面の記録が、打ち始めから結果を選ぶまで端末に残っているかで見る)。
   ・一番下に版を出す(各画面の設定欄と同じ形)。
   ===================================================================== */
'use strict';
(function(){
  const rd = k => { try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } };
  // 打ち始めた後、結果を選ぶまでの記録(gamelog.js の GLOG_CUR・sew-ui.js の SEW_LOG_CUR と同じ名前)
  const live = { kaji: 'kajiAdvisorLogCurV1', sew: 'sewAdvisorLogCurV1' };
  for(const k of Object.keys(live)){
    const el = document.getElementById('st-' + k);
    if(el && rd(live[k])) el.textContent = '打ちかけの対局があります';
  }
  const el = document.getElementById('v-ver');
  if(el){
    const me = document.querySelector('script[src^="top.js"]');
    const js = me ? ((me.getAttribute('src').split('?v=')[1]) || '—') : '—';
    const css = getComputedStyle(document.documentElement).getPropertyValue('--css-ver').trim().replace(/"/g, '') || '—';
    const title = (document.title.match(/V[\d.]+/) || [''])[0];
    el.innerHTML = `${title} ・ 画面 ${js} ・ 見た目 ${css}`
      + (js !== css ? '<br><b>見た目のファイルが古いままです。ブラウザのキャッシュを消してください</b>' : '');
  }
})();
