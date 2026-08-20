// イベントモーダル: pendingEventsを1件ずつ表示し、選択 -> 効果適用 -> 結果表示 の順で進む
window.ScreenEventModal = (function () {
  var h = window.UI.h;
  var U = window.Utils;
  var STAFF = window.DATA.characters.staff;

  // react / react_who は状況で文面が変わるものだけ関数を許している
  function resolveText(v, state, ctx) {
    if (typeof v === "function") return v(state, ctx);
    return v || "";
  }

  // "staff" と書かれていたら ctx.staffId の本人に差し替える。
  // v31 §3-2(Q4): 以前はここで"def.emoji + " " + def.name"を1本の文字列に結合していたため、
  // 同じ従業員が雇用カードでは絵・イベントの発言者名では絵文字のまま、という食い違いが起きていた。
  // ここではdefをそのまま返し、表示側(showResult)でwindow.AssetImage.node(def)を使って組み立て直す。
  // それ以外(events.js側に直書きされた"🧓 最初の客"のような定型文)は、元から絵文字が地の文の
  // 一部として書かれているだけなので手を付けない(データ定義の絵文字フィールドではないため対象外)。
  function resolveWho(choice, state, ctx) {
    var who = resolveText(choice.react_who, state, ctx);
    if (who === "staff") {
      var def = ctx && ctx.staffId ? window.Scoring.findStaffDef(state, ctx.staffId) : null; // STEP6
      return { def: def, text: def ? def.name : "" };
    }
    return { def: null, text: who };
  }

  function showQueue(state, entries, onAllDone) {
    var overlay = document.getElementById("event-modal-overlay");
    var box = document.getElementById("event-modal-box");
    var idx = 0;

    function next() { idx++; showOne(); }

    function showResult(entry, choice, diffs) {
      var ev = entry.ev;
      box.className = "modal-box";
      window.UI.clear(box);
      box.appendChild(h("h2", { text: ev.title }));
      box.appendChild(h("div", { className: "result-choice", text: "▶ " + choice.label }));

      var who = resolveWho(choice, state, entry.ctx);
      var line = resolveText(choice.react, state, entry.ctx);
      if (line) {
        box.appendChild(h("div", { className: "react-box" }, [
          who.text ? h("div", { className: "react-who emoji-font" }, [
            who.def ? window.AssetImage.node(who.def) : null,
            who.def ? " " : null,
            who.text
          ]) : null,
          h("div", { className: "react-line", text: line })
        ]));
      }

      var deltaBox = h("div", { className: "delta-box" });
      if (diffs.length === 0) {
        deltaBox.appendChild(h("div", { className: "delta-none", text: "何も変わらなかった" }));
      } else {
        diffs.forEach(function (d) {
          // v31 §3-2(Q4): d.iconがあれば(素材の差分など)先頭に絵/絵文字を出す。
          deltaBox.appendChild(h("div", { className: "delta-row " + d.tone }, [
            h("span", { className: "delta-mark", text: d.tone === "good" ? "▲" : (d.tone === "bad" ? "▼" : "・") }),
            d.icon ? h("span", { className: "delta-icon emoji-font" }, [window.AssetImage.node(d.icon)]) : null,
            h("span", { text: d.text })
          ]));
        });
      }
      box.appendChild(deltaBox);

      box.appendChild(h("div", { className: "modal-choices" }, [
        h("button", { className: "btn primary", text: "続ける", onclick: next })
      ]));
      overlay.classList.add("show");
    }

    function showOne() {
      if (idx >= entries.length) {
        overlay.classList.remove("show");
        onAllDone();
        return;
      }
      var entry = entries[idx];
      var ev = entry.ev;
      box.className = "modal-box";
      window.UI.clear(box);
      box.appendChild(h("h2", { text: ev.title }));
      box.appendChild(h("p", { text: ev.text }));
      var choicesBox = h("div", { className: "modal-choices" });
      ev.choices.forEach(function (choice) {
        choicesBox.appendChild(h("button", {
          className: "btn",
          text: choice.label,
          onclick: function () {
            var before = window.EventEngine.snapshotForDiff(state);
            if (choice.effect && typeof choice.effect === "object") {
              window.EventEngine.applyEffect(state, choice.effect, entry.ctx);
            }
            var diffs = window.EventEngine.diffSnapshots(before, state);
            window.EventEngine.markFired(state, entry);
            showResult(entry, choice, diffs);
          }
        }));
      });
      box.appendChild(choicesBox);
      overlay.classList.add("show");
    }
    showOne();
  }

  return { showQueue: showQueue };
})();
