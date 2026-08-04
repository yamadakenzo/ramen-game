// 開業フェーズ: 資金調達 -> 物件 -> レシピ -> 設備 -> 従業員
window.ScreenSetup = (function () {
  var h = window.UI.h;
  var U = window.Utils;
  var SEGMENTS = window.DATA.segments.segments;
  var RECIPES = window.DATA.recipes;
  var PROPERTY_DATA = window.DATA.property;
  var STAFF = window.DATA.characters.staff;

  var STEP_NAMES = ["資金調達", "物件", "レシピ", "設備", "従業員"];
  var state, onDone;

  function budgetAtPropertyStep() {
    var funding = U.findById(PROPERTY_DATA.funding, state.funding);
    return funding ? funding.amount : 0;
  }
  function budgetAtEquipmentStep() {
    var b = budgetAtPropertyStep();
    var prop = U.findById(PROPERTY_DATA.properties, state.property);
    if (prop) b -= prop.initial_cost;
    return b;
  }
  function spentOnEquipment() {
    var total = 0;
    state.equipment.forEach(function (id) {
      var eq = U.findById(PROPERTY_DATA.equipment, id);
      if (eq) total += eq.cost;
    });
    return total;
  }
  function remainingBudget() {
    return budgetAtEquipmentStep() - spentOnEquipment();
  }

  function previewState() {
    // 未選択のスロットにはデフォルトを仮当てして常にプレビューできるようにする
    return {
      property: state.property,
      recipe: {
        soup: state.recipe.soup || "chicken",
        tare: state.recipe.tare || "shoyu",
        noodle: state.recipe.noodle || "medium",
        topping: state.recipe.topping || "chashu_thin"
      },
      equipment: state.equipment,
      staffHired: state.staffHired,
      price: state.price
    };
  }

  function renderPreview() {
    var ps = previewState();
    var prop = U.findById(PROPERTY_DATA.properties, ps.property);
    var wrap = h("div", { className: "pixel-panel" }, [
      window.StatusPanel.renderRamen(ps),
      h("h3", { text: "この組み合わせで刺さる客層" }),
      h("div", { className: "segment-preview", id: "segment-preview-list" })
    ]);
    var list = wrap.querySelector("#segment-preview-list");
    SEGMENTS.forEach(function (seg) {
      var meets = window.Scoring.meetsRequires(seg, ps);
      var sat = 0;
      if (meets) {
        try { sat = window.Scoring.computeSatisfaction(seg, ps).value; } catch (e) { sat = 0; }
      }
      var flow = prop && prop.segment_flow[seg.id] != null ? prop.segment_flow[seg.id] : 0.5;
      var lit = meets && sat >= 55 && flow >= 0.6;
      var pct = U.clamp(sat, 0, 100);
      var chip = h("div", { className: "segment-chip" + (lit ? " lit" : "") + (!meets ? " blocked" : "") }, [
        h("span", { text: seg.emoji }),
        h("div", {}, [
          h("div", { text: seg.name }),
          h("div", { className: "bar" }, [
            h("div", { className: "bar-fill", style: { width: pct + "%" } })
          ])
        ])
      ]);
      chip.title = !meets ? (seg.name + ": 必要設備が無いため来店ゼロ") : (seg.name + ": 満足度目安 " + Math.round(sat));
      list.appendChild(chip);
    });
    return wrap;
  }

  function renderStepBar() {
    var bar = h("div", { className: "setup-steps" });
    STEP_NAMES.forEach(function (name, i) {
      var cls = "step" + (i === state.setupStep ? " active" : "") + (i < state.setupStep ? " done" : "");
      bar.appendChild(h("div", { className: cls, text: (i + 1) + ". " + name, onclick: function () {
        // 完了済みのステップへは自由に戻れる
        if (i <= state.setupStep) { state.setupStep = i; draw(); }
      } }));
    });
    return bar;
  }

  function stepFunding() {
    var grid = h("div", { className: "choice-grid" });
    PROPERTY_DATA.funding.forEach(function (f) {
      var selected = state.funding === f.id;
      grid.appendChild(h("div", {
        className: "choice-card" + (selected ? " selected" : ""),
        onclick: function () { state.funding = f.id; draw(); }
      }, [
        h("div", { className: "name", text: f.name }),
        h("div", { className: "cost", text: U.formatMoney(f.amount) }),
        h("div", { className: "sub", text: f.monthly_repay > 0 ? ("月々返済 " + U.formatMoney(f.monthly_repay) + " × " + f.months + "ヶ月") : "返済不要" }),
        h("div", { className: "sub", text: f.note })
      ]));
    });
    return h("div", {}, [
      h("h2", { text: "1. 資金調達" }),
      h("p", { className: "dim", text: "開業資金をどう用意するか。返済の重さが後々効いてくる。" }),
      grid
    ]);
  }

  function stepProperty() {
    var budget = budgetAtPropertyStep();
    var grid = h("div", { className: "choice-grid" });
    PROPERTY_DATA.properties.forEach(function (p) {
      var afford = p.initial_cost <= budget;
      var selected = state.property === p.id;
      var card = h("div", {
        className: "choice-card" + (selected ? " selected" : "") + (!afford ? " disabled" : ""),
        onclick: function () { if (afford) { state.property = p.id; draw(); } }
      }, [
        h("div", { className: "emoji", text: p.emoji }),
        h("div", { className: "name", text: p.name }),
        h("div", { className: "cost", text: U.formatMoney(p.initial_cost) + (afford ? "" : "(資金不足)") }),
        h("div", { className: "sub", text: "家賃 " + U.formatMoney(p.rent) + "/月 ・ カウンター" + p.seats_counter + "席" + (p.seats_table ? " ・ テーブル" + p.seats_table + "席" : "") }),
        h("div", { className: "sub", text: p.desc })
      ]);
      grid.appendChild(card);
    });
    return h("div", {}, [
      h("h2", { text: "2. 物件" }),
      h("p", { className: "dim", text: "資金: " + U.formatMoney(budget) + "（手が届かない物件も並べて表示している）" }),
      grid
    ]);
  }

  function stepRecipe() {
    var box = h("div", {});
    box.appendChild(h("h2", { text: "3. 初期レシピ" }));
    box.appendChild(h("p", { className: "dim", text: "スープ・タレ・麺・トッピングを各1つ選ぶ。" }));
    var cats = [["soup", "スープ"], ["tare", "タレ"], ["noodle", "麺"], ["topping", "トッピング"]];
    cats.forEach(function (c) {
      var key = c[0], label = c[1];
      box.appendChild(h("h3", { text: label }));
      var grid = h("div", { className: "choice-grid" });
      RECIPES[key].filter(function (item) { return item.unlock === "start"; }).forEach(function (item) {
        var selected = state.recipe[key] === item.id;
        grid.appendChild(h("div", {
          className: "choice-card" + (selected ? " selected" : ""),
          onclick: function () { state.recipe[key] = item.id; draw(); }
        }, [
          h("div", { className: "emoji", text: item.emoji }),
          h("div", { className: "name", text: item.name }),
          h("div", { className: "cost", text: "原価 " + item.cost + "円" }),
          item.smell != null ? h("div", { className: "sub", text: "匂い " + item.smell }) : null
        ]));
      });
      box.appendChild(grid);
    });
    return box;
  }

  function stepEquipment() {
    var budget = budgetAtEquipmentStep();
    var remain = remainingBudget();
    var grid = h("div", { className: "choice-grid" });
    PROPERTY_DATA.equipment.forEach(function (eq) {
      var selected = state.equipment.indexOf(eq.id) >= 0;
      var afford = selected || eq.cost <= remain;
      grid.appendChild(h("div", {
        className: "choice-card" + (selected ? " selected" : "") + (!afford ? " disabled" : ""),
        onclick: function () {
          if (selected) {
            state.equipment = state.equipment.filter(function (id) { return id !== eq.id; });
          } else if (afford) {
            state.equipment.push(eq.id);
          }
          draw();
        }
      }, [
        h("div", { className: "emoji", text: eq.emoji }),
        h("div", { className: "name", text: eq.name }),
        h("div", { className: "cost", text: U.formatMoney(eq.cost) }),
        h("div", { className: "sub", text: eq.effect }),
        eq.penalty ? h("div", { className: "sub bad", text: eq.penalty }) : null
      ]));
    });
    return h("div", {}, [
      h("h2", { text: "4. 初期設備" }),
      h("p", { className: "dim", text: "残り資金: " + U.formatMoney(remain) + " / 開業資金 " + U.formatMoney(budget) }),
      grid
    ]);
  }

  function stepStaff() {
    var grid = h("div", { className: "choice-grid" });
    STAFF.forEach(function (s) {
      var selected = state.staffHired.indexOf(s.id) >= 0;
      var full = state.staffHired.length >= 2 && !selected;
      grid.appendChild(h("div", {
        className: "choice-card" + (selected ? " selected" : "") + (full ? " disabled" : ""),
        onclick: function () {
          if (selected) {
            state.staffHired = state.staffHired.filter(function (id) { return id !== s.id; });
          } else if (!full) {
            state.staffHired.push(s.id);
          }
          draw();
        }
      }, [
        h("div", { className: "emoji" }, [s.emoji, " ", window.StatusPanel.rankBadge(window.Scoring.staffRating(s).rank)]),
        h("div", { className: "name", text: s.name + "（" + s.role + "）" }),
        h("div", { className: "cost", text: U.formatMoney(s.wage) + "/月" }),
        window.StatusPanel.staffStats(s),
        h("div", { className: "sub", text: s.personality }),
        h("div", { className: "sub", text: s.traits.join(" / ") })
      ]));
    });
    return h("div", {}, [
      h("h2", { text: "5. 従業員" }),
      h("p", { className: "dim", text: "1〜2人雇用する（給与が月々かかる）。現在 " + state.staffHired.length + "人選択中。" }),
      grid
    ]);
  }

  function canProceed() {
    switch (state.setupStep) {
      case 0: return !!state.funding;
      case 1: return !!state.property;
      case 2: return state.recipe.soup && state.recipe.tare && state.recipe.noodle && state.recipe.topping;
      case 3: return true;
      case 4: return state.staffHired.length >= 1;
      default: return true;
    }
  }

  function commitAndStart() {
    state.money = remainingBudget();
    var funding = U.findById(PROPERTY_DATA.funding, state.funding);
    state.loan = { monthlyRepay: funding.monthly_repay, monthsLeft: funding.months };
    state.staffHired.forEach(function (id) {
      window.EventEngine.ensureStaffState(state, id);
    });
    if (state.staffHired.indexOf("yuta") >= 0) state.flags.yutaHireWeek = 1;
    window.EventEngine.initRun(state);
    window.GameState.save();
    onDone();
  }

  var stepRenderers = [stepFunding, stepProperty, stepRecipe, stepEquipment, stepStaff];

  function draw() {
    var root = document.getElementById("screen-setup");
    window.UI.clear(root);
    root.appendChild(renderStepBar());
    root.appendChild(stepRenderers[state.setupStep]());
    if (state.setupStep >= 2) root.appendChild(renderPreview());

    var footer = h("div", { className: "setup-footer" }, [
      h("button", {
        className: "btn", text: "戻る", disabled: state.setupStep === 0 ? "disabled" : null,
        onclick: function () { if (state.setupStep > 0) { state.setupStep--; draw(); } }
      }),
      state.setupStep < 4
        ? h("button", { className: "btn primary", text: "次へ", disabled: canProceed() ? null : "disabled",
            onclick: function () { state.setupStep++; draw(); } })
        : h("button", { className: "btn primary", text: "開業する！", disabled: canProceed() ? null : "disabled",
            onclick: commitAndStart })
    ]);
    root.appendChild(footer);
  }

  function render(gameState, doneCb) {
    state = gameState;
    onDone = doneCb;
    draw();
  }

  return { render: render };
})();
