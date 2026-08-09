// v07-3: 定休日のアクション画面。
// 「今週、何をするか」を毎週必ず選ばせる。8種すべてを毎週出し、条件を満たさないものはグレーアウトで見せる
// (開業フェーズの物件と同じ扱い)。効果の判定は js/event-engine.js の resolveDayOffAction に任せる。
window.DayOff = (function () {
  var h = window.UI.h;
  var U = window.Utils;
  var EE = window.EventEngine;
  var ACTIONS = window.DATA.actions.actions;
  var STAFF = window.DATA.characters.staff;
  var CARDS = window.DATA.characters.cards;

  function fatigueBlock(state) {
    var f = Math.round(state.flags.fatigue || 0);
    var cls = f >= 70 ? "bad-fill" : (f >= 40 ? "warn-fill" : "good-fill");
    return h("div", { className: "sheet-section" }, [
      h("div", { className: "stat-grid" }, [
        h("span", { className: "stat-name", text: "疲労" }),
        h("div", { className: "mini-track" }, [h("div", { className: "mini-fill " + cls, style: { width: f + "%" } })]),
        h("span", { className: "stat-num", text: String(f) })
      ])
    ]);
  }

  function show(state, G, onDone) {
    var overlay = document.getElementById("event-modal-overlay");
    var box = document.getElementById("event-modal-box");

    function renderGrid() {
      box.className = "modal-box dayoff-box";
      window.UI.clear(box);
      box.appendChild(h("h2", { text: "定休日" }));
      box.appendChild(h("p", { className: "dim", text: "今週の定休日、何をする？" }));
      box.appendChild(fatigueBlock(state));

      var grid = h("div", { className: "choice-grid" });
      ACTIONS.forEach(function (def) {
        var gate = def.gate ? def.gate(state) : { ok: true };
        var needsStaff = def.needsTarget === "staff" && state.staffHired.length === 0;
        var ok = gate.ok !== false && !needsStaff;
        grid.appendChild(h("div", {
          className: "choice-card" + (ok ? "" : " disabled"),
          onclick: function () { if (ok) handlePick(def); }
        }, [
          h("div", { className: "emoji emoji-font", text: def.emoji }),
          h("div", { className: "name", text: def.name }),
          h("div", { className: "blurb", text: def.blurb }),
          !ok ? h("div", { className: "locked", text: needsStaff ? "従業員がいない" : gate.reason }) : null
        ]));
      });
      box.appendChild(grid);
      overlay.classList.add("show");
    }

    function backButton(onBack) {
      return h("div", { className: "modal-choices" }, [
        h("button", { className: "btn small", text: "戻る", onclick: onBack })
      ]);
    }

    function handlePick(def) {
      if (def.needsTarget === "staff") {
        if (state.staffHired.length === 1) { resolve(def, { staffId: state.staffHired[0] }); return; }
        renderStaffPicker(def);
        return;
      }
      if (def.needsTarget === "card") { renderCardPicker(def); return; }
      resolve(def, {});
    }

    function renderStaffPicker(def) {
      box.className = "modal-box dayoff-box";
      window.UI.clear(box);
      box.appendChild(h("h2", { text: def.name }));
      box.appendChild(h("p", { className: "dim", text: "誰に教える？" }));
      var grid = h("div", { className: "choice-grid wide" });
      state.staffHired.forEach(function (id) {
        var sd = U.findById(STAFF, id);
        if (!sd) return;
        grid.appendChild(h("div", {
          className: "choice-card",
          onclick: function () { resolve(def, { staffId: id }); }
        }, [
          h("div", { className: "emoji emoji-font", text: sd.emoji }),
          h("div", { className: "name", text: sd.name + "（" + sd.role + "）" })
        ]));
      });
      box.appendChild(grid);
      box.appendChild(backButton(renderGrid));
    }

    function renderCardPicker(def) {
      box.className = "modal-box dayoff-box";
      window.UI.clear(box);
      box.appendChild(h("h2", { text: def.name }));
      box.appendChild(h("p", { className: "dim", text: "誰に会う？" }));
      var grid = h("div", { className: "choice-grid" });
      CARDS.forEach(function (c) {
        var rel = state.relationships[c.id] || 0;
        grid.appendChild(h("div", {
          className: "choice-card",
          onclick: function () { resolve(def, { cardId: c.id }); }
        }, [
          h("div", { className: "emoji emoji-font", text: c.emoji }),
          h("div", { className: "name", text: c.name }),
          h("div", { className: "sub", text: "関係値 " + rel })
        ]));
      });
      box.appendChild(grid);
      box.appendChild(backButton(renderGrid));
    }

    function resolve(def, ctx) {
      var result = EE.resolveDayOffAction(state, def.id, ctx);
      window.GameState.save();
      renderResult(def, result);
    }

    // v10-1: イベントの結果表示(event-modal.jsのshowResult)と同じ形式で見せる。
    // 見出し(何をしたか) → 判定バッジ(大成功/成功/空振り、fixedアクションには出さない) →
    // 一言 → 差分、の順。空振りで差分が無い(=fatigueの変化以外に何も無かった)場合は
    // 「今週は何も掴めなかった」を明示する(何も出さずに次へ進めることはしない)。
    var TIER_LABEL = { great: "大成功", good: "成功", miss: "空振り" };
    function renderResult(def, result) {
      box.className = "modal-box dayoff-box";
      window.UI.clear(box);
      box.appendChild(h("h2", { text: def.name }));
      box.appendChild(h("div", { className: "result-choice", text: "▶ " + result.headline }));

      if (TIER_LABEL[result.tier]) {
        box.appendChild(h("div", { className: "tier-badge tier-" + result.tier, text: TIER_LABEL[result.tier] }));
      }

      box.appendChild(h("div", { className: "react-box" }, [
        h("div", { className: "react-line", text: result.text })
      ]));

      var deltaBox = h("div", { className: "delta-box" });
      if (result.tier === "miss") {
        deltaBox.appendChild(h("div", { className: "delta-none", text: "今週は何も掴めなかった" }));
      }
      (result.diffs || []).forEach(function (d) {
        deltaBox.appendChild(h("div", { className: "delta-row " + d.tone }, [
          h("span", { className: "delta-mark", text: d.tone === "good" ? "▲" : (d.tone === "bad" ? "▼" : "・") }),
          h("span", { text: d.text })
        ]));
      });
      box.appendChild(deltaBox);

      box.appendChild(h("div", { className: "modal-choices" }, [
        h("button", {
          className: "btn primary", text: "次の週へ",
          onclick: function () {
            overlay.classList.remove("show");
            maybeGuideComment(G);
            onDone();
          }
        })
      ]));
      overlay.classList.add("show");
    }

    renderGrid();
  }

  // 毎週喋らせない(3〜4週に1回程度)。だいたい30%。
  function maybeGuideComment(G) {
    if (Math.random() > 0.3) return;
    var lines = window.DATA.guide.dayoff;
    if (!lines || !lines.length) return;
    G.say(U.pick(lines));
  }

  return { show: show };
})();
