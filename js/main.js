// エントリポイント: セーブの検出とフェーズ遷移
(function () {
  function goToPhase(phase) {
    var state = window.GameState.get();
    if (phase === "opening") {
      window.UI.showScreen("opening");
      window.ScreenOpening.render(function () {
        state.phase = "setup";
        window.GameState.save();
        goToPhase("setup");
      });
    } else if (phase === "setup") {
      window.UI.showScreen("setup");
      window.ScreenSetup.render(state, function () {
        state.phase = "loop";
        window.GameState.save();
        goToPhase("loop");
      });
    } else if (phase === "loop") {
      window.UI.showScreen("loop");
      window.ScreenLoop.render(state, function () {
        // STEP12(docs/新設計/12_STEP12_周回引き継ぎ_修正版.md §9): 52週が終わってresult画面に
        // 入る直前の、この1回だけで呼ぶ(ここを逃すとcompendium・関係値・記録が更新されない)。
        // 通常セーブ(state.phase="result")とは別に、js/meta-state.js側(ramen_meta)へも保存する。
        state.__newlyAddedCards = window.MetaState.recordRunEnd(state);
        state.phase = "result";
        window.GameState.save();
        goToPhase("result");
      });
    } else if (phase === "result") {
      window.UI.showScreen("result");
      window.ScreenResult.render(state, state.__newlyAddedCards || []);
    }
  }

  function showResumeChoice() {
    var h = window.UI.h;
    var root = document.getElementById("screen-opening");
    window.UI.clear(root);
    root.appendChild(h("div", { className: "opening-box" }, [
      h("p", { text: "前回の途中経過が残っている。続きから始めるか？" }),
      h("div", { className: "opening-actions" }, [
        h("button", {
          className: "btn", text: "はじめから",
          onclick: function () {
            window.GameState.clearSave();
            window.GameState.reset();
            goToPhase("opening");
          }
        }),
        h("button", {
          className: "btn primary", text: "続きから",
          onclick: function () {
            if (window.GameState.load()) goToPhase(window.GameState.get().phase);
            else { window.GameState.reset(); goToPhase("opening"); }
          }
        })
      ])
    ]));
    window.UI.showScreen("opening");
  }

  // STEP1(docs/新設計/01_STEP1_新システム用データ基盤_修正版.md §1-2): セーブはあるが
  // バージョンが合わない場合、無言で破棄せず一言知らせてから始める。showResumeChoice()と
  // 同じ作り(opening-box/opening-actions)を流用し、confirm()等のネイティブダイアログは使わない。
  function showVersionMismatchNotice() {
    var h = window.UI.h;
    var root = document.getElementById("screen-opening");
    window.UI.clear(root);
    root.appendChild(h("div", { className: "opening-box" }, [
      h("p", { text: "セーブデータの形式が変わったため、最初から始まります。" }),
      h("div", { className: "opening-actions" }, [
        h("button", {
          className: "btn primary", text: "はじめる",
          onclick: function () {
            window.GameState.clearSave();
            window.GameState.reset();
            goToPhase("opening");
          }
        })
      ])
    ]));
    window.UI.showScreen("opening");
  }

  function init() {
    if (window.GameState.hasIncompatibleSave()) {
      showVersionMismatchNotice();
      return;
    }
    if (window.GameState.hasSave()) {
      showResumeChoice();
      return;
    }
    window.GameState.reset();
    goToPhase("opening");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
