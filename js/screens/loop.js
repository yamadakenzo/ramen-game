// 営業ループ本体（v05）
//  - 店の絵を固定枠いっぱいに広げ、その上に情報とボタンを重ねる
//  - パネルは下半分だけ。上半分の店は見えたまま残す（レシピを変えた瞬間の客の反応が同じ画面で見える）
//  - 週の終わりに一拍止めて、起きたことを1行の言葉にする
window.ScreenLoop = (function () {
  var h = window.UI.h;
  var U = window.Utils;
  var Scoring = window.Scoring;
  var EE = window.EventEngine;
  var G = window.Guide;
  var SEGMENTS = window.DATA.segments.segments;
  var RECIPES = window.DATA.recipes;
  var PROPERTY_DATA = window.DATA.property;
  var STAFF = window.DATA.characters.staff;
  var CARDS = window.DATA.characters.cards;

  var state, onGameOver;
  var tickTimer = null;
  var flashTimer = null;
  var TALK_COST = 1200;
  var TALK_GAIN = 8;
  // 満足/不満の分け目。この値以上を「満足して帰った客」として数える
  var SATISFIED_LINE = 55;
  // 直近の週次計算結果。設備変更などで店の絵を組み直すときに再利用する。
  var lastFinance = null, lastCustomers = null;
  var openSheetKey = null, sheetBuilder = null;

  function findStaffDef(id) { return U.findById(STAFF, id); }

  // 2-1: ×1 の実速度を v02 の 1/3（1100ms -> 3300ms）に落とす
  function speedToMs(speed) {
    if (speed === 0) return null;
    return { 1: 3300, 2: 1650, 4: 825 }[speed];
  }
  // 2-2: 週の終わりの「一拍」。×1 で 0.5 秒、速度倍率に連動して短縮する
  function beatMs() { return state.speed > 0 ? 500 / state.speed : 0; }

  function clearTick() { if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; } }

  function scheduleTick(extraMs) {
    clearTick();
    if (!state.running) return;
    var ms = speedToMs(state.speed);
    if (!ms) return;
    tickTimer = setTimeout(processWeek, ms + (extraMs || 0));
  }

  function setSpeed(n) {
    state.speed = n;
    window.ShopView.syncSpeed();
    if (n === 0) hideFlash();
    if (state.eventModalActive) { renderTopBar(); return; } // モーダル表示中は再開しない
    state.running = n > 0;
    renderTopBar();
    renderSpeedDock();
    if (n > 0) scheduleTick(); else clearTick();
  }

  function monthlyCostBreakdown() {
    var property = Scoring.getProperty(state);
    var rent = Math.round(property.rent * (state.rentMultiplier || 1));
    var wages = 0;
    state.staffHired.forEach(function (id) {
      var s = EE.ensureStaffState(state, id);
      var def = findStaffDef(id);
      wages += Math.round(def.wage * (s.wageMult || 1));
    });
    var loanPay = state.loan.monthsLeft > 0 ? state.loan.monthlyRepay : 0;
    return { rent: rent, wages: wages, loanPay: loanPay, total: rent + wages + loanPay };
  }

  // ---------- 週の進行 ----------
  function processWeek() {
    if (state.week > 52) { finishGame(); return; }
    if (state.eventModalActive) return; // モーダル応答待ちの間は絶対に進めない

    var prev = state.history.length ? state.history[state.history.length - 1] : null;
    var repBefore = state.reputation;
    var moneyBefore = state.money;

    var customers = Scoring.computeWeeklyCustomers(state);
    var finance = Scoring.computeWeeklyFinance(state, customers);
    var avgSat = Scoring.weightedAvgSatisfaction(customers);
    state.lastAvgSatisfaction = avgSat;

    var monthlyCosts = 0;
    var chargedBreakdown = { rent: 0, wages: 0, loanPay: 0 }; // 月次まとめ用に、実際に引き落とされた内訳を週次ログへ残す
    if (U.isFirstWeekOfMonth(state.week)) {
      chargedBreakdown = monthlyCostBreakdown();
      monthlyCosts = chargedBreakdown.total;
      state.money -= monthlyCosts;
      if (state.loan.monthsLeft > 0) state.loan.monthsLeft--;
    }

    state.money += finance.revenue - finance.foodCost;
    var profit = finance.revenue - finance.foodCost - monthlyCosts;

    state.reputation = U.clamp(state.reputation + (avgSat - 50) * 0.04, 0, 100);
    EE.tickTempBoosts(state);
    if (state.flags.recipeLockWeeksLeft > 0) state.flags.recipeLockWeeksLeft--;

    var weekStats = { avgSatisfaction: avgSat, satisfactionBySeg: {}, queueLevel: customers.queueLevel };
    Object.keys(customers.results).forEach(function (id) { weekStats.satisfactionBySeg[id] = customers.results[id].satisfaction; });

    state.history.push({
      week: state.week, month: U.weekToMonth(state.week), customers: finance.bySegment,
      totalCustomers: finance.totalCustomers, revenue: Math.round(finance.revenue), foodCost: Math.round(finance.foodCost),
      monthlyCosts: monthlyCosts, rentCost: chargedBreakdown.rent, wageCost: chargedBreakdown.wages, loanCost: chargedBreakdown.loanPay,
      profit: Math.round(profit), money: Math.round(state.money),
      avgSatisfaction: Math.round(avgSat), queueLevel: customers.queueLevel
    });

    // 一週限りの効果をリセット
    state.flags.weekRevenueMult = null;
    state.flags.weekSatisfactionHit = null;
    state.flags.forceQueueSpike = false;

    EE.checkCardUnlocks(state).forEach(function (u) { window.UI.toast(u.text, 3200); });

    renderAll(finance, customers);
    showWeekFlash(finance, customers);
    emitFloats(prev, finance, state.reputation - repBefore, state.money - moneyBefore);

    var guideLine = G.checkAuto(state, { profit: profit, queueLevel: customers.queueLevel });
    if (guideLine) G.say(guideLine);

    var finishedWeek = state.week;
    var wasRunning = state.running;

    var events = EE.checkWeeklyEvents(state, weekStats);
    if (events.length > 0) {
      state.pendingEvents = events;
      state.running = false;
      state.eventModalActive = true;
      clearTick();
      closeSheet();      // イベントは全画面で覆うので、開いているパネルは畳む
      hideFlash();
      window.ScreenEventModal.showQueue(state, events, function () {
        state.eventModalActive = false;
        afterWeekResolved(finishedWeek, wasRunning);
      });
      return;
    }

    afterWeekResolved(finishedWeek, wasRunning);
  }

  // イベント(あれば)の解決後、月末なら月次まとめを挟んでから次の週へ進む
  function afterWeekResolved(finishedWeek, wasRunning) {
    if (finishedWeek === U.monthEndWeek(U.weekToMonth(finishedWeek))) {
      hideFlash();
      showMonthlyRecap(finishedWeek, function () { advanceWeek(wasRunning); });
      return;
    }
    advanceWeek(wasRunning, beatMs());
  }

  function advanceWeek(wasRunning, extraMs) {
    state.week++;
    window.GameState.save();
    if (state.week > 52) { finishGame(); return; }
    renderTopBar();
    refreshShop();
    if (wasRunning && state.speed > 0) { state.running = true; scheduleTick(extraMs); }
  }

  // ---------- 2-2: 月末にまとめを出す ----------
  function monthAggregate(monthNum) {
    var agg = { revenue: 0, foodCost: 0, rent: 0, wages: 0, loan: 0, profit: 0, customers: 0 };
    state.history.forEach(function (rec) {
      if (rec.month !== monthNum) return;
      agg.revenue += rec.revenue; agg.foodCost += rec.foodCost;
      agg.rent += rec.rentCost || 0; agg.wages += rec.wageCost || 0; agg.loan += rec.loanCost || 0;
      agg.profit += rec.profit; agg.customers += rec.totalCustomers;
    });
    return agg;
  }

  function recapRow(label, valueText, diff, diffFmt) {
    var row = h("div", { className: "recap-row" }, [
      h("span", { className: "recap-label", text: label }),
      h("span", { text: valueText })
    ]);
    if (diff != null) {
      row.appendChild(h("span", {
        className: "recap-diff " + (diff >= 0 ? "good" : "bad"),
        text: "前月比 " + (diff >= 0 ? "+" : "") + diffFmt(diff)
      }));
    }
    return row;
  }

  function showMonthlyRecap(week, onDone) {
    var month = U.weekToMonth(week);
    var cur = monthAggregate(month);
    var prev = month > 1 ? monthAggregate(month - 1) : null;
    var fmtCount = function (v) { return Math.round(v) + "人"; };

    var overlay = document.getElementById("event-modal-overlay");
    var box = document.getElementById("event-modal-box");
    box.className = "modal-box month-recap";
    window.UI.clear(box);
    box.appendChild(h("h2", { text: month + "月のまとめ" }));

    var table = h("div", { className: "recap-table" }, [
      recapRow("客数", fmtCount(cur.customers), prev ? cur.customers - prev.customers : null, fmtCount),
      recapRow("売上", U.formatMoney(cur.revenue), prev ? cur.revenue - prev.revenue : null, U.formatMoney),
      recapRow("仕入", "−" + U.formatMoney(cur.foodCost), prev ? -(cur.foodCost - prev.foodCost) : null, U.formatMoney),
      recapRow("人件費", "−" + U.formatMoney(cur.wages), prev ? -(cur.wages - prev.wages) : null, U.formatMoney),
      recapRow("家賃", "−" + U.formatMoney(cur.rent), prev ? -(cur.rent - prev.rent) : null, U.formatMoney),
      recapRow("返済", "−" + U.formatMoney(cur.loan), prev ? -(cur.loan - prev.loan) : null, U.formatMoney)
    ]);
    var totalRow = recapRow("この月の損益", (cur.profit >= 0 ? "+" : "") + U.formatMoney(cur.profit),
      prev ? cur.profit - prev.profit : null, U.formatMoney);
    totalRow.className = "recap-row recap-total";
    totalRow.querySelector("span:nth-child(2)").classList.add(cur.profit >= 0 ? "good" : "bad"); // 赤字は赤で
    table.appendChild(totalRow);
    box.appendChild(table);

    box.appendChild(h("div", { className: "modal-choices" }, [
      h("button", {
        className: "btn primary", text: "続ける",
        onclick: function () { overlay.classList.remove("show"); onDone(); }
      })
    ]));
    overlay.classList.add("show");
  }

  function finishGame() {
    clearTick();
    hideFlash();
    closeSheet();
    G.hide();
    window.ShopView.destroy();
    state.running = false;
    console.log("=== イベント密度ログ ===");
    console.table(state.eventLog);
    onGameOver();
  }

  // ---------- 2-2: 週の結果表示(1行版 / 詳細版) ----------
  function satSplit(finance, customers) {
    var good = 0, bad = 0;
    Object.keys(finance.bySegment).forEach(function (id) {
      var n = finance.bySegment[id];
      if (!n) return;
      var s = customers.results[id] ? customers.results[id].satisfaction : null;
      if (s != null && s >= SATISFIED_LINE) good += n; else bad += n;
    });
    return { good: good, bad: bad };
  }

  function isDetailedFlash() { return state.flags.weekFlashDetailed !== false; } // 初期状態は詳細版
  var lastFlashData = null; // トグルボタンで表示を切り替えるとき、直近の週データを再利用する

  function hideFlash() {
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    var el = document.getElementById("week-flash");
    if (el) el.classList.remove("show");
  }

  function moneyRow(label, val, opts) {
    opts = opts || {};
    var cls = "wf-row" + (opts.tone === "bad" ? " wf-bad" : (opts.tone === "good" ? " wf-good" : ""));
    return h("div", { className: cls }, [
      h("span", { className: "wf-label", text: label }),
      h("span", { className: "wf-val", text: (opts.sign && val >= 0 ? "+" : "") + U.formatMoney(val) + (opts.suffix || "") })
    ]);
  }

  function renderWeekFlash() {
    var el = document.getElementById("week-flash");
    if (!el || !lastFlashData) return;
    var d = lastFlashData;
    window.UI.clear(el);
    el.className = "week-flash show" + (isDetailedFlash() ? " detailed" : " compact");

    if (!isDetailedFlash()) {
      el.appendChild(h("span", {
        text: "今週：客" + d.totalCustomers + "人 / 満足" + d.satGood + "・不満" + d.satBad +
          " / 売上 " + U.formatMoney(d.revenue)
      }));
      el.appendChild(h("button", { className: "wf-toggle", text: "詳細", style: { marginLeft: "8px" }, onclick: toggleFlashMode }));
      return;
    }

    el.appendChild(h("div", { className: "wf-head" }, [
      h("div", {}, [
        h("div", { className: "wf-title", text: "第" + d.week + "週" }),
        h("div", { className: "wf-sub", text: "客 " + d.totalCustomers + "人（満足" + d.satGood + " / 不満" + d.satBad + "）" })
      ]),
      h("button", { className: "wf-toggle", text: "1行に", onclick: toggleFlashMode })
    ]));
    var table = h("div", { className: "wf-table" }, [
      moneyRow("売上", d.revenue),
      moneyRow("仕入", -d.foodCost, { tone: "bad", suffix: "（原価率 " + d.foodCostPct + "%）" }),
      moneyRow("人件費", -d.wageShare, { tone: "bad" }),
      moneyRow("家賃", -d.rentShare, { tone: "bad" }),
      moneyRow("返済", -d.loanShare, { tone: "bad" }),
      h("div", { className: "wf-divider" }),
      moneyRow("残り", d.net, { sign: true })
    ]);
    table.lastChild.className = "wf-row wf-net";
    table.lastChild.querySelector(".wf-val").classList.add(d.net >= 0 ? "good" : "bad");
    el.appendChild(table);
    el.appendChild(h("div", { className: "wf-note", text: "人件費・家賃・返済は月額を週割りした概算。実際の引き落としは月初にまとめて。" }));
  }

  function toggleFlashMode() {
    state.flags.weekFlashDetailed = !isDetailedFlash();
    window.GameState.save();
    renderWeekFlash();
    // 詳細版は読むのに時間がかかるので、切り替えたらタイマーを仕切り直す
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(hideFlash, flashDurationMs());
  }

  function flashDurationMs() {
    var base = (speedToMs(state.speed) || 1200) + beatMs();
    return isDetailedFlash() ? Math.max(1800, base) : base;
  }

  function showWeekFlash(finance, customers) {
    var el = document.getElementById("week-flash");
    if (!el) return;
    if (state.speed === 0) { el.classList.remove("show"); return; } // 「停止」中は出さない
    var s = satSplit(finance, customers);
    var mc = monthlyCostBreakdown(); // 表示用に月額を毎週割り出す(実際の引き落としは月初のみ)
    var revenue = finance.revenue;
    lastFlashData = {
      week: state.week,
      totalCustomers: finance.totalCustomers,
      satGood: s.good, satBad: s.bad,
      revenue: revenue, foodCost: finance.foodCost,
      foodCostPct: revenue > 0 ? Math.round((finance.foodCost / revenue) * 100) : 0,
      wageShare: mc.wages / 4.333, rentShare: mc.rent / 4.333, loanShare: mc.loanPay / 4.333,
      net: revenue - finance.foodCost - mc.total / 4.333
    };
    renderWeekFlash();
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(hideFlash, flashDurationMs());
  }

  // ---------- 2-3: 変化した瞬間に絵の上へ浮かせる ----------
  function floatUp(text, cls, x, y, delay) {
    var layer = document.getElementById("float-layer");
    if (!layer) return;
    setTimeout(function () {
      if (!document.getElementById("float-layer")) return;
      var el = h("div", { className: "float-item " + cls, text: text, style: { left: x + "%", top: y + "%" } });
      layer.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1800);
    }, delay || 0);
  }

  function emitFloats(prev, finance, repDelta, moneyDelta) {
    if (state.speed === 0) return;
    var d = 0;
    if (prev) {
      var dc = finance.totalCustomers - prev.totalCustomers;
      if (Math.abs(dc) >= 1) {
        floatUp((dc > 0 ? "+" : "") + dc + "人", dc > 0 ? "good" : "bad", 30, 46, d); d += 200;
      }
    }
    if (Math.abs(repDelta) >= 0.4) {
      floatUp("評判 " + (repDelta > 0 ? "↑" : "↓"), repDelta > 0 ? "good" : "bad", 52, 40, d); d += 200;
    }
    if (Math.abs(moneyDelta) >= 10000) {
      floatUp((moneyDelta > 0 ? "+" : "-") + U.formatMoneyShort(Math.abs(moneyDelta)),
        moneyDelta > 0 ? "money" : "bad", 70, 50, d);
    }
  }

  // ---------- 描画 ----------
  function renderTopBar() {
    var root = document.getElementById("top-bar");
    if (!root) return;
    window.UI.clear(root);
    var wk = Math.min(state.week, 52);
    var month = U.weekToMonth(wk);
    var queued = lastCustomers && lastCustomers.queueLevel > 0.1;

    function item(label, value, cls) {
      return h("div", { className: "ti" }, [
        h("div", { className: "tl", text: label }),
        h("div", { className: "tv" + (cls ? " " + cls : ""), text: value })
      ]);
    }
    root.appendChild(item("日付", month + "月 " + U.weekOfMonth(wk) + "週目"));
    root.appendChild(item("所持金", U.formatMoneyShort(state.money), "money"));
    root.appendChild(item("今週の客", (lastFinance ? lastFinance.totalCustomers : 0) + "人"));
    root.appendChild(item("評判", String(Math.round(state.reputation))));
    if (queued) root.appendChild(h("div", { className: "ti queue-mark", text: "🚶行列" }));
  }

  function renderSpeedDock() {
    var dock = document.getElementById("speed-dock");
    if (!dock) return;
    window.UI.clear(dock);
    [[0, "■"], [1, "×1"], [2, "×2"], [4, "×4"]].forEach(function (pair) {
      dock.appendChild(h("button", {
        className: "btn small" + (state.speed === pair[0] ? " selected" : ""),
        text: pair[1],
        onclick: function () { setSpeed(pair[0]); }
      }));
    });
  }

  function refreshShop() { window.ShopView.update(state, lastFinance, lastCustomers); }

  function renderAll(finance, customers) {
    lastFinance = finance;
    lastCustomers = customers;
    renderTopBar();
    refreshShop();
    if (openSheetKey) refreshSheet(); // 開きっぱなしのパネルも週ごとに更新する
  }

  // ---------- 1-3: 下半分のパネル ----------
  // 意図的にゲームを止めない。レシピを変えた瞬間に上の店で客の反応が変わるのを見せるため。
  function openSheet(key, title, builder) {
    if (openSheetKey === key) { closeSheet(); return; }
    openSheetKey = key;
    sheetBuilder = builder;
    document.getElementById("sheet-title").textContent = title;
    document.getElementById("sheet").classList.add("open");
    document.getElementById("sheet-backdrop").classList.add("open");
    raiseControls(true);
    refreshSheet();
    renderFabs();
  }

  // 速度切替とパネル切替はパネルに隠させない
  function raiseControls(on) {
    ["speed-dock", "fab-col"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.toggle("raised", on);
    });
  }

  function refreshSheet() {
    var body = document.getElementById("sheet-body");
    if (!body || !sheetBuilder) return;
    var scrollTop = body.scrollTop;
    window.UI.clear(body);
    body.appendChild(sheetBuilder());
    body.scrollTop = scrollTop;
  }

  function closeSheet() {
    openSheetKey = null;
    sheetBuilder = null;
    var sheet = document.getElementById("sheet");
    if (sheet) sheet.classList.remove("open");
    var bd = document.getElementById("sheet-backdrop");
    if (bd) bd.classList.remove("open");
    raiseControls(false);
    renderFabs();
  }

  // ---------- パネルの中身 ----------
  function panelRecipe() {
    var box = h("div", {});
    if (state.flags.recipeLockWeeksLeft > 0) {
      box.appendChild(h("p", { className: "bad", text: "ゴンゾウとの約束で、あと" + state.flags.recipeLockWeeksLeft + "週はレシピを変更できない。" }));
    }
    var cats = [["soup", "スープ"], ["tare", "タレ"], ["noodle", "麺"], ["topping", "トッピング"]];
    cats.forEach(function (c) {
      var key = c[0];
      var sec = h("div", { className: "sheet-section" }, [h("h3", { text: c[1] })]);
      var grid = h("div", { className: "choice-grid" });
      RECIPES[key].filter(function (item) {
        if (item.unlock === "start") return true;
        if (item.unlock === "card_menya") return !!state.cardsUnlocked.menya;
        return false;
      }).forEach(function (item) {
        var selected = state.recipe[key] === item.id;
        var locked = state.flags.recipeLockWeeksLeft > 0;
        grid.appendChild(h("div", {
          className: "choice-card" + (selected ? " selected" : "") + (locked ? " disabled" : ""),
          onclick: function () {
            if (locked || selected) return;
            state.recipe[key] = item.id;
            state.recipeChangeLog.push(state.week);
            window.UI.toast(c[1] + "を" + item.name + "に変更した");
            refreshSheet();
          }
        }, [
          h("div", { className: "emoji", text: item.emoji }),
          h("div", { className: "name", text: item.name }),
          h("div", { className: "blurb", text: G.blurb(item.id) })
        ]));
      });
      sec.appendChild(grid);
      box.appendChild(sec);
    });
    return box;
  }

  // v06-3-4: 価格変更は専用パネルに独立させた(以前はレシピパネルの一番下にあり、
  // 4カテゴリぶんのカードをスクロールしないと辿り着けず気づかれにくかった)。
  // 変更した瞬間に「原価・粗利」と「客層ごとの予算との比較」をその場で見せる。
  function panelPrice() {
    var box = h("div", {});
    var agg = Scoring.recipeAggregate(state.recipe, state);
    var margin = state.price - agg.cost;

    var headSec = h("div", { className: "sheet-section status-card" });
    headSec.appendChild(h("div", { className: "score-head" }, [
      h("span", { className: "score-num", text: state.price + "円" }),
      h("span", { className: "score-max", text: "/ 杯" })
    ]));
    headSec.appendChild(h("div", { className: "dim", text: "原価 " + agg.cost + "円 ・ 粗利 " +
      (margin >= 0 ? "+" : "") + margin + "円/杯" }));
    var row = h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" } });
    [-100, -50, -10, 10, 50, 100].forEach(function (delta) {
      row.appendChild(h("button", {
        className: "btn small", text: (delta > 0 ? "+" : "") + delta + "円",
        onclick: function () {
          state.price = U.clamp(state.price + delta, 300, 3000);
          renderTopBar();
          refreshSheet();
        }
      }));
    });
    headSec.appendChild(row);
    box.appendChild(headSec);

    // 客層ごとの予算比較。価格を動かした瞬間にどの客層が苦しくなるかをその場で見せる。
    var segSec = h("div", { className: "sheet-section" }, [
      h("h3", { text: "客層ごとの予算" }),
      h("div", { className: "dim", text: "予算を超えるほど、その客層の満足度が下がる（来なくなるとは限らない）。" })
    ]);
    SEGMENTS.forEach(function (seg) {
      var blocked = !Scoring.meetsRequires(seg, state);
      var over = state.price - seg.budget;
      var pct = Math.round((over / seg.budget) * 100);
      var statusText, statusCls;
      if (blocked) {
        statusText = "設備不足で来店なし"; statusCls = "flat";
      } else if (over <= 0) {
        statusText = "余裕 ¥" + Math.abs(over); statusCls = "good";
      } else {
        statusText = "予算より +" + pct + "%（¥" + over + "オーバー）"; statusCls = "bad";
      }
      segSec.appendChild(h("div", { className: "staff-card" + (blocked ? "" : "") }, [
        h("div", { className: "staff-head" }, [
          h("span", { className: "staff-emoji", text: seg.emoji }),
          h("span", { className: "staff-name", text: seg.name }),
          h("span", { className: "dim", text: "予算 " + U.formatMoney(seg.budget) })
        ]),
        h("div", { className: "delta-row " + statusCls }, [
          h("span", { className: "delta-mark", text: statusCls === "good" ? "▲" : (statusCls === "bad" ? "▼" : "・") }),
          h("span", { text: statusText })
        ])
      ]));
    });
    box.appendChild(segSec);
    return box;
  }

  function panelEquipment() {
    var box = h("div", {});
    box.appendChild(h("p", {}, ["所持金: ", h("span", { className: "money", text: U.formatMoneyShort(state.money) })]));
    var grid = h("div", { className: "choice-grid" });
    PROPERTY_DATA.equipment.forEach(function (eq) {
      var owned = state.equipment.indexOf(eq.id) >= 0;
      var afford = state.money >= eq.cost;
      grid.appendChild(h("div", {
        className: "choice-card" + (owned ? " selected" : "") + (!owned && !afford ? " disabled" : ""),
        onclick: function () {
          if (owned || !afford) return;
          state.money -= eq.cost;
          state.equipment.push(eq.id);
          window.UI.toast(eq.name + "を導入した");
          refreshShop();  // 券売機やテーブル席は買った瞬間に絵へ出す
          renderTopBar();
          refreshSheet();
        }
      }, [
        h("div", { className: "emoji", text: eq.emoji }),
        h("div", { className: "name", text: eq.name + (owned ? "（導入済）" : "") }),
        h("div", { className: "cost", text: U.formatMoney(eq.cost) }),
        h("div", { className: "blurb", text: eq.effect })
      ]));
    });
    box.appendChild(grid);
    return box;
  }

  function panelPeople() {
    var box = h("div", {});

    // 4-1-2: 案内役はここからいつでも呼べる
    var guideSec = h("div", { className: "sheet-section" }, [
      h("div", { className: "staff-card" }, [
        h("div", { className: "staff-head" }, [
          h("span", { className: "staff-emoji", text: G.def().emoji }),
          h("span", { className: "staff-name", text: G.def().name }),
          h("span", { className: "dim", text: "（" + G.def().role + "）" })
        ]),
        h("button", {
          className: "btn small", text: "呼ぶ",
          onclick: function () { G.say(G.summary(state)); closeSheet(); }
        })
      ])
    ]);
    box.appendChild(guideSec);

    var staffSec = h("div", { className: "sheet-section" }, [h("h3", { text: "従業員" })]);
    state.staffHired.forEach(function (id) {
      var def = findStaffDef(id);
      if (!def) return;
      var block = window.StatusPanel.staffBlock(def, EE.ensureStaffState(state, id));
      var actions = h("div", { style: { display: "flex", gap: "6px", marginTop: "6px" } }, [
        h("button", {
          className: "btn small", text: "話す（" + TALK_COST + "円）",
          disabled: state.money < TALK_COST ? "disabled" : null,
          onclick: function () {
            if (state.money < TALK_COST) return;
            var s = EE.ensureStaffState(state, id);
            state.money -= TALK_COST;
            s.rel = U.clamp(s.rel + TALK_GAIN, 0, 100);
            s.morale = U.clamp(s.morale + 4, 0, 100);
            window.UI.toast(def.name + "と話した（関係値 " + s.rel + "）");
            renderTopBar();
            refreshSheet();
          }
        }),
        h("button", {
          className: "btn small", text: "辞めてもらう",
          onclick: function () {
            state.staffHired = state.staffHired.filter(function (x) { return x !== id; });
            window.UI.toast(def.name + "が店を離れた");
            refreshShop();
            refreshSheet();
          }
        })
      ]);
      block.appendChild(actions);
      staffSec.appendChild(block);
    });
    var hireable = STAFF.filter(function (d) { return state.staffHired.indexOf(d.id) < 0; });
    if (hireable.length) {
      staffSec.appendChild(h("h3", { text: "雇う" }));
      var grid = h("div", { className: "choice-grid wide" });
      hireable.forEach(function (def) {
        grid.appendChild(h("div", {
          className: "choice-card",
          onclick: function () {
            state.staffHired.push(def.id);
            EE.ensureStaffState(state, def.id);
            if (def.id === "yuta") state.flags.yutaHireWeek = state.week;
            window.UI.toast(def.name + "を雇用した");
            refreshShop();
            refreshSheet();
          }
        }, [
          h("div", { className: "emoji" }, [def.emoji, " ", window.StatusPanel.rankBadge(Scoring.staffRating(def).rank)]),
          h("div", { className: "name", text: def.name + "（" + def.role + "）" }),
          h("div", { className: "cost", text: U.formatMoney(def.wage) + "/月" }),
          window.StatusPanel.staffStats(def),
          h("div", { className: "blurb", text: G.blurb(def.id) })
        ]));
      });
      staffSec.appendChild(grid);
    }
    box.appendChild(staffSec);

    var cardSec = h("div", { className: "sheet-section" }, [
      h("h3", { text: "人カード" }),
      h("div", { className: "dim", text: "1回 " + TALK_COST + "円。関係値 +" + TALK_GAIN + "。" })
    ]);
    var cgrid = h("div", { className: "choice-grid" });
    CARDS.forEach(function (c) {
      var rel = state.relationships[c.id] || 0;
      cgrid.appendChild(h("div", {
        className: "choice-card" + (state.money < TALK_COST ? " disabled" : ""),
        onclick: function () {
          if (state.money < TALK_COST) return;
          state.money -= TALK_COST;
          state.relationships[c.id] = U.clamp(rel + TALK_GAIN, 0, 100);
          window.UI.toast(c.name + "と話した（関係値 " + state.relationships[c.id] + "）");
          renderTopBar();
          refreshSheet();
        }
      }, [
        h("div", { className: "emoji", text: c.emoji }),
        h("div", { className: "name", text: c.name }),
        h("div", { className: "sub", text: "関係値 " + rel })
      ]));
    });
    cardSec.appendChild(cgrid);
    box.appendChild(cardSec);
    return box;
  }

  function panelData() {
    var box = h("div", {});
    box.appendChild(h("div", { className: "sheet-section" }, [window.StatusPanel.renderRamen(state)]));

    var last = state.history.length ? state.history[state.history.length - 1] : null;
    var num = h("div", { className: "sheet-section status-card" }, [h("h3", { text: "📊 直近の週" })]);
    if (!last) {
      num.appendChild(h("p", { className: "dim", text: "まだ1週目が終わっていない。" }));
    } else {
      num.appendChild(h("p", {}, ["客数 ", h("span", { text: last.totalCustomers + "人" }),
        "　満足度 ", h("span", { text: String(last.avgSatisfaction) })]));
      num.appendChild(h("p", {}, ["売上 ", h("span", { className: "money", text: U.formatMoney(last.revenue) }),
        "　原価 ", h("span", { text: U.formatMoney(last.foodCost) })]));
      num.appendChild(h("p", {}, ["週の損益 ",
        h("span", { className: last.profit >= 0 ? "good" : "bad", text: U.formatMoney(last.profit) })]));
      var mc = monthlyCostBreakdown();
      num.appendChild(h("p", { className: "dim", text: "毎月の固定費: 家賃 " + U.formatMoney(mc.rent) +
        " / 給与 " + U.formatMoney(mc.wages) + " / 返済 " + U.formatMoney(mc.loanPay) }));
    }
    box.appendChild(num);

    var logSec = h("div", { className: "sheet-section" }, [h("h3", { text: "週次ログ" })]);
    var panel = h("div", { className: "week-log-panel" });
    state.history.slice(-12).reverse().forEach(function (rec) {
      panel.appendChild(h("div", {
        text: "第" + rec.week + "週(" + rec.month + "月): 客" + rec.totalCustomers + "人 / 売上" +
          U.formatMoneyShort(rec.revenue) + " / 満足度" + rec.avgSatisfaction
      }));
    });
    if (!state.history.length) panel.appendChild(h("div", { className: "dim", text: "まだ記録がない。" }));
    logSec.appendChild(panel);
    box.appendChild(logSec);

    box.appendChild(window.StatusPanel.renderStaff(state));
    return box;
  }

  function renderFabs() {
    var col = document.getElementById("fab-col");
    if (!col) return;
    window.UI.clear(col);
    [
      ["recipe", "🍜", "レシピ", "レシピ", panelRecipe],
      ["price", "💴", "価格", "価格", panelPrice],
      ["people", "👥", "人", "人", panelPeople],
      ["equip", "🛠", "設備", "設備", panelEquipment],
      ["data", "📊", "データ", "データ", panelData]
    ].forEach(function (f) {
      col.appendChild(h("button", {
        className: "fab" + (openSheetKey === f[0] ? " active" : ""),
        onclick: function () { openSheet(f[0], f[3], f[4]); }
      }, [
        h("span", { className: "fab-icon", text: f[1] }),
        h("span", { className: "fab-label", text: f[2] })
      ]));
    });
  }

  // ---------- 組み立て ----------
  function render(gameState, gameOverCb) {
    state = gameState;
    onGameOver = gameOverCb;
    var root = document.getElementById("screen-loop");
    window.UI.clear(root);

    root.appendChild(h("div", { className: "shop-fill", id: "shop-fill" }));
    root.appendChild(h("div", { className: "top-bar", id: "top-bar" }));
    root.appendChild(h("div", { className: "week-flash", id: "week-flash" }));
    root.appendChild(h("div", { className: "float-layer", id: "float-layer" }));
    root.appendChild(h("div", { className: "speed-dock", id: "speed-dock" }));
    root.appendChild(h("div", { className: "fab-col", id: "fab-col" }));
    G.mountBubble(root);

    root.appendChild(h("div", { className: "sheet-backdrop", id: "sheet-backdrop", onclick: closeSheet }));
    root.appendChild(h("div", { className: "sheet", id: "sheet" }, [
      h("div", { className: "sheet-head" }, [
        h("div", { className: "sheet-title", id: "sheet-title" }),
        h("button", { className: "btn small", text: "閉じる", onclick: closeSheet })
      ]),
      h("div", { className: "sheet-body", id: "sheet-body" })
    ]));

    lastFinance = null;
    lastCustomers = null;
    openSheetKey = null;
    sheetBuilder = null;

    window.ShopView.destroy();
    window.ShopView.mount(document.getElementById("shop-fill"), state);

    renderTopBar();
    renderSpeedDock();
    renderFabs();
    setSpeed(1); // 2-1: 初期速度は ×1
  }

  return { render: render, setSpeed: setSpeed };
})();
