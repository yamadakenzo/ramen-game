// v05: 案内役の表示まわり。開業フェーズの上部バーと、営業中の吹き出しの両方を面倒みる。
window.Guide = (function () {
  var h = window.UI.h;
  var U = window.Utils;
  var DEF = window.DATA.characters.guide;
  var LINES = window.DATA.guide;

  var bubbleEl = null, bubbleTimer = null;

  function def() { return DEF; }

  function face(cls) {
    return h("div", { className: "guide-face" + (cls ? " " + cls : ""), text: DEF.emoji });
  }

  // 開業フェーズの上部バー。line は差し替えるので要素を返して呼び出し側に持たせる。
  function bar(line, isReact) {
    return h("div", { className: "guide-bar" }, [
      face(),
      h("div", { className: "guide-text" }, [
        h("div", { className: "guide-name", text: DEF.name + "（" + DEF.role + "）" }),
        h("div", { className: "guide-line" + (isReact ? " react" : ""), text: line })
      ])
    ]);
  }

  function ask(stepId) { return LINES.ask[stepId] || ""; }
  function react(itemId) { return LINES.react[itemId] || "なるほど、いいと思います！"; }
  function blurb(itemId) { return LINES.blurb[itemId] || ""; }
  function unpick(kind) { return LINES.unpick[kind] || "了解です。"; }

  // ---------- 営業ループ中の吹き出し ----------
  function mountBubble(parent) {
    bubbleEl = h("div", { className: "guide-bubble", onclick: hide }, [
      face(),
      h("div", { className: "guide-text" }, [
        h("div", { className: "guide-name", text: DEF.name }),
        h("div", { className: "guide-line" })
      ])
    ]);
    parent.appendChild(bubbleEl);
    return bubbleEl;
  }

  function hide() {
    if (bubbleTimer) { clearTimeout(bubbleTimer); bubbleTimer = null; }
    if (bubbleEl) bubbleEl.classList.remove("show");
  }

  function say(text, ms) {
    if (!bubbleEl || !text) return;
    bubbleEl.querySelector(".guide-line").textContent = text;
    bubbleEl.classList.add("show");
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hide, ms || 9000);
  }

  // 4-1-2: 開店直後 / 初めての赤字 / 初めての行列 の3回だけ自動で顔を出す。
  // それ以降は自動では出さない（常に喋る相手がいると鬱陶しいため）。
  function checkAuto(state, weekCtx) {
    var f = state.flags;
    if (!f.guideIntroShown && state.week <= 3) {
      f.guideIntroShown = true;
      return LINES.loop.intro;
    }
    if (!f.guideDeficitShown && weekCtx && weekCtx.profit < 0) {
      f.guideDeficitShown = true;
      return LINES.loop.deficit;
    }
    if (!f.guideQueueShown && weekCtx && weekCtx.queueLevel > 0.1) {
      f.guideQueueShown = true;
      return LINES.loop.queue;
    }
    return null;
  }

  // 呼ばれたときに今の店の状況を一言で言う
  function summary(state) {
    var last = state.history.length ? state.history[state.history.length - 1] : null;
    if (state.money < 0) return "お金が尽きかけてます！ すぐ手を打ちましょう。";
    if (last && last.profit < 0) return "今月、出ていくお金のほうが多いです。値段か材料を見直しましょう。";
    if (last && last.queueLevel > 0.1) return "よく入ってます！ 席を増やすか、提供を速くするか、ですね。";
    if (last && last.avgSatisfaction < 45) return "お客さんの顔が、あまり良くないですね。味を見直しましょうか。";
    if (state.reputation >= 65) return "評判、いいですよ。この調子でいきましょう！";
    if (last && last.totalCustomers < 10) return "お客さんが少ないです。誰に向けた店なのか、もう一度。";
    return "まずまずです。焦らず、一つずつ積みましょう。";
  }

  return {
    def: def, face: face, bar: bar,
    ask: ask, react: react, blurb: blurb, unpick: unpick,
    mountBubble: mountBubble, say: say, hide: hide,
    checkAuto: checkAuto, summary: summary
  };
})();
