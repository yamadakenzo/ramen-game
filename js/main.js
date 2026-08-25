// エントリポイント: フェーズ遷移
// v38-2(docs/指示書/v38-2_モードメニュー_指示書.md §5-1): 起動時の分岐を一本化した。
// 以前は init() がセーブの有無で showResumeChoice()(続きから/はじめから)・showVersionMismatchNotice()
// (形式不一致)を出し分けていて、セーブがあるとタイトル画面に到達しなかった。今はセーブの有無に
// かかわらず常に goToPhase("opening") から入り、その3状態の出し分けはモードメニューの「続きから/はじめから」札
// (js/screens/menu.js)が担う。setup 以降の経路は触っていない。
(function () {
  function goToPhase(phase) {
    var state = window.GameState.get();
    if (phase === "opening") {
      window.UI.showScreen("opening");
      // オープニング(タイトル画面のタップ)の先はモードメニュー。ここではセーブしない
      // (「はじめから」を選ぶまで state.phase は "opening" のまま。セーブ有無の判定を汚さないため)。
      window.ScreenOpening.render(function () { goToPhase("menu"); });
    } else if (phase === "menu") {
      // メニューは state を持たない通過点。state.phase に "menu" は書かず、goToPhase だけで入る
      // (SAVE_VERSION も上げない)。
      window.UI.showScreen("menu");
      window.ScreenMenu.render({
        // 「続きから」: 有効なセーブを読んで、その phase(setup/loop/result)へ。
        // 読めなかった(直前に消えた等)場合は最初から。
        onContinue: function () {
          if (window.GameState.load()) {
            var p = window.GameState.get().phase;
            goToPhase(p === "opening" ? "setup" : p);
          } else {
            startNew();
          }
        },
        // 「はじめから」: セーブを消して最初から。
        onNewGame: startNew
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

  // 最初から始める。旧 showResumeChoice() の「はじめから」(clearSave+reset)と、旧 opening 完了時に
  // やっていた phase="setup"+save をここに寄せた(セーブが最初に作られるのはこの瞬間)。
  function startNew() {
    window.GameState.clearSave();
    window.GameState.reset();
    var state = window.GameState.get();
    state.phase = "setup";
    window.GameState.save();
    goToPhase("setup");
  }

  function init() {
    // セーブの有無にかかわらず、常にオープニング(2周目以降はタイトル画面へ直行)から入る(§5-1)。
    goToPhase("opening");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
