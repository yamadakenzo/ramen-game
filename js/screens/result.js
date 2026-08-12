// 結果画面(1年後)
window.ScreenResult = (function () {
  var h = window.UI.h;
  var U = window.Utils;
  var SEGMENTS = window.DATA.segments.segments;
  var STAFF = window.DATA.characters.staff;
  var CARDS = window.DATA.characters.cards;

  var CATCHPHRASE = {
    salaryman: "サラリーマンの胃袋を掴んだ回転型",
    ol: "OLに愛された、清潔で静かな店",
    student: "学生街の腹ペコを支えた大盛り食堂",
    family: "家族の週末を彩ったテーブル席の店",
    tourist: "観光客が写真に撮った、二度と来ない店",
    regular: "常連に愛された小さな店"
  };

  function totalsBySegment(state) {
    var totals = {};
    SEGMENTS.forEach(function (s) { totals[s.id] = 0; });
    state.history.forEach(function (rec) {
      Object.keys(rec.customers || {}).forEach(function (id) {
        totals[id] = (totals[id] || 0) + rec.customers[id];
      });
    });
    return totals;
  }

  function catchphrase(totals) {
    var sorted = SEGMENTS.map(function (s) { return { id: s.id, count: totals[s.id] || 0 }; })
      .sort(function (a, b) { return b.count - a.count; });
    if (sorted[0].count === 0) return "誰の心にも刺さらなかった店";
    return CATCHPHRASE[sorted[0].id] || "つかみどころのない店";
  }

  // STEP12(docs/新設計/12_STEP12_周回引き継ぎ_修正版.md §9): newlyAddedはjs/main.jsが
  // window.MetaState.recordRunEnd(state)から受け取ってそのまま渡してくる({cat,id}の配列)。
  function render(state, newlyAdded) {
    var screen = document.getElementById("screen-result");
    window.UI.clear(screen);
    // 固定枠の中に収める。スクロールしてよいのはこの中だけ。
    var root = h("div", { className: "scroll-area result-body" });
    screen.appendChild(root);

    var totalRevenue = 0, totalFoodCost = 0, totalFixed = 0, totalProfit = 0;
    state.history.forEach(function (rec) {
      totalRevenue += rec.revenue;
      totalFoodCost += rec.foodCost;
      totalFixed += rec.monthlyCosts;
      totalProfit += rec.profit;
    });
    var loanBalance = state.loan.monthsLeft * state.loan.monthlyRepay;
    var totals = totalsBySegment(state);
    var maxCount = Math.max.apply(null, SEGMENTS.map(function (s) { return totals[s.id] || 0; }).concat([1]));

    // STEP12(§5): 周回数(何周目のプレイだったか)を既存のタイトル枠に添える。新しい画面は作らない。
    // この画面に来る時点でMetaState.recordRunEnd()は呼ばれ済み(js/main.js)なので、
    // currentRunNumber()(次に始まる周回の番号)ではなくlastRunNumber()(今終わった周回の番号)を使う。
    var runNumber = window.MetaState ? window.MetaState.lastRunNumber() : 1;
    root.appendChild(h("div", { className: "pixel-panel result-title" }, [
      h("h1", { text: "1年が経った" }),
      h("div", { className: "dim", text: runNumber + "周目のプレイ" }),
      h("div", { className: "catch", text: "「" + catchphrase(totals) + "」" })
    ]));

    var financePanel = h("div", { className: "pixel-panel" }, [
      h("h2", { text: "年間収支" }),
      h("p", {}, ["年間売上: ", h("span", { className: "money", text: U.formatMoney(totalRevenue) })]),
      h("p", {}, ["原価合計: ", h("span", { text: U.formatMoney(totalFoodCost) })]),
      h("p", {}, ["家賃・人件費・返済: ", h("span", { text: U.formatMoney(totalFixed) })]),
      h("p", {}, ["営業利益: ", h("span", { className: totalProfit >= 0 ? "good" : "bad", text: U.formatMoney(totalProfit) })]),
      h("p", {}, ["納税額: ", h("span", { text: U.formatMoney(state.flags.lastTax || 0) })]),
      h("p", {}, ["最終所持金: ", h("span", { className: "money", text: U.formatMoney(state.money) })]),
      h("p", {}, ["借入残高: ", h("span", { text: U.formatMoney(loanBalance) })])
    ]);
    root.appendChild(financePanel);

    var chartPanel = h("div", { className: "pixel-panel" });
    chartPanel.appendChild(h("h2", { text: "客層別 年間来店数" }));
    var chart = h("div", { className: "bar-chart" });
    SEGMENTS.forEach(function (seg) {
      var count = totals[seg.id] || 0;
      var pct = Math.round((count / maxCount) * 100);
      chart.appendChild(h("div", { className: "bar-chart-row" }, [
        h("div", { className: "label emoji-font", text: seg.emoji + " " + seg.name }),
        h("div", { className: "track" }, [h("div", { className: "fill", style: { width: pct + "%" } })]),
        h("div", { className: "val", text: count + "人" })
      ]));
    });
    chartPanel.appendChild(chart);
    root.appendChild(chartPanel);

    var staffPanel = h("div", { className: "pixel-panel" });
    staffPanel.appendChild(h("h2", { text: "従業員の状態" }));
    if (state.staffHired.length === 0) {
      staffPanel.appendChild(h("p", { className: "dim", text: "従業員なしで乗り切った。" }));
    }
    state.staffHired.forEach(function (id) {
      var def = window.Scoring.findStaffDef(state, id); // STEP6: スカウト勢も対象に含める
      var s = window.EventEngine.ensureStaffState(state, id);
      staffPanel.appendChild(h("p", { className: "emoji-font" }, [
        def.emoji + " " + def.name + "（" + def.role + "）　士気: " + Math.round(s.morale) + "　関係値: " + Math.round(s.rel)
      ]));
    });
    root.appendChild(staffPanel);

    var cardPanel = h("div", { className: "pixel-panel" });
    cardPanel.appendChild(h("h2", { text: "人カード" }));
    var cardBox = h("div", { className: "card-collection" });
    CARDS.forEach(function (c) {
      var rel = state.relationships[c.id] || 0;
      var unlocked = !!state.cardsUnlocked[c.id];
      cardBox.appendChild(h("div", { className: "card-item" }, [
        h("div", { className: "emoji emoji-font", text: c.emoji }),
        h("div", { text: c.name }),
        h("div", { className: "dim", text: "関係値 " + Math.round(rel) + (unlocked ? " ・ 解放済" : "") })
      ]));
    });
    cardPanel.appendChild(cardBox);
    root.appendChild(cardPanel);

    // STEP12(§3): 図鑑の収集状況(何種類中、何種類集めたか)と、今回新しく載ったカード。
    // 引き継ぎ自体(js/meta-state.js)は既に main.js 側でこの画面に入る直前に済ませてある。
    if (window.MetaState) {
      var RECIPES = window.DATA.recipes;
      var stats = window.MetaState.compendiumStats();
      var compendiumPanel = h("div", { className: "pixel-panel" });
      compendiumPanel.appendChild(h("h2", { text: "素材図鑑" }));
      compendiumPanel.appendChild(h("p", {}, ["収集状況: ", h("span", { text: stats.collected + " / " + stats.total + " 種" })]));
      if (newlyAdded && newlyAdded.length) {
        var newBox = h("div", { className: "card-collection" });
        newlyAdded.forEach(function (n) {
          var item = U.findById(RECIPES[n.cat], n.id);
          if (!item) return;
          newBox.appendChild(h("div", { className: "card-item" }, [
            h("div", { className: "emoji emoji-font", text: item.emoji }),
            h("div", { text: item.name })
          ]));
        });
        compendiumPanel.appendChild(h("p", { className: "dim", text: "今回新しく図鑑に載った素材:" }));
        compendiumPanel.appendChild(newBox);
      } else {
        compendiumPanel.appendChild(h("p", { className: "dim", text: "今回新しく図鑑に載った素材はなかった。" }));
      }
      root.appendChild(compendiumPanel);
    }

    var densityPanel = h("div", { className: "pixel-panel" });
    densityPanel.appendChild(h("h2", { text: "イベント密度ログ（開発確認用）" }));
    densityPanel.appendChild(h("p", { className: "dim", text: "合計 " + state.eventLog.length + " 件発生。詳細はブラウザのコンソールに出力済み。" }));
    root.appendChild(densityPanel);

    root.appendChild(h("div", { style: { textAlign: "center", marginTop: "8px" } }, [
      h("button", {
        className: "btn primary", text: "もう一度プレイする",
        onclick: function () {
          window.GameState.clearSave();
          window.GameState.reset();
          location.reload();
        }
      })
    ]));
  }

  return { render: render };
})();
