// v22(docs/指示書/v22_ラーメン開発チュートリアル_修正指示書.md §4・§5): 「ラーメン開発」の
// 完成演出(手順4)と命名モーダル(手順5)。js/screens/card-reveal.jsと同じ考え方
// (#app直下のフルスクリーンオーバーレイ、タップで即完了、独立した部品でどの画面からも呼べる)で作った。
//
// window.DevelopReveal.show(items, defaultName, onNamed)
//   items: [{ emoji, name }] 選んだ素材カード(「なし」は含めない。呼び出し側で除外する)
//   defaultName: 命名モーダルに最初から入っている名前
//   onNamed(name): 決定ボタンを押した(または空欄のまま決定した)ときに、確定した名前を渡して呼ぶ
//
// 手順4は合計2.5秒以内(js/screens/loop.js側から渡すitemsは最大4枚)。画面タップで演出をスキップし、
// 即座に命名モーダルへ進める(命名モーダル自体はタップでは閉じない。誤操作で入力を失わないため)。
window.DevelopReveal = (function () {
  var h = window.UI.h;
  var STAGGER_MS = 250; // 手順4: 「0.25秒間隔」の指示どおり
  var FLY_MS = 550;
  var STEAM_MS = 600;
  var SPARKLE_COUNT = 3;

  var overlay = null;
  var timers = [];
  var phase = null; // "flying" | "naming"
  var onNamedCb = null;
  var pendingDefaultName = null;

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
  }

  function cancel() {
    clearTimers();
    removeOverlay();
    phase = null;
    onNamedCb = null;
    pendingDefaultName = null;
  }

  function onOverlayTap() {
    // 手順4「画面タップでスキップ可能」。命名モーダル(手順5)はタップでは閉じない。
    if (phase === "flying") {
      clearTimers();
      showNaming(pendingDefaultName);
    }
  }

  function show(items, defaultName, onNamed) {
    cancel();
    onNamedCb = onNamed;
    pendingDefaultName = defaultName;
    phase = "flying";

    overlay = h("div", { className: "dev-reveal-overlay", onclick: onOverlayTap });
    (document.getElementById("app") || document.body).appendChild(overlay);

    if (reducedMotion() || !items.length) {
      // 動きを止める設定、または(念のため)何も選ばれていない場合は演出を飛ばして命名へ。
      showNaming(defaultName);
      return;
    }
    runFlyStage(items);
  }

  function runFlyStage(items) {
    var stage = h("div", { className: "dev-reveal-stage" });
    overlay.appendChild(stage);

    var bowl = h("div", { className: "dev-reveal-bowl emoji-font", text: "🍜" });
    stage.appendChild(bowl);

    var row = h("div", { className: "dev-reveal-cards" });
    stage.appendChild(row);

    var cardEls = items.map(function (item) {
      var card = h("div", { className: "dev-reveal-card" }, [
        h("span", { className: "emoji emoji-font", text: item.emoji }),
        h("div", { className: "name", text: item.name })
      ]);
      row.appendChild(card);
      return card;
    });

    // 次のフレームで実測位置から丼までの差分を入れ、飛ばし始める(0.25秒ずつずらす)。
    // phase!=="flying"になっていたら(タップでスキップ済み等)何もしない(既に外れたDOMへ触らないため)。
    requestAnimationFrame(function () {
      if (phase !== "flying") return;
      var bowlRect = bowl.getBoundingClientRect();
      var bowlCx = bowlRect.left + bowlRect.width / 2;
      var bowlCy = bowlRect.top + bowlRect.height / 2;
      cardEls.forEach(function (card, i) {
        var r = card.getBoundingClientRect();
        var cx = r.left + r.width / 2;
        var cy = r.top + r.height / 2;
        card.style.setProperty("--dx", (bowlCx - cx) + "px");
        card.style.setProperty("--dy", (bowlCy - cy) + "px");
        var t = setTimeout(function () { card.classList.add("flying"); }, i * STAGGER_MS);
        timers.push(t);
      });
      var lastEnd = (items.length - 1) * STAGGER_MS + FLY_MS;
      var t2 = setTimeout(function () { runFinishStage(bowl); }, lastEnd);
      timers.push(t2);
    });
  }

  function runFinishStage(bowl) {
    if (phase !== "flying" || !bowl.parentNode) return;
    bowl.classList.add("pop");
    var steam = h("div", { className: "dev-reveal-steam emoji-font", text: "♨️" });
    bowl.parentNode.appendChild(steam);
    requestAnimationFrame(function () { steam.classList.add("show"); });

    for (var i = 0; i < SPARKLE_COUNT; i++) {
      (function (i) {
        var t = setTimeout(function () {
          if (!overlay || phase !== "flying" || !bowl.parentNode) return;
          var angle = (i / SPARKLE_COUNT) * Math.PI * 2 - Math.PI / 2;
          var radius = 30;
          var s = h("span", { className: "dev-reveal-sparkle-burst emoji-font", text: "✨" });
          var bowlRect = bowl.getBoundingClientRect();
          var stageRect = bowl.parentNode.getBoundingClientRect();
          var cx = bowlRect.left + bowlRect.width / 2 - stageRect.left + Math.cos(angle) * radius;
          var cy = bowlRect.top + bowlRect.height / 2 - stageRect.top + Math.sin(angle) * radius;
          s.style.left = cx + "px";
          s.style.top = cy + "px";
          bowl.parentNode.appendChild(s);
          requestAnimationFrame(function () { s.classList.add("show"); });
        }, 100 + i * 90);
        timers.push(t);
      })(i);
    }

    var t3 = setTimeout(function () { showNaming(pendingDefaultName); }, STEAM_MS);
    timers.push(t3);
  }

  function showNaming(defaultName) {
    phase = "naming";
    clearTimers();
    if (!overlay) return;
    window.UI.clear(overlay);

    var input = h("input", { className: "dev-name-input", type: "text", value: defaultName || "", maxlength: "12" });
    var confirm = function () {
      var v = (input.value || "").trim();
      if (!v) v = defaultName || "";
      if (v.length > 12) v = v.slice(0, 12);
      var cb = onNamedCb;
      cancel();
      if (cb) cb(v);
    };
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") confirm(); });

    var box = h("div", { className: "modal-box dev-name-box", onclick: function (e) { e.stopPropagation(); } }, [
      h("h2", { text: "名前をつけよう" }),
      h("p", { className: "dim", text: "このままでもいい。書き換えてもいい（最大12文字、空欄なら自動で決める）。" }),
      input,
      h("button", { className: "btn primary", text: "決定", onclick: confirm })
    ]);
    overlay.appendChild(box);
    var t = setTimeout(function () { input.focus(); input.select(); }, 60);
    timers.push(t);
  }

  return { show: show, cancel: cancel };
})();
