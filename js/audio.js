// v38-2: 音の基盤(docs/指示書/v38-2_モードメニュー_指示書.md §5-4)。この版で初導入。
// 今はモードメニューのスライドSE 1本だけ。BGMは入れていない。
//
// 方針:
//   - 再生はすべてユーザー操作(タップ・キー)起点で呼ぶ。タイトル画面のタップを経てメニューへ来るので
//     自動再生制限には掛からない(docs/設計判断記録.md §54-4)。
//   - 音源が無い・読めない・再生を拒否された、のどれでも静かに握りつぶす(コンソールにエラーを出さず、
//     ゲームは無音のまま動く)。
//   - ミュートは localStorage の独立キー ramen_audio("on"|"off"、無ければオン)。通常セーブ(ramen_v10_save)
//     にも周回引き継ぎ(ramen_meta)にも混ぜない(消える・巻き込まれる理由は js/screens/opening.js の
//     SEEN_KEY と同じ)。
//   - 音源の参照はこのファイルの SE テーブル1か所だけ。?v=20260825131137 は tools/deploy-pages.sh が公開時に
//     置換する(sed の対象にこのファイルを足してある。忘れると v30 の video/ 取りこぼしと同じ事故になる)。
// 名前は window.GameAudio。window.Audio はブラウザ組み込みのコンストラクタなので使わない。
window.GameAudio = (function () {
  var KEY = "ramen_audio";
  var BUILD_V = "20260825131137";
  var DIR = "audio/";
  // 仮のSE(tools/gen-se.js が合成した短い減衰音、約4KB)。本番の音源に差し替えるときはここだけ変える。
  // slide: メニューの札が定位置にはまった瞬間に1回(Swiper の slideChangeTransitionEnd、§7-3。ドラッグ中・移動中では鳴らさない)。
  var SE = {
    slide: DIR + "se_slide.wav?v=" + BUILD_V
  };

  function isMuted() {
    try { return localStorage.getItem(KEY) === "off"; } catch (e) { return false; }
  }
  function setMuted(flag) {
    try { localStorage.setItem(KEY, flag ? "off" : "on"); } catch (e) { /* 保存できない環境では次回また既定(オン)に戻るだけ */ }
  }
  function toggleMuted() { var next = !isMuted(); setMuted(next); return next; }

  // name -> HTMLAudioElement。初回再生時に作る。読み込みに失敗したら false を入れて二度と触らない。
  var cache = {};
  function get(name) {
    if (name in cache) return cache[name];
    var src = SE[name];
    if (!src || typeof window.Audio !== "function") { cache[name] = false; return false; }
    var el;
    try {
      el = new window.Audio(src);
      el.preload = "auto";
      el.addEventListener("error", function () { cache[name] = false; });
    } catch (e) {
      cache[name] = false;
      return false;
    }
    cache[name] = el;
    return el;
  }

  function play(name) {
    if (isMuted()) return;
    var el = get(name);
    if (!el) return;
    try {
      el.currentTime = 0; // 連打で前の再生が終わっていなくても頭から鳴らす
      var p = el.play();
      if (p && typeof p.catch === "function") p.catch(function () { /* 自動再生制限・未読み込み等。無音でよい */ });
    } catch (e) { /* noop */ }
  }

  return { play: play, isMuted: isMuted, setMuted: setMuted, toggleMuted: toggleMuted };
})();
