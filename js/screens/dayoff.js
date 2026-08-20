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
  var AD_METHODS = window.DATA.actions.adMethods; // STEP10

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
          h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(def)]),
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
      if (def.needsTarget === "adMethod") { renderAdMethodPicker(def); return; }
      if (def.needsTarget === "scout") {
        // STEP6 §4: 上限に達していたら候補すら出さず、その旨を見せてアクションだけ消費する。
        if (state.staffHired.length >= window.MAX_STAFF) { resolve(def, { scoutResult: "full" }); return; }
        renderScoutPicker(def);
        return;
      }
      resolve(def, {});
    }

    function renderStaffPicker(def) {
      box.className = "modal-box dayoff-box";
      window.UI.clear(box);
      box.appendChild(h("h2", { text: def.name }));
      box.appendChild(h("p", { className: "dim", text: "誰に教える？" }));
      var grid = h("div", { className: "choice-grid wide" });
      state.staffHired.forEach(function (id) {
        var sd = window.Scoring.findStaffDef(state, id); // STEP6: スカウト勢も対象に含める
        if (!sd) return;
        grid.appendChild(h("div", {
          className: "choice-card",
          onclick: function () { resolve(def, { staffId: id }); }
        }, [
          h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(sd)]),
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
          h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(c)]),
          h("div", { className: "name", text: c.name }),
          h("div", { className: "sub", text: "関係値 " + rel })
        ]));
      });
      box.appendChild(grid);
      box.appendChild(backButton(renderGrid));
    }

    // STEP10(docs/新設計/10_STEP10_広告_認知度_評判_修正版.md §4): 宣伝の手段を3つから選ばせる。
    // 費用が払えない手段(チラシ・広告出稿)はグレーアウトする(SNSは常に0円なので必ず選べる)。
    function renderAdMethodPicker(def) {
      box.className = "modal-box dayoff-box";
      window.UI.clear(box);
      box.appendChild(h("h2", { text: def.name }));
      box.appendChild(h("p", { className: "dim", text: "どの手段で宣伝する？" }));
      var grid = h("div", { className: "choice-grid wide" });
      AD_METHODS.forEach(function (m) {
        var affordable = state.money >= m.cost;
        grid.appendChild(h("div", {
          className: "choice-card" + (affordable ? "" : " disabled"),
          onclick: function () { if (affordable) resolve(def, { adMethod: m.id }); }
        }, [
          h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(m)]),
          h("div", { className: "name", text: m.name }),
          h("div", { className: "blurb", text: m.blurb }),
          h("div", { className: "sub", text: m.cost > 0 ? "費用 " + U.formatMoney(m.cost) : "費用 なし" }),
          !affordable ? h("div", { className: "locked", text: "お金が足りない" }) : null
        ]));
      });
      box.appendChild(grid);
      box.appendChild(backButton(renderGrid));
    }

    // STEP6(docs/新設計/06_STEP6_従業員スカウト_修正版.md §2〜3): 求人を出すと候補が3人出る。
    // 1人だけ雇うか、全員見送るか。候補はこの画面を開いた瞬間に1回だけ生成し(再描画で変わらない)、
    // 見送った候補は次週に持ち越さない(このピッカーを閉じたら候補データごと消える)。
    function renderScoutPicker(def) {
      var candidates = EE.generateScoutCandidates(state);
      box.className = "modal-box dayoff-box";
      window.UI.clear(box);
      box.appendChild(h("h2", { text: def.name }));
      box.appendChild(h("p", { className: "dim", text: "3人が応募してきた。1人だけ雇うか、見送るか。" }));
      var grid = h("div", { className: "choice-grid wide" });
      candidates.forEach(function (c) {
        var affordable = state.money >= c.hiringFee; // v23: 雇用時に引かれるのは週給ではなく紹介料(§D)
        var statBox = h("div", { className: "stat-grid" });
        [["cooking", "調理"], ["speed", "速度"], ["service", "接客"], ["development", "開発"]].forEach(function (p) {
          statBox.appendChild(h("span", { className: "stat-name", text: p[1] }));
          statBox.appendChild(h("div", { className: "mini-track" }, [
            h("div", { className: "mini-fill", style: { width: (c.newStats[p[0]] * 10) + "%" } })
          ]));
          statBox.appendChild(h("span", { className: "stat-num", text: String(c.newStats[p[0]]) }));
        });
        grid.appendChild(h("div", {
          className: "choice-card" + (affordable ? "" : " disabled"),
          onclick: function () {
            if (!affordable) return;
            resolve(def, { scoutResult: "hired", candidate: c });
          }
        }, [
          h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(c)]),
          h("div", { className: "name", text: c.name }),
          h("div", { className: "sub", text: "伸びしろ " + c.potential + " ・ 給与 " + U.formatMoney(c.wage) + "/週" +
            " ・ 紹介料 " + U.formatMoney(c.hiringFee) }),
          statBox,
          !affordable ? h("div", { className: "locked", text: "紹介料が足りない" }) : null
        ]));
      });
      box.appendChild(grid);
      box.appendChild(h("div", { className: "modal-choices" }, [
        h("button", { className: "btn small", text: "全員見送る", onclick: function () { resolve(def, { scoutResult: "skip" }); } })
      ]));
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
        // v31 §3-2(Q4): d.iconがあれば(素材の差分など)先頭に絵/絵文字を出す。
        deltaBox.appendChild(h("div", { className: "delta-row " + d.tone }, [
          h("span", { className: "delta-mark", text: d.tone === "good" ? "▲" : (d.tone === "bad" ? "▼" : "・") }),
          d.icon ? h("span", { className: "delta-icon emoji-font" }, [window.AssetImage.node(d.icon)]) : null,
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
