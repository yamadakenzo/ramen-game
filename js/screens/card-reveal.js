// v20(docs/指示書/v20_ラーメン屋_修正指示書.md §4): 「素材やキャラクターが跳ねて光りながら
// 出てくる」演出の共通部品。今回はチュートリアル(js/screens/setup.js)からしか呼ばないが、
// 将来「スープの試作」で新しい素材を引いたときにも同じ見た目を使い回せるよう、独立した
// 部品として最初から作る(§4-1)。ここから他画面への接続は行わない(§4-1・§5)。
//
// window.CardReveal.show(items, doneCb)
//   items: [{ emoji, name, sub }] sub は省略可
//   doneCb: 演出が終わった(=タップして「▼ タップして続ける」を閉じた)ときに呼ぶ
//
// v24(docs/指示書/v24_席の設備化とプレゼント演出_指示書.md §4): 自動では閉じない。
// 最後のカードが出終わったら「▼ タップして続ける」を出し、タップされて初めてdoneCbを呼ぶ。
// 演出中のタップは残りを即座に全部表示するだけ(閉じない)。もう一度タップで閉じる。
window.CardReveal = (function () {
  var h = window.UI.h;
  var STAGGER_MS = 150; // §4-3: 複数枚は0.15秒ずつずらす
  var CARD_MS = 450;    // 1枚のバウンド(0.5秒以内、§4-3)
  var LINGER_MS = 250;  // 最後のカードが着地してから「▼ タップして続ける」を出すまでの間

  var overlay = null;
  var row = null;
  var nextEl = null;
  var cardEls = [];
  var timers = [];
  var doneCb = null;
  var phase = null; // "revealing"(出現中) | "waiting"(タップ待ち)

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function clearTimers() {
    timers.forEach(function (t) { clearTimeout(t); });
    timers = [];
  }

  function removeOverlay() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
    row = null;
    nextEl = null;
    cardEls = [];
  }

  // 演出を終える。「▼ タップして続ける」表示中のタップだけがここを通る。
  function complete() {
    clearTimers();
    removeOverlay();
    phase = null;
    var cb = doneCb;
    doneCb = null;
    if (cb) cb();
  }

  // スキップボタンなど、doneCbを呼ばずに演出だけを消したいとき用(§4-4「スキップ時はカード
  // 演出も飛ばす」への対応。呼び出し側が別に次の処理をするので、ここではcbを呼ばない)。
  function cancel() {
    clearTimers();
    removeOverlay();
    phase = null;
    doneCb = null;
  }

  function sparkle(cardEl) {
    var s = h("span", { className: "card-reveal-sparkle emoji-font", text: "✨" });
    cardEl.appendChild(s);
    // ✨自体はCSSアニメーションで消えるが、要素は掃除しておく(残り続けても害はないが行儀として)。
    var t = setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 520);
    timers.push(t);
  }

  function revealCard(i) {
    var card = cardEls[i];
    if (!card || card.classList.contains("in")) return;
    card.classList.add("in");
    sparkle(card);
  }

  function revealAll() {
    for (var i = 0; i < cardEls.length; i++) revealCard(i);
  }

  function showNextPrompt() {
    phase = "waiting";
    if (nextEl) nextEl.classList.add("show");
  }

  // v24 §4-2: 出現中のタップは残りを即座に全部表示して待機状態にするだけ(閉じない)。
  // 待機中のタップで初めて閉じる。
  function onOverlayTap() {
    if (phase === "waiting") { complete(); return; }
    clearTimers();
    revealAll();
    showNextPrompt();
  }

  function show(items, cb) {
    // 前の演出が残っていたら畳んでから始める(doneCbは呼ばない。二重に呼ばれるのを防ぐため)。
    cancel();
    doneCb = cb;
    phase = "revealing";

    overlay = h("div", { className: "card-reveal-overlay", onclick: onOverlayTap });
    row = h("div", { className: "card-reveal-row" });
    nextEl = h("div", { className: "tap-continue emoji-font", text: "▼ タップして続ける" });
    overlay.appendChild(row);
    overlay.appendChild(nextEl);
    (document.getElementById("app") || document.body).appendChild(overlay);

    items.forEach(function (item) {
      var card = h("div", { className: "card-reveal-card" }, [
        h("span", { className: "card-reveal-emoji emoji-font", text: item.emoji }),
        h("div", { className: "card-reveal-name", text: item.name }),
        item.sub ? h("div", { className: "card-reveal-sub", text: item.sub }) : null
      ]);
      row.appendChild(card);
      cardEls.push(card);
    });

    // v24 §4-3: reduced-motionでは即座に全部表示するが、タップ待ちはこの場合も行う
    // (何がプレゼントされたか読めないまま進むのを防ぐのが目的のため)。
    if (reducedMotion()) {
      revealAll();
      showNextPrompt();
      return;
    }

    items.forEach(function (item, i) {
      var t = setTimeout(function () { revealCard(i); }, i * STAGGER_MS);
      timers.push(t);
    });

    var totalMs = (items.length - 1) * STAGGER_MS + CARD_MS + LINGER_MS;
    var promptTimer = setTimeout(showNextPrompt, Math.max(CARD_MS, totalMs));
    timers.push(promptTimer);
  }

  return { show: show, cancel: cancel };
})();
