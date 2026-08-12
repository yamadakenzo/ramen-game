// 開業フェーズ（v05）: 1画面1問の会話にする。
// 案内役が喋る -> 選択肢のカードが出る -> 選ぶ -> 案内役が一言反応する -> 次へ。
// カードには数値を出さない（「詳しく見る」を押したときだけ出す）。
window.ScreenSetup = (function () {
  var h = window.UI.h;
  var U = window.Utils;
  var SEGMENTS = window.DATA.segments.segments;
  var RECIPES = window.DATA.recipes;
  var PROPERTY_DATA = window.DATA.property;
  var STAFF = window.DATA.characters.staff;
  var G = window.Guide;

  // 1画面1問。レシピは4つに割って、それぞれ独立した問いにする。
  // v17(docs/新設計/v17_ラーメン屋_修正指示書.md §1-5/§2-4): 「営業時間」「資金調達」の
  // 2ステップを削除した(営業時間は常に11:00〜23:00の通し営業に固定。開業資金は固定額の
  // 自己資金のみになり、選ばせる概念自体を無くした)。9ステップ→7ステップ。
  var STEPS = [
    { id: "property", kind: "property" },
    { id: "soup",     kind: "recipe", cat: "soup" },
    { id: "tare",     kind: "recipe", cat: "tare" },
    { id: "noodle",   kind: "recipe", cat: "noodle" },
    { id: "topping",  kind: "recipe", cat: "topping" },
    { id: "equip",    kind: "equipment" },
    { id: "staff",    kind: "staff" }
  ];
  var PREVIEW_FROM = 1; // スープ以降は客層プレビューを出す

  var state, onDone;
  var reactLine = null; // 選んだ直後の案内役の反応。ステップを移ると消す

  // ---------- 予算 ----------
  // v17(§2-2): 開業資金は固定額(PROPERTY_DATA.startingCapital)のみ。資金調達の選択は無くなった。
  function budgetAtPropertyStep() {
    return PROPERTY_DATA.startingCapital;
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
  function remainingBudget() { return budgetAtEquipmentStep() - spentOnEquipment(); }

  // ---------- カード ----------
  function signed(v) { return (v > 0 ? "+" : "") + v; }

  // 4-3: カードに出すのは 名前・絵文字・一言 だけ。数値は detail 側に閉じ込める。
  function card(opts) {
    var el = h("div", {
      className: "choice-card" + (opts.selected ? " selected" : "") + (opts.disabled ? " disabled" : ""),
      onclick: function (e) {
        if (e.target.classList.contains("detail-btn")) return;
        if (opts.disabled) return;
        opts.onpick();
      }
    }, [
      h("div", { className: "emoji emoji-font", text: opts.emoji }),
      h("div", { className: "name", text: opts.name }),
      h("div", { className: "blurb", text: opts.blurb }),
      opts.locked ? h("div", { className: "locked", text: opts.locked }) : null,
      h("button", {
        className: "detail-btn", text: "詳しく見る",
        onclick: function (e) { e.stopPropagation(); el.classList.toggle("show-detail"); }
      }),
      h("div", { className: "card-detail" }, opts.detail)
    ]);
    return el;
  }

  function detailLines(lines) {
    return lines.filter(function (t) { return !!t; }).map(function (t) {
      return typeof t === "string" ? h("div", { text: t }) : t;
    });
  }

  // ---------- 各ステップ ----------
  function stepProperty() {
    var budget = budgetAtPropertyStep();
    var wrap = h("div", {});
    // v17(§2-4): 資金調達の選択肢が無くなったので、代わりに手持ちの自己資金を冒頭に表示する
    // (以前は選んだ資金調達額が分かっていたので、その情報が消えないようにする)。
    wrap.appendChild(h("div", { className: "setup-hint" }, [
      "手持ちの自己資金：", h("span", { className: "money", text: U.formatMoney(budget) })
    ]));
    var grid = h("div", { className: "choice-grid" });
    PROPERTY_DATA.properties.forEach(function (p) {
      var afford = p.initial_cost <= budget;
      grid.appendChild(card({
        emoji: p.emoji,
        name: p.name,
        blurb: G.blurb(p.id),
        selected: state.property === p.id,
        disabled: !afford,
        locked: afford ? null : "今の資金では手が届きません",
        detail: detailLines([
          "初期費用 " + U.formatMoney(p.initial_cost),
          "家賃 " + U.formatMoney(p.rent) + " / 月",
          "カウンター" + p.seats_counter + "席" + (p.seats_table ? " ・ テーブル" + p.seats_table + "席" : ""),
          p.desc
        ].concat(p.traits)),
        onpick: function () { pick(p.id, function () { state.property = p.id; }); }
      }));
    });
    wrap.appendChild(grid);
    return wrap;
  }

  // STEP2(docs/新設計/02_STEP2_素材カード基本システム_修正版.md §2): 未所持の素材も隠さず表示し、
  // 選べない状態にする(薄く表示+「未所持」ラベル。どちらも既存のchoice-card.disabled/.lockedを流用)。
  function stepRecipe(cat) {
    var grid = h("div", { className: "choice-grid" });
    RECIPES[cat].filter(function (item) { return item.unlock === "start"; }).forEach(function (item) {
      var owned = window.Scoring.isMaterialOwned(state, cat, item.id);
      grid.appendChild(card({
        emoji: item.emoji,
        name: item.name,
        blurb: G.blurb(item.id),
        selected: state.recipe[cat] === item.id,
        disabled: !owned,
        locked: !owned ? "未所持" : null,
        // STEP4(docs/新設計/04_STEP4_ラーメン新パラメータとレシピ計算_修正版.md §6): 「コク・脂・量」の
        // 3項表示を「品質・濃さ・量・個性」の4項表示に差し替えた。
        detail: detailLines([
          "品質 " + signed(item.quality) + " ・ 濃さ " + signed(item.richness) + " ・ 量 " + signed(item.volume) + " ・ 個性 " + signed(item.uniqueness),
          "原価 " + item.cost + "円",
          item.smell != null ? "匂い " + item.smell : null
        ]),
        onpick: function () { pick(item.id, function () { state.recipe[cat] = item.id; }); }
      }));
    });
    return grid;
  }

  function stepEquipment() {
    var wrap = h("div", {});
    wrap.appendChild(h("div", { className: "setup-hint" }, [
      "使えるお金：", h("span", { className: "money", text: U.formatMoney(remainingBudget()) })
    ]));
    var grid = h("div", { className: "choice-grid" });
    PROPERTY_DATA.equipment.forEach(function (eq) {
      var selected = state.equipment.indexOf(eq.id) >= 0;
      var afford = selected || eq.cost <= remainingBudget();
      grid.appendChild(card({
        emoji: eq.emoji,
        name: eq.name,
        blurb: G.blurb(eq.id),
        selected: selected,
        disabled: !afford,
        locked: afford ? null : "今の資金では手が届きません",
        // STEP7(docs/新設計/07_STEP7_設備_修正版.md §4): 購入前に週維持費が見えるようにする。
        detail: detailLines([
          "購入 " + U.formatMoney(eq.cost) + (eq.weekly_upkeep ? " / 週 " + U.formatMoney(eq.weekly_upkeep) : " / 週維持費なし"),
          eq.effect,
          eq.penalty ? "代償: " + eq.penalty : null,
          eq.note
        ]),
        onpick: function () {
          if (selected) {
            state.equipment = state.equipment.filter(function (id) { return id !== eq.id; });
            reactLine = G.unpick("equip");
            draw();
          } else {
            pick(eq.id, function () { state.equipment.push(eq.id); });
          }
        }
      }));
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function stepStaff() {
    var wrap = h("div", {});
    wrap.appendChild(h("div", { className: "setup-hint", text: "1〜2人まで。給与は毎月かかります。" }));
    var grid = h("div", { className: "choice-grid wide" });
    STAFF.forEach(function (s) {
      var selected = state.staffHired.indexOf(s.id) >= 0;
      var full = state.staffHired.length >= window.MAX_STAFF && !selected; // STEP6: 定数化(js/utils.js)。値は変えていない
      grid.appendChild(card({
        emoji: s.emoji,
        name: s.name + "（" + s.role + "）",
        blurb: G.blurb(s.id),
        selected: selected,
        disabled: full,
        locked: full ? "これ以上は雇えません" : null,
        // STEP5(docs/新設計/05_STEP5_従業員能力と育成_修正版.md §1): 雇用前プレビューにも
        // 新4能力(調理/速度/接客/開発)と最大Lvを表示する。雇用前なのでLv1・ボーナス無しの基礎値のみ。
        detail: detailLines([
          "給与 " + U.formatMoney(s.wage) + " / 月",
          h("div", { style: { margin: "4px 0" } }, [
            window.StatusPanel.rankBadge(window.Scoring.staffRating(s).rank),
            h("span", { text: " 総合 " + window.Scoring.staffRating(s).avg })
          ]),
          window.StatusPanel.staffStats(s),
          window.StatusPanel.newStaffStats(s),
          s.maxLevel != null ? ("最大Lv " + s.maxLevel) : null,
          s.personality + " / " + s.traits.join(" / ")
        ]),
        onpick: function () {
          if (selected) {
            state.staffHired = state.staffHired.filter(function (id) { return id !== s.id; });
            reactLine = G.unpick("staff");
            draw();
          } else {
            pick(s.id, function () { state.staffHired.push(s.id); });
          }
        }
      }));
    });
    wrap.appendChild(grid);
    return wrap;
  }

  // ---------- 4-5: 客層プレビュー ----------
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
      price: state.price,
      flags: {}
    };
  }

  function renderPreview() {
    var ps = previewState();
    var prop = U.findById(PROPERTY_DATA.properties, ps.property);
    var r = window.Scoring.ramenScore(ps);
    var wrap = h("div", { className: "setup-preview" }, [
      h("div", { className: "preview-head" }, [
        h("span", { className: "emoji-font", text: "🍜 いまの完成度" }),
        window.StatusPanel.rankBadge(r.rank),
        h("span", { className: "money", text: String(r.score) }),
        h("span", { className: "dim", text: "／ 刺さる客層" })
      ]),
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
      var chip = h("div", { className: "segment-chip" + (lit ? " lit" : "") + (!meets ? " blocked" : "") }, [
        h("span", { className: "emoji-font", text: seg.emoji }),
        h("div", {}, [
          h("div", { text: seg.name }),
          h("div", { className: "bar" }, [
            h("div", { className: "bar-fill", style: { width: U.clamp(sat, 0, 100) + "%" } })
          ])
        ])
      ]);
      chip.title = !meets ? (seg.name + ": 必要設備が無いため来店ゼロ") : (seg.name + ": 満足度目安 " + Math.round(sat));
      list.appendChild(chip);
    });
    return wrap;
  }

  // ---------- 進行 ----------
  function pick(itemId, apply) {
    apply();
    reactLine = G.react(itemId); // 4-4: 選んだことに反応を返してから次へ
    draw();
  }

  function canProceed() {
    var step = STEPS[state.setupStep];
    switch (step.kind) {
      case "property": return !!state.property;
      case "recipe": return !!state.recipe[step.cat];
      case "equipment": return true;
      case "staff": return state.staffHired.length >= 1;
      default: return true;
    }
  }

  function body() {
    var step = STEPS[state.setupStep];
    if (step.kind === "property") return stepProperty();
    if (step.kind === "recipe") return stepRecipe(step.cat);
    if (step.kind === "equipment") return stepEquipment();
    return stepStaff();
  }

  function stepDots() {
    var bar = h("div", { className: "step-dots" });
    STEPS.forEach(function (s, i) {
      bar.appendChild(h("div", {
        className: "dot" + (i === state.setupStep ? " active" : (i < state.setupStep ? " done" : ""))
      }));
    });
    return bar;
  }

  function go(delta) {
    state.setupStep = U.clamp(state.setupStep + delta, 0, STEPS.length - 1);
    reactLine = null;
    draw();
  }

  function commitAndStart() {
    // v17(§2-3): 借り入れ・返済の概念を撤去した。開業資金は固定額の自己資金のみ(state.loanは廃止)。
    state.money = remainingBudget();
    state.staffHired.forEach(function (id) { window.EventEngine.ensureStaffState(state, id); });
    if (state.staffHired.indexOf("yuta") >= 0) state.flags.yutaHireWeek = 1;
    window.EventEngine.initRun(state);
    // v17(docs/新設計/v17_ラーメン屋_修正指示書.md §1-6): 営業時間は11:00〜23:00の通し営業に
    // 固定されたので、開業時点の時計は常にBANDSの先頭(11:00)から始まる。
    state.clockMin = window.BANDS[0].start * 60;
    window.GameState.save();
    onDone();
  }

  function draw() {
    var root = document.getElementById("screen-setup");
    window.UI.clear(root);
    var step = STEPS[state.setupStep];
    var last = state.setupStep === STEPS.length - 1;

    root.appendChild(G.bar(reactLine || G.ask(step.id), !!reactLine));
    // STEP12(docs/新設計/12_STEP12_周回引き継ぎ_修正版.md §5): 周回数を既存のパネルに追加する。
    // 新しい画面は作らない(開業準備の間ずっと見えている、この帯に添えるだけ)。
    if (window.MetaState) {
      root.appendChild(h("div", { className: "dim", style: { textAlign: "center", fontSize: "12px" }, text: window.MetaState.currentRunNumber() + "周目" }));
    }
    root.appendChild(stepDots());

    var scroll = h("div", { className: "scroll-area setup-body" }, [body()]);
    root.appendChild(scroll);

    if (state.setupStep >= PREVIEW_FROM) root.appendChild(renderPreview());

    root.appendChild(h("div", { className: "setup-footer" }, [
      h("button", {
        className: "btn small", text: "戻る",
        disabled: state.setupStep === 0 ? "disabled" : null,
        onclick: function () { go(-1); }
      }),
      last
        ? h("button", { className: "btn primary", text: "開業する！", disabled: canProceed() ? null : "disabled", onclick: commitAndStart })
        : h("button", { className: "btn primary", text: "次へ", disabled: canProceed() ? null : "disabled", onclick: function () { go(1); } })
    ]));
  }

  function render(gameState, doneCb) {
    state = gameState;
    onDone = doneCb;
    if (state.setupStep >= STEPS.length) state.setupStep = STEPS.length - 1;
    reactLine = null;
    draw();
  }

  return { render: render };
})();
