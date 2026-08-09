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

  // "staff" と書かれていたら ctx.staffId の本人に差し替える
  function resolveWho(choice, state, ctx) {
    var who = resolveText(choice.react_who, state, ctx);
    if (who === "staff") {
      var def = ctx && ctx.staffId ? U.findById(STAFF, ctx.staffId) : null;
      return def ? (def.emoji + " " + def.name) : "";
    }
    return who;
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
          who ? h("div", { className: "react-who emoji-font", text: who }) : null,
          h("div", { className: "react-line", text: line })
        ]));
      }

      var deltaBox = h("div", { className: "delta-box" });
      if (diffs.length === 0) {
        deltaBox.appendChild(h("div", { className: "delta-none", text: "何も変わらなかった" }));
      } else {
        diffs.forEach(function (d) {
          deltaBox.appendChild(h("div", { className: "delta-row " + d.tone }, [
            h("span", { className: "delta-mark", text: d.tone === "good" ? "▲" : (d.tone === "bad" ? "▼" : "・") }),
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
