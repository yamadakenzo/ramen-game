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
  // v10-2-2: 「営業時間」を物件の次に追加(何時に開けるかは、場所を決めた直後に決める操業判断という位置づけ)。
  var STEPS = [
    { id: "funding",  kind: "funding" },
    { id: "property", kind: "property" },
    { id: "hours",    kind: "hours" },
    { id: "soup",     kind: "recipe", cat: "soup" },
    { id: "tare",     kind: "recipe", cat: "tare" },
    { id: "noodle",   kind: "recipe", cat: "noodle" },
    { id: "topping",  kind: "recipe", cat: "topping" },
    { id: "equip",    kind: "equipment" },
    { id: "staff",    kind: "staff" }
  ];
  var PREVIEW_FROM = 3; // スープ以降は客層プレビューを出す

  var state, onDone;
  var reactLine = null; // 選んだ直後の案内役の反応。ステップを移ると消す

  // ---------- 予算 ----------
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
  function stepFunding() {
    var grid = h("div", { className: "choice-grid" });
    PROPERTY_DATA.funding.forEach(function (f) {
      grid.appendChild(card({
        // v14-0: 「👪」はNoto Emojiにグリフが無く単色化できない。ZWJ結合の家族絵文字(👨‍👩‍👧等)も
        // 構成要素(👨👩👧)は個別にあるのに結合済みリガチャがフォントに無く、結合全体がまるごと
        // カラーへ落ちることが分かった。さらに🧒(中性の「子供」)は単体でもNoto Emoji側の色付き
        // グリフしか無く単色化できないため避けた(👦も同様。👧は単色版がある)。
        // 客層「家族連れ」と同じ、単色化を確認済みの🧑👧(ZWJで繋がない2文字並び)に差し替えた。
        emoji: f.id === "family_loan" ? "🧑👧" : (f.id === "self_only" ? "🐖" : "🏦"),
        name: f.name,
        blurb: G.blurb(f.id),
        selected: state.funding === f.id,
        detail: detailLines([
          "調達額 " + U.formatMoney(f.amount),
          f.monthly_repay > 0 ? ("月々返済 " + U.formatMoney(f.monthly_repay) + " × " + f.months + "ヶ月") : "返済不要",
          f.note
        ]),
        onpick: function () { pick(f.id, function () { state.funding = f.id; }); }
      }));
    });
    return grid;
  }

  function stepProperty() {
    var budget = budgetAtPropertyStep();
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
    return grid;
  }

  // ---------- v10-2-2: 営業時間帯(複数選択・最低1つ) ----------
  // その帯にどの客層が来るか(segments.jsのpeak_hoursから逆引き)。週末のみの客層には印を付ける。
  function segmentsForBand(bandKey) {
    var out = [];
    SEGMENTS.forEach(function (seg) {
      (seg.peak_hours || []).forEach(function (ph) {
        var band = ph, weekendOnly = false;
        if (ph === "weekend_lunch") { band = "lunch"; weekendOnly = true; }
        else if (ph === "weekend_dinner") { band = "dinner"; weekendOnly = true; }
        if (band === bandKey) out.push({ seg: seg, weekendOnly: weekendOnly });
      });
    });
    return out;
  }

  function stepHours() {
    var wrap = h("div", {});
    wrap.appendChild(h("div", { className: "setup-hint", text: "最低1つは開けておく。長く開けるほど客は増えるが、原価・人件費・疲労もかさむ。" }));
    var grid = h("div", { className: "choice-grid" });
    window.BANDS.forEach(function (b) {
      var selected = state.businessHours.indexOf(b.key) >= 0;
      var onlyOne = selected && state.businessHours.length === 1;
      var segs = segmentsForBand(b.key);
      grid.appendChild(h("div", {
        className: "choice-card" + (selected ? " selected" : "") + (onlyOne ? " disabled" : ""),
        onclick: function () {
          if (onlyOne) return;
          if (selected) {
            state.businessHours = state.businessHours.filter(function (k) { return k !== b.key; });
            reactLine = G.unpick("hours");
          } else {
            state.businessHours.push(b.key);
            reactLine = G.react(b.key);
          }
          draw();
        }
      }, [
        h("div", { className: "emoji emoji-font", text: U.bandEmoji(b.key) }),
        h("div", { className: "name", text: b.label + "（" + U.bandTimeLabel(b) + "）" }),
        h("div", { className: "blurb", text: G.blurb(b.key) }),
        h("div", { className: "hours-seg-row" }, segs.map(function (x) {
          return h("span", {
            className: "hours-seg-chip emoji-font" + (x.weekendOnly ? " weekend" : ""),
            title: x.seg.name + (x.weekendOnly ? "（週末のみ）" : "")
          }, [x.seg.emoji]);
        })),
        onlyOne ? h("div", { className: "locked", text: "最低1つは開けておく" }) : null
      ]));
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function stepRecipe(cat) {
    var grid = h("div", { className: "choice-grid" });
    RECIPES[cat].filter(function (item) { return item.unlock === "start"; }).forEach(function (item) {
      grid.appendChild(card({
        emoji: item.emoji,
        name: item.name,
        blurb: G.blurb(item.id),
        selected: state.recipe[cat] === item.id,
        detail: detailLines([
          "コク " + signed(item.richness) + " ・ 脂 " + signed(item.oiliness) + " ・ 量 " + signed(item.volume),
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
        detail: detailLines([
          U.formatMoney(eq.cost),
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
      var full = state.staffHired.length >= 2 && !selected;
      grid.appendChild(card({
        emoji: s.emoji,
        name: s.name + "（" + s.role + "）",
        blurb: G.blurb(s.id),
        selected: selected,
        disabled: full,
        locked: full ? "これ以上は雇えません" : null,
        detail: detailLines([
          "給与 " + U.formatMoney(s.wage) + " / 月",
          h("div", { style: { margin: "4px 0" } }, [
            window.StatusPanel.rankBadge(window.Scoring.staffRating(s).rank),
            h("span", { text: " 総合 " + window.Scoring.staffRating(s).avg })
          ]),
          window.StatusPanel.staffStats(s),
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
      case "funding": return !!state.funding;
      case "property": return !!state.property;
      case "hours": return state.businessHours.length >= 1;
      case "recipe": return !!state.recipe[step.cat];
      case "equipment": return true;
      case "staff": return state.staffHired.length >= 1;
      default: return true;
    }
  }

  function body() {
    var step = STEPS[state.setupStep];
    if (step.kind === "funding") return stepFunding();
    if (step.kind === "property") return stepProperty();
    if (step.kind === "hours") return stepHours();
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
    state.money = remainingBudget();
    var funding = U.findById(PROPERTY_DATA.funding, state.funding);
    state.loan = { monthlyRepay: funding.monthly_repay, monthsLeft: funding.months };
    state.staffHired.forEach(function (id) { window.EventEngine.ensureStaffState(state, id); });
    if (state.staffHired.indexOf("yuta") >= 0) state.flags.yutaHireWeek = 1;
    window.EventEngine.initRun(state);
    // v10-2: 開業時点でbusinessHoursActiveをbusinessHoursと同じにして1週目から反映させる
    // (「変更は翌週から」はプレイ中に変えた場合の話で、開業そのものはまだどの週も始まっていないため)。
    state.businessHoursActive = state.businessHours.slice();
    var sorted = window.BANDS.filter(function (b) { return state.businessHoursActive.indexOf(b.key) >= 0; });
    state.clockMin = sorted.length ? sorted[0].start * 60 : 11 * 60;
    window.GameState.save();
    onDone();
  }

  function draw() {
    var root = document.getElementById("screen-setup");
    window.UI.clear(root);
    var step = STEPS[state.setupStep];
    var last = state.setupStep === STEPS.length - 1;

    root.appendChild(G.bar(reactLine || G.ask(step.id), !!reactLine));
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
