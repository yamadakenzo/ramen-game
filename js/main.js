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
        state.phase = "result";
        window.GameState.save();
        goToPhase("result");
      });
    } else if (phase === "result") {
      window.UI.showScreen("result");
      window.ScreenResult.render(state);
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

  function init() {
    if (window.GameState.hasSave()) {
      showResumeChoice();
      return;
    }
    window.GameState.reset();
    goToPhase("opening");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
