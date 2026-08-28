// 音の基盤(v38-2 で初導入、v39 で BGM 3曲・効果音6種・設定の2系統に拡張。docs/指示書/v39_音の基盤_指示書.md)。
//
// 方針:
//   - 音は演出。鳴らす処理はゲームの計算・状態遷移の順序を変えない(呼び出し側は1行足すだけ。アニメーション一方向の原則)。
//   - 音源が無い・読めない・再生を拒否された、のどれでも静かに握りつぶす(コンソールにエラーを出さず、ゲームは無音のまま動く)。
//     ブラウザは無いファイルを要求すると 404 をコンソールエラーとして出す(Audio 要素でも fetch でも。v39 で実測)ので、
//     実在するファイルの一覧 audio/manifest.js(window.AUDIO_MANIFEST、tools/audio-manifest.js が生成)に載っているものだけを要求する。
//     音源を置いたら node tools/audio-manifest.js を1回走らせる(tools/deploy-pages.sh は公開時に自動で走らせる)。
//   - 自動再生制限(§3、v41 §60 で作り直し): まず play() を試み、拒否されたら document に待ち受けを張って最初の操作で再生する。
//     待つのは pointerup / touchend / click / keydown。**タッチの pointerdown はユーザ操作に数えられない**ので待っても無駄
//     (v39 はそれで実機が永久に無音になった)。リスナは**再生の成功を確かめてから**外し、失敗したら張ったまま次の操作で試す。
//     途中から始まっても頭出しはしない。失敗は握り潰さず failures() に残す。
//   - 設定(§4): localStorage の独立キー ramen_audio に JSON {v, bgm, se, bgmVol, seVol}。旧値 "on"/"off"(v38-2、効果音のみ)は
//     読めるようにしてある(off → 効果音オフ、BGM はオン)。音量(bgmVol/seVol)は器だけ(今回はオン/オフのみ、§6)。
//   - 音源の参照は BGM / SE のテーブル1か所。URL には ?v=20260828125425(tools/deploy-pages.sh の sed 対象)。
// 名前は window.GameAudio。window.Audio はブラウザ組み込みのコンストラクタなので使わない。
window.GameAudio = (function () {
  var KEY = "ramen_audio";
  var BUILD_V = "20260828125425";
  var DIR = "audio/";

  // ---- テーブル(id → audio/ からの相対パス)。ここだけ変えれば差し替えられる ----
  var BGM = {
    opening: { file: "bgm/opening.mp3", loop: false }, // シネマティック中(1回きり)
    title:   { file: "bgm/title.mp3",   loop: true },  // タイトル画面・メニュー
    shop:    { file: "bgm/shop.mp3",    loop: true }   // 営業ループ
  };
  var SE = {
    slide:  "se/slide.wav",   // メニューの札が止まった瞬間(v38-2 の仮の合成音。差し替え予定)
    decide: "se/decide.wav",  // メニューの決定
    arrive: "se/arrive.wav",  // 客が店に入った瞬間
    serve:  "se/serve.wav",   // 丼が客に届いた瞬間
    coin:   "se/coin.wav",    // 会計(コイン演出と同時)
    week:   "se/week.wav"     // 週末の収支が確定した瞬間
  };
  var FADE_MS = 300;        // BGM の切り替えのフェード(§2: 200〜400ms)
  var FADE_STEP_MS = 30;
  var SE_POOL = 3;          // 同じ効果音の同時再生数。来店・提供が重なっても3つまで重ね、それ以上は古いものを頭から鳴らし直す
  var SE_MIN_GAP_MS = 50;   // 同じ効果音をこれより短い間隔では鳴らさない(同一フレームでの多重発火を1回にまとめる。割れ・詰まり対策)

  // ---- 設定 ----
  var settings = loadSettings();
  function loadSettings() {
    var s = { v: 1, bgm: true, se: true, bgmVol: 1, seVol: 1 };
    try {
      var raw = localStorage.getItem(KEY);
      if (raw === "on") return s;                       // v38-2 の旧値: 効果音オン
      if (raw === "off") { s.se = false; return s; }    // v38-2 の旧値: 効果音オフ(BGM はまだ無かったのでオン)
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === "object") {
          if (typeof o.bgm === "boolean") s.bgm = o.bgm;
          if (typeof o.se === "boolean") s.se = o.se;
          if (typeof o.bgmVol === "number") s.bgmVol = clamp01(o.bgmVol);
          if (typeof o.seVol === "number") s.seVol = clamp01(o.seVol);
        }
      }
    } catch (e) { /* 壊れた値・保存できない環境: 既定(両方オン)で動く */ }
    return s;
  }
  function saveSettings() {
    try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* 保存できない環境では次回また既定に戻るだけ */ }
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function isBgmOn() { return settings.bgm; }
  function isSeOn() { return settings.se; }
  function setBgmOn(on) {
    settings.bgm = !!on; saveSettings();
    if (!settings.bgm) { if (cur) { fadeOutAndStop(cur.el); cur = null; } }
    else if (wanted) { startBgm(wanted); }
  }
  function setSeOn(on) { settings.se = !!on; saveSettings(); }

  // ---- ファイルの有無と URL ----
  function exists(rel) {
    var m = window.AUDIO_MANIFEST;
    return !!(m && Object.prototype.hasOwnProperty.call(m, rel));
  }
  function url(rel) { return DIR + rel + "?v=" + BUILD_V; }
  function noop() {}

  // ---- 自動再生制限(§3、v41 §60 で作り直し) ----
  //
  // **待つのは「操作として数えられるイベント」だけ。** v39 は pointerdown を待っていたが、HTML 仕様の
  // 「操作とみなす入力イベント」は keydown / mousedown / pointerdown(pointerType が mouse のとき) /
  // pointerup(mouse 以外) / touchend で、**タッチの pointerdown は入っていない**。
  // v41 の実測(docs/v41_確認/run_autoplay.js の MODE=gesture):
  //     pointerdown(touch) … navigator.userActivation = false/false → play() は必ず NotAllowedError
  //     pointerup(touch) / touchend / click(touch) … true/true → play() 成功
  //     pointerdown(mouse) … true/true → play() 成功       ← PC でだけ動いていたので気づけなかった
  // なのでタッチ端末では pointerdown での再生は 100% 失敗する。実機で「メニューまで来ても鳴らない」の正体。
  //
  // **成功を確かめてから待ち受けを外す。** v39 は外してから試し、失敗を握り潰していたので、1回拒否されると
  // 二度と張り直されず永久に無音になった。失敗しても張ったままにして、次の操作でもう一度試す。
  var GESTURES = ["pointerup", "touchend", "click", "keydown"];
  var unlocked = false;   // 一度でも再生に成功した(診断用)
  var waiting = false;    // 待ち受けを張っている
  var retrying = false;   // 1回の操作から複数のイベントが来ても play() は1回だけ
  function onGesture() {
    if (retrying) return;
    if (!settings.bgm) { stopWaiting(); return; }   // 設定でオフ: 待つ必要がない
    if (!cur) {                                     // 要素を失っている(読み込み失敗で cur=null 等)
      if (!wanted) { stopWaiting(); return; }
      startBgm(wanted);                             // 作り直す(成功なら startBgm 側で待ち受けを外す)
      return;
    }
    if (!cur.el.paused) { stopWaiting(); return; }  // もう鳴っている
    retrying = true;
    var el = cur.el;
    tryPlay(el, function () {
      retrying = false;
      stopWaiting();                                // ← 成功を確認してから外す
      fadeTo(el, settings.bgmVol);
    }, function (e) {
      retrying = false;
      noteFail("操作後の再生", el, e);               // ← 握り潰さない
      // 待ち受けは張ったまま。次の操作でまた試す
    });
  }
  function waitGesture() {
    if (waiting) return;
    waiting = true;
    for (var i = 0; i < GESTURES.length; i++) document.addEventListener(GESTURES[i], onGesture, true);
  }
  function stopWaiting() {
    if (!waiting) return;
    waiting = false;
    for (var i = 0; i < GESTURES.length; i++) document.removeEventListener(GESTURES[i], onGesture, true);
  }
  function tryPlay(el, ok, fail) {
    var p;
    try { p = el.play(); } catch (e) { fail(e); return; }
    if (p && typeof p.then === "function") {
      p.then(function () { unlocked = true; ok(); }, function (e) { fail(e); });
    } else { unlocked = true; ok(); }
  }

  // ---- 失敗の記録(v41 §60: fail = noop をやめる) ----
  // コンソールへは出さない(音の失敗でコンソールを汚さないのが §57-1 からの方針)。代わりに手元に残し、
  // GameAudio.failures() で読めるようにする。走行スクリプトはこれを見て「黙って死んでいないか」を確かめる。
  var failures = [];
  var FAIL_MAX = 20;      // 直近ぶんだけ。1週間で効果音が何十回も失敗しても溢れさせない
  function noteFail(where, el, e) {
    failures.push({
      at: Date.now(), where: where,
      src: String((el && (el.currentSrc || el.src)) || "").replace(/^.*\/audio\//, "").replace(/\?.*$/, ""),
      name: (e && e.name) || "(不明)",
      message: (e && e.message) ? String(e.message).slice(0, 120) : ""
    });
    if (failures.length > FAIL_MAX) failures.shift();
  }

  // ---- BGM ----
  var cur = null;      // { id, el }  今鳴っている(または鳴らそうとしている)曲
  var wanted = null;   // 最後に指定された曲の id(設定オフ・ファイル無しでも覚えておき、オンにしたときに鳴らす)
  var fades = [];      // 進行中のフェード [{el, timer}]
  function cancelFade(el) {
    fades = fades.filter(function (f) { if (f.el === el) { clearInterval(f.timer); return false; } return true; });
  }
  function fadeTo(el, target, done) {
    cancelFade(el);
    var from = el.volume, steps = Math.max(1, Math.round(FADE_MS / FADE_STEP_MS)), i = 0;
    var f = { el: el, timer: setInterval(function () {
      i++;
      try { el.volume = clamp01(from + (target - from) * (i / steps)); } catch (e) { /* noop */ }
      if (i >= steps) { clearInterval(f.timer); fades = fades.filter(function (x) { return x !== f; }); if (done) done(); }
    }, FADE_STEP_MS) };
    fades.push(f);
  }
  function fadeOutAndStop(el) {
    fadeTo(el, 0, function () { try { el.pause(); el.src = ""; } catch (e) { /* noop */ } });
  }
  function startBgm(id) {
    var def = BGM[id];
    if (!def || !settings.bgm || !exists(def.file)) return;
    var el;
    try { el = new window.Audio(url(def.file)); } catch (e) { return; }
    // §10-3: volume の代入も try の中に入れる。端末によっては HTMLMediaElement.volume への代入が例外になり、
    // ここで bgm() が投げると呼び出し元が描画の途中で止まる(renderCinematic は UI.clear(root) の直後で
    // 中断し、真っ暗な画面のまま busy が立ちっぱなしになる)。se() は元から try の内側で、それにそろえた。
    try { el.loop = !!def.loop; el.preload = "auto"; el.volume = 0; } catch (e) { /* noop */ }
    el.addEventListener("error", function () { if (cur && cur.el === el) cur = null; });
    cur = { id: id, el: el };
    tryPlay(el, function () {
      stopWaiting();                      // 鳴り出したので、待ち受けが残っていれば外す
      fadeTo(el, settings.bgmVol);
    }, function (e) {
      noteFail("自動再生", el, e);
      waitGesture();                      // 次の操作で鳴らし直す
    });
  }
  // bgm(id): その曲へ切り替える(短いフェード)。同じ曲なら何もしない(頭に戻さない)。null で止める。
  function bgm(id) {
    if (cur && cur.id === id) return;
    wanted = id || null;
    if (cur) { fadeOutAndStop(cur.el); cur = null; }
    if (id) startBgm(id);
  }
  // 画面が隠れたら止め、戻ったら続きから(隠れている間の無駄な再生を避ける)
  document.addEventListener("visibilitychange", function () {
    if (!cur) return;
    if (document.hidden) { try { cur.el.pause(); } catch (e) { /* noop */ } }
    else if (settings.bgm) {
      var el = cur.el;
      tryPlay(el, noop, function (e) { noteFail("復帰時の再生", el, e); waitGesture(); });
    }
  });

  // ---- 効果音 ----
  // id ごとに最大 SE_POOL 個の要素を回して使う(重なりを許す)。同じ id が SE_MIN_GAP_MS 以内に来たら2発目以降は捨てる。
  var pools = {};
  var lastAt = {};
  function se(id) {
    if (!settings.se) return;
    var rel = SE[id];
    if (!rel || !exists(rel)) return;
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    if (lastAt[id] != null && now - lastAt[id] < SE_MIN_GAP_MS) return;
    lastAt[id] = now;
    var pool = pools[id] || (pools[id] = { i: 0, els: [] });
    var el = pool.els[pool.i];
    if (!el) {
      try { el = new window.Audio(url(rel)); } catch (e) { return; }
      el.preload = "auto";
      pool.els[pool.i] = el;
    }
    pool.i = (pool.i + 1) % SE_POOL;
    try {
      el.volume = settings.seVol;
      el.currentTime = 0; // 使い回しの要素は頭から
      var p = el.play();
      // 自動再生制限・未読み込み等。音は出なくてよいが、何が起きたかは残す(v41 §60)
      if (p && typeof p.catch === "function") p.catch(function (e) { noteFail("効果音", el, e); });
    } catch (e) { noteFail("効果音", el, e); }
  }

  return {
    bgm: bgm, se: se,
    isBgmOn: isBgmOn, isSeOn: isSeOn, setBgmOn: setBgmOn, setSeOn: setSeOn,
    // v41 §60: 失敗を握り潰さないための窓口。ゲーム側は使わない(走行スクリプトと手元の確認用)。
    failures: function () { return failures.slice(); },
    diag: function () {
      return {
        waiting: waiting, unlocked: unlocked, wanted: wanted,
        cur: cur ? cur.id : null, paused: cur ? !!cur.el.paused : null,
        gestures: GESTURES.slice()
      };
    },
    // v38-2 互換(効果音のミュート)。新しいコードは isSeOn/setSeOn を使う
    play: se, isMuted: function () { return !settings.se; }, setMuted: function (m) { setSeOn(!m); }, toggleMuted: function () { setSeOn(!settings.se); return !settings.se; }
  };
})();
