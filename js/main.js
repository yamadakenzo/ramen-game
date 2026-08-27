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
        // v45: 1枚目の札は「ゲームスタート」に統一され、「つづきから」/「はじめから」はその札の
        // パネルの中で選ぶようになった(docs/指示書/v45_メニュー画面の作り込み_指示書.md §3-5)。
        // ここへ渡す2つの関数の中身と、セーブの読み書きそのものは v38-2 のまま変えていない。
        // 「つづきから」: 有効なセーブを読んで、その phase(setup/loop/result)へ。
        // 読めなかった(直前に消えた等)場合は最初から。
        onContinue: function () {
          if (window.GameState.load()) {
            var p = window.GameState.get().phase;
            goToPhase(p === "opening" ? "setup" : p);
          } else {
            startNew();
          }
        },
        // 「はじめから」: セーブを消して最初から。有効なセーブ/形式不一致のセーブがあるときは、
        // menu.js 側が呼ぶ前に確認を1枚挟む(消えるものが無い=セーブ無しのときだけ確認なし、§3-5)。
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
      window.GameAudio.bgm("shop"); // v39: 営業ループのBGM(「続きから」で直接 loop に入る場合も同じ経路)。遷移そのものには触れない
      // v46(docs/指示書/v46_無期限化_指示書.md §3-2): 52週目は「終わり」ではなく**年の区切り**。
      // 引数の year は、いま終わった年(1年目なら 1)。
      window.ScreenLoop.render(state, function (year) {
        // v46: **MetaState.recordRunEnd() の呼び出しをここから外した。**
        // 年末はもう「1周の終わり」ではないので、図鑑・記録・関係値の引き継ぎを走らせる場面ではない。
        // **js/meta-state.js と recordRunEnd() は消していない**(1行も触っていない)。
        // 次版の「店を畳む」(自分の意思で店をたたんで新しい店を始める)からこれを呼ぶ(§1-2 / §65)。
        // それまでの間、図鑑・記録・関係値の引き継ぎは動かない。承知の上(指示書 §1-2)。
        state.resultYear = year;   // 結果画面がどの年のものか。リロードしても同じ年を出すために state に持つ
        state.phase = "result";
        window.GameState.save();
        goToPhase("result");
      });
    } else if (phase === "result") {
      window.UI.showScreen("result");
      // v46: 第3引数「続ける」。セーブを消さずに翌年の第1週から営業ループへ戻る
      // (state.day は advanceWeek() で既に翌年の1日目へ進めてある)。
      // この画面から「最初からやり直す」経路は無くした(メニューの「はじめから」がある、§3-2)。
      window.ScreenResult.render(state, state.__newlyAddedCards || [], function () {
        state.phase = "loop";
        window.GameState.save();
        goToPhase("loop");
      });
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
