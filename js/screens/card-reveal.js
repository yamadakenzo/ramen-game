// v20(docs/指示書/v20_ラーメン屋_修正指示書.md §4): 「素材やキャラクターが跳ねて光りながら
// 出てくる」演出の共通部品。今回はチュートリアル(js/screens/setup.js)からしか呼ばないが、
// 将来「スープの試作」で新しい素材を引いたときにも同じ見た目を使い回せるよう、独立した
// 部品として最初から作る(§4-1)。ここから他画面への接続は行わない(§4-1・§5)。
//
// window.CardReveal.show(items, doneCb)
//   items: [{ emoji, name, sub }] sub は省略可
//   doneCb: 演出が終わった(=最後まで見せ終えた、またはタップで即完了させた)ときに呼ぶ
//
// タップで即座に完了できること(§4-2)。演出全体を3枚で2秒以内に収める(§4-3)。
window.CardReveal = (function () {
  var h = window.UI.h;
  var STAGGER_MS = 150; // §4-3: 複数枚は0.15秒ずつずらす
  var CARD_MS = 450;    // 1枚のバウンド(0.5秒以内、§4-3)
  var LINGER_MS = 250;  // 最後のカードが着地してから閉じるまでの間(見えた実感を残す)

  var overlay = null;
  var timers = [];
  var doneCb = null;

  function clearTimers() {
    timers.forEach(function (t) { clearTimeout(t); });
    timers = [];
  }

  function removeOverlay() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    overlay = null;
  }

  // 演出を終える。§4-2の「タップで即座に完了」、通常の最後まで表示、の両方がここを通る。
  function complete() {
    clearTimers();
    removeOverlay();
    var cb = doneCb;
    doneCb = null;
    if (cb) cb();
  }

  // スキップボタンなど、doneCbを呼ばずに演出だけを消したいとき用(§4-4「スキップ時はカード
  // 演出も飛ばす」への対応。呼び出し側が別に次の処理をするので、ここではcbを呼ばない)。
  function cancel() {
    clearTimers();
    removeOverlay();
    doneCb = null;
  }

  function sparkle(cardEl) {
    var s = h("span", { className: "card-reveal-sparkle emoji-font", text: "✨" });
    cardEl.appendChild(s);
    // ✨自体はCSSアニメーションで消えるが、要素は掃除しておく(残り続けても害はないが行儀として)。
    var t = setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 520);
    timers.push(t);
  }

  function show(items, cb) {
    // 前の演出が残っていたら畳んでから始める(doneCbは呼ばない。二重に呼ばれるのを防ぐため)。
    cancel();
    doneCb = cb;

    overlay = h("div", { className: "card-reveal-overlay", onclick: complete });
    var row = h("div", { className: "card-reveal-row" });
    overlay.appendChild(row);
    (document.getElementById("app") || document.body).appendChild(overlay);

    items.forEach(function (item, i) {
      var card = h("div", { className: "card-reveal-card" }, [
        h("span", { className: "card-reveal-emoji emoji-font", text: item.emoji }),
        h("div", { className: "card-reveal-name", text: item.name }),
        item.sub ? h("div", { className: "card-reveal-sub", text: item.sub }) : null
      ]);
      row.appendChild(card);
      var t = setTimeout(function () {
        card.classList.add("in");
        sparkle(card);
      }, i * STAGGER_MS);
      timers.push(t);
    });

    var totalMs = (items.length - 1) * STAGGER_MS + CARD_MS + LINGER_MS;
    var closeTimer = setTimeout(complete, Math.max(CARD_MS, totalMs));
    timers.push(closeTimer);
  }

  return { show: show, cancel: cancel };
})();
