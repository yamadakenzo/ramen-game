// 結果画面(1年の区切り)
// v46(docs/指示書/v46_無期限化_指示書.md §3-2、設計判断記録 §65): 52週で**ゲームが終わる**画面から、
// **年の区切りで1枚挟む**画面になった。中身(年間収支・客層別グラフ・キャッチコピー・従業員・
// 人カード・図鑑・イベント密度)は作り直していない。変えたのは3つだけ:
//   1. 「N周目のプレイ」→「N年目」
//   2. 集計を**その年のぶんだけ**に絞る(state.history が年をまたいで積み上がり続けるため)
//   3. 「もう一度プレイする」(clearSave+reload)→「続ける」(セーブを消さずに翌年の第1週へ)
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

  // v46: この画面が出している数字は全部「その年のぶん」。history は年をまたいで積み上がり続けるので、
  // 絞らないと2年目に1年目が丸ごと混ざる。**旧セーブのレコードには year が無いので必ず (rec.year || 1)**。
  function yearRecords(state, year) {
    return state.history.filter(function (rec) { return (rec.year || 1) === year; });
  }

  function totalsBySegment(records) {
    var totals = {};
    SEGMENTS.forEach(function (s) { totals[s.id] = 0; });
    records.forEach(function (rec) {
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
  // v46: recordRunEnd() を呼ばなくなったので newlyAdded は常に空。図鑑の枠は残してある
  // (次版の「店を畳む」でまた埋まる)。onContinue は「続ける」で呼ぶ(js/main.js)。
  function render(state, newlyAdded, onContinue) {
    var screen = document.getElementById("screen-result");
    window.UI.clear(screen);
    // 固定枠の中に収める。スクロールしてよいのはこの中だけ。
    var root = h("div", { className: "scroll-area result-body" });
    screen.appendChild(root);

    // v46: どの年の結果か。state.resultYear は js/main.js が年の区切りで書く。
    // 旧セーブ(v45 以前に52週を終えて phase="result" のまま保存されたもの)には無いので、
    // そのときは day から逆算する(旧実装は day を 365 まで進めてから止めていた = 1年目)。
    var year = state.resultYear || Math.max(1, U.yearOfRun(state.day) - 1);
    var records = yearRecords(state, year);

    var totalRevenue = 0, totalFoodCost = 0, totalFixed = 0, totalProfit = 0;
    records.forEach(function (rec) {
      totalRevenue += rec.revenue;
      totalFoodCost += rec.foodCost;
      totalFixed += rec.fixedCosts; // v23(§E): monthlyCosts→fixedCostsにリネーム(rec.js/screens/loop.js参照)
      totalProfit += rec.profit;
    });
    var totals = totalsBySegment(records);
    var maxCount = Math.max.apply(null, SEGMENTS.map(function (s) { return totals[s.id] || 0; }).concat([1]));

    // STEP12(§5): 周回数を既存のタイトル枠に添えていた場所。新しい画面は作らない。
    // v46: 周回(MetaState.lastRunNumber())ではなく**何年目か**を出す。周回はもう動かないため。
    // 見出しは当初 h1「1年が経った」+ 添え字「N年目」の2段だったが、2年目以降で
    // 「1年が経った / 2年目」と並んで**「いま2年目に入る」とも読めて**しまうため、
    // 承認時に**見出し1行に畳んだ**。「1年目が終わった」「3年目が終わった」のどちらも自然に読める。
    root.appendChild(h("div", { className: "pixel-panel result-title" }, [
      h("h1", { text: year + "年目が終わった" }),
      h("div", { className: "catch", text: "「" + catchphrase(totals) + "」" })
    ]));

    var financePanel = h("div", { className: "pixel-panel" }, [
      h("h2", { text: "年間収支" }),
      h("p", {}, ["年間売上: ", h("span", { className: "money", text: U.formatMoney(totalRevenue) })]),
      h("p", {}, ["原価合計: ", h("span", { text: U.formatMoney(totalFoodCost) })]),
      h("p", {}, ["家賃・人件費: ", h("span", { text: U.formatMoney(totalFixed) })]),
      h("p", {}, ["営業利益: ", h("span", { className: totalProfit >= 0 ? "good" : "bad", text: U.formatMoney(totalProfit) })]),
      h("p", {}, ["納税額: ", h("span", { text: U.formatMoney(state.flags.lastTax || 0) })]),
      h("p", {}, ["最終所持金: ", h("span", { className: "money", text: U.formatMoney(state.money) })])
    ]);
    root.appendChild(financePanel);

    var chartPanel = h("div", { className: "pixel-panel" });
    chartPanel.appendChild(h("h2", { text: "客層別 年間来店数" }));
    var chart = h("div", { className: "bar-chart" });
    SEGMENTS.forEach(function (seg) {
      var count = totals[seg.id] || 0;
      var pct = Math.round((count / maxCount) * 100);
      chart.appendChild(h("div", { className: "bar-chart-row" }, [
        h("div", { className: "label emoji-font" }, [window.AssetImage.node(seg), " " + seg.name]),
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
        window.AssetImage.node(def),
        " " + def.name + "（" + def.role + "）　士気: " + Math.round(s.morale) + "　関係値: " + Math.round(s.rel)
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
        h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(c)]),
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
            h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(item)]),
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
    // v46: eventLog も年をまたいで積み上がるので、この画面が出す件数はその年のぶんだけに絞る。
    var yearEvents = state.eventLog.filter(function (e) { return (e.year || 1) === year; });
    densityPanel.appendChild(h("p", { className: "dim", text: "合計 " + yearEvents.length + " 件発生。詳細はブラウザのコンソールに出力済み。" }));
    root.appendChild(densityPanel);

    // v46(§3-2): 「もう一度プレイする」(clearSave+reset+reload)を「続ける」に置き換えた。
    // **セーブは消さない。** 押すと翌年の第1週から営業ループへ戻る(state.day は既に進めてある)。
    // この画面から「最初からやり直す」経路は無くした。やり直したいときはメニューの
    // 「ゲームスタート」→「はじめから」から(確認が1枚挟まる、v45 §3-5)。
    root.appendChild(h("div", { style: { textAlign: "center", marginTop: "8px" } }, [
      h("button", {
        className: "btn primary result-continue", text: (year + 1) + "年目へ",
        onclick: function () { if (onContinue) onContinue(); }
      })
    ]));
  }

  return { render: render };
})();
