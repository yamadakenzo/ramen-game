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
    if (U.isFirstWeekOfMonth(state.week)) {
      monthlyCosts = monthlyCostBreakdown().total;
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
      monthlyCosts: monthlyCosts, profit: Math.round(profit), money: Math.round(state.money),
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

    var events = EE.checkWeeklyEvents(state, weekStats);
    if (events.length > 0) {
      state.pendingEvents = events;
      var wasRunning = state.running;
      state.running = false;
      state.eventModalActive = true;
      clearTick();
      closeSheet();      // イベントは全画面で覆うので、開いているパネルは畳む
      hideFlash();
      window.ScreenEventModal.showQueue(state, events, function () {
        state.eventModalActive = false;
        state.week++;
        window.GameState.save();
        if (state.week > 52) { finishGame(); return; }
        renderTopBar();
        refreshShop();
        if (wasRunning && state.speed > 0) { state.running = true; scheduleTick(); }
      });
      return;
    }

    state.week++;
    window.GameState.save();
    if (state.week > 52) { finishGame(); return; }
    scheduleTick(beatMs());
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

  // ---------- 2-2: 週の結果を1行で ----------
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

  function hideFlash() {
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    var el = document.getElementById("week-flash");
    if (el) el.classList.remove("show");
  }

  function showWeekFlash(finance, customers) {
    var el = document.getElementById("week-flash");
    if (!el) return;
    if (state.speed === 0) { el.classList.remove("show"); return; } // 「停止」中は出さない
    var s = satSplit(finance, customers);
    el.textContent = "今週：客" + finance.totalCustomers + "人 / 満足" + s.good + "・不満" + s.bad +
      " / 売上 " + U.formatMoney(finance.revenue);
    el.classList.add("show");
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.classList.remove("show"); },
      (speedToMs(state.speed) || 1200) + beatMs());
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

    var priceSec = h("div", { className: "sheet-section" }, [
      h("h3", { text: "価格" }),
      h("p", {}, ["1杯 ", h("span", { className: "money", text: state.price + "円" })])
    ]);
    var row = h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } });
    [-100, -50, 50, 100].forEach(function (delta) {
      row.appendChild(h("button", {
        className: "btn small", text: (delta > 0 ? "+" : "") + delta + "円",
        onclick: function () {
          state.price = U.clamp(state.price + delta, 300, 3000);
          refreshSheet();
        }
      }));
    });
    priceSec.appendChild(row);
    box.appendChild(priceSec);
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
      ["recipe", "🍜", "レシピ", "レシピと価格", panelRecipe],
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
