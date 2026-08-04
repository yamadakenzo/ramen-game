// 営業ループ本体: 週の自動進行、速度調整、客のアニメーション、プレイヤー操作
window.ScreenLoop = (function () {
  var h = window.UI.h;
  var U = window.Utils;
  var Scoring = window.Scoring;
  var EE = window.EventEngine;
  var SEGMENTS = window.DATA.segments.segments;
  var RECIPES = window.DATA.recipes;
  var PROPERTY_DATA = window.DATA.property;
  var STAFF = window.DATA.characters.staff;
  var CARDS = window.DATA.characters.cards;

  var state, onGameOver;
  var tickTimer = null;
  var TALK_COST = 1200;
  var TALK_GAIN = 8;
  // 直近の週次計算結果。設備変更などで店の絵を組み直すときに再利用する。
  var lastFinance = null, lastCustomers = null;

  function findStaffDef(id) { return U.findById(STAFF, id); }
  function findCardDef(id) { return U.findById(CARDS, id); }

  function speedToMs(speed) {
    if (speed === 0) return null;
    return { 1: 1100, 2: 550, 4: 260 }[speed];
  }

  function clearTick() { if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; } }

  function scheduleTick() {
    clearTick();
    if (!state.running) return;
    var ms = speedToMs(state.speed);
    if (!ms) return;
    tickTimer = setTimeout(function () {
      processWeek();
    }, ms);
  }

  function setSpeed(n) {
    state.speed = n;
    window.ShopView.syncSpeed();
    if (state.eventModalActive) { renderHUD(); return; } // モーダル表示中は再開しない
    state.running = n > 0;
    renderHUD();
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

  function processWeek() {
    if (state.week > 52) { finishGame(); return; }
    if (state.eventModalActive) return; // モーダル応答待ちの間は絶対に進めない

    var customers = Scoring.computeWeeklyCustomers(state);
    var finance = Scoring.computeWeeklyFinance(state, customers);
    var avgSat = Scoring.weightedAvgSatisfaction(customers);
    state.lastAvgSatisfaction = avgSat;

    var monthlyCosts = 0, breakdown = null;
    if (U.isFirstWeekOfMonth(state.week)) {
      breakdown = monthlyCostBreakdown();
      monthlyCosts = breakdown.total;
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

    var unlocks = EE.checkCardUnlocks(state);
    unlocks.forEach(function (u) { window.UI.toast(u.text, 3200); });

    renderAll(finance, customers);

    var events = EE.checkWeeklyEvents(state, weekStats);
    if (events.length > 0) {
      state.pendingEvents = events;
      var wasRunning = state.running;
      state.running = false;
      state.eventModalActive = true;
      clearTick();
      window.ScreenEventModal.showQueue(state, events, function () {
        state.eventModalActive = false;
        state.week++;
        window.GameState.save();
        if (state.week > 52) { finishGame(); return; }
        renderHUD();
        if (wasRunning && state.speed > 0) { state.running = true; scheduleTick(); }
      });
      return;
    }

    state.week++;
    window.GameState.save();
    if (state.week > 52) { finishGame(); return; }
    scheduleTick();
  }

  function finishGame() {
    clearTick();
    window.ShopView.destroy();
    state.running = false;
    console.log("=== イベント密度ログ ===");
    console.table(state.eventLog);
    onGameOver();
  }

  // ---------- 描画 ----------
  function renderHUD() {
    var root = document.getElementById("hud-area");
    if (!root) return;
    window.UI.clear(root);
    var month = U.weekToMonth(state.week > 52 ? 52 : state.week);
    var moraleAvg = state.staffHired.length ? Math.round(state.staffHired.reduce(function (s, id) { return s + EE.ensureStaffState(state, id).morale; }, 0) / state.staffHired.length) : 0;

    root.appendChild(h("div", { className: "hud-item" }, [h("div", { className: "hud-label", text: "週" }), h("div", { className: "hud-value", text: (Math.min(state.week, 52)) + " / 52" })]));
    root.appendChild(h("div", { className: "hud-item" }, [h("div", { className: "hud-label", text: "月" }), h("div", { className: "hud-value", text: month + "月" })]));
    root.appendChild(h("div", { className: "hud-item" }, [h("div", { className: "hud-label", text: "所持金" }), h("div", { className: "hud-value money", text: U.formatMoneyShort(state.money) })]));
    root.appendChild(h("div", { className: "hud-item" }, [h("div", { className: "hud-label", text: "評判" }), h("div", { className: "hud-value", text: Math.round(state.reputation) })]));
    root.appendChild(h("div", { className: "hud-item" }, [h("div", { className: "hud-label", text: "価格" }), h("div", { className: "hud-value", text: state.price + "円" })]));

    var staffStrip = h("div", { className: "staff-strip" });
    state.staffHired.forEach(function (id) {
      var def = findStaffDef(id);
      var s = EE.ensureStaffState(state, id);
      var color = s.morale >= 60 ? "#6fbf5c" : (s.morale >= 30 ? "#e8a13b" : "#d9534f");
      staffStrip.appendChild(h("div", { className: "staff-badge" }, [
        h("span", { text: def.emoji }),
        h("span", { text: def.name }),
        h("span", { className: "morale-dot", style: { background: color } })
      ]));
    });
    root.appendChild(staffStrip);

    var speedBox = h("div", { className: "speed-controls" });
    [[0, "停止"], [1, "×1"], [2, "×2"], [4, "×4"]].forEach(function (pair) {
      speedBox.appendChild(h("button", {
        className: "btn small" + (state.speed === pair[0] ? " selected" : ""),
        text: pair[1],
        onclick: function () { setSpeed(pair[0]); }
      }));
    });
    root.appendChild(speedBox);
  }

  function refreshShop() {
    window.ShopView.update(state, lastFinance, lastCustomers);
  }

  function renderStatus() {
    window.StatusPanel.render(state, document.getElementById("status-area"));
  }

  function renderQueueBanner(customers) {
    var banner = document.getElementById("queue-banner");
    if (!banner) return;
    if (customers && customers.queueLevel > 0.1) {
      banner.classList.add("show");
      banner.textContent = "🚶行列ができている（並びたくない客層の足が遠のく）";
    } else {
      banner.classList.remove("show");
    }
  }

  function renderWeekLog() {
    var panel = document.getElementById("week-log-area");
    if (!panel) return;
    window.UI.clear(panel);
    var recent = state.history.slice(-10).reverse();
    recent.forEach(function (rec) {
      panel.appendChild(h("div", {
        text: "第" + rec.week + "週(" + rec.month + "月): 客" + rec.totalCustomers + "人 / 売上" + U.formatMoneyShort(rec.revenue) + " / 満足度" + rec.avgSatisfaction
      }));
    });
  }

  function renderAll(finance, customers) {
    lastFinance = finance;
    lastCustomers = customers;
    renderHUD();
    refreshShop();
    renderQueueBanner(customers);
    renderStatus();
    renderWeekLog();
  }

  // ---------- サブモーダル(プレイヤー操作) ----------
  function openSubModal(title, contentNode) {
    var wasRunning = state.running;
    state.running = false;
    clearTick();
    var overlay = document.getElementById("event-modal-overlay");
    var box = document.getElementById("event-modal-box");
    box.className = "modal-box sub-modal";
    window.UI.clear(box);
    box.appendChild(h("h2", { text: title }));
    box.appendChild(contentNode);
    box.appendChild(h("div", { className: "modal-choices" }, [
      h("button", {
        className: "btn", text: "閉じる",
        onclick: function () {
          overlay.classList.remove("show");
          renderHUD();
          refreshShop();   // 設備や席数の変更を店の絵に反映する
          renderStatus();
          if (wasRunning) { state.running = true; scheduleTick(); }
        }
      })
    ]));
    overlay.classList.add("show");
  }

  function actionChangeRecipe() {
    var content = h("div", {});
    if (state.flags.recipeLockWeeksLeft > 0) {
      content.appendChild(h("p", { className: "bad", text: "ゴンゾウとの約束であと" + state.flags.recipeLockWeeksLeft + "週はレシピを変更できない。" }));
      openSubModal("レシピの変更", content);
      return;
    }
    content.appendChild(h("p", { className: "dim", text: "変更は常連とゴンゾウが敏感に反応する。" }));
    var cats = [["soup", "スープ"], ["tare", "タレ"], ["noodle", "麺"], ["topping", "トッピング"]];
    cats.forEach(function (c) {
      var key = c[0];
      content.appendChild(h("h3", { text: c[1] }));
      var grid = h("div", { className: "choice-grid" });
      RECIPES[key].filter(function (item) {
        if (item.unlock === "start") return true;
        if (item.unlock === "card_menya") return !!state.cardsUnlocked.menya;
        return false;
      }).forEach(function (item) {
        var selected = state.recipe[key] === item.id;
        grid.appendChild(h("div", {
          className: "choice-card" + (selected ? " selected" : ""),
          onclick: function () {
            if (state.recipe[key] !== item.id) {
              state.recipe[key] = item.id;
              state.recipeChangeLog.push(state.week);
              window.UI.toast(c[1] + "を" + item.name + "に変更した");
              renderStatus(); // 完成度が選んだ瞬間に動くのを見せる
              actionChangeRecipe();
            }
          }
        }, [
          h("div", { className: "emoji", text: item.emoji }),
          h("div", { className: "name", text: item.name })
        ]));
      });
      content.appendChild(grid);
    });
    openSubModal("レシピの変更", content);
  }

  function actionChangePrice() {
    var content = h("div", {});
    content.appendChild(h("p", {}, ["現在価格: ", h("span", { className: "money", text: state.price + "円" })]));
    var row = h("div", { style: { display: "flex", gap: "8px" } });
    [-100, -50, 50, 100].forEach(function (delta) {
      row.appendChild(h("button", {
        className: "btn small", text: (delta > 0 ? "+" : "") + delta + "円",
        onclick: function () {
          state.price = U.clamp(state.price + delta, 300, 3000);
          renderStatus();
          actionChangePrice();
        }
      }));
    });
    content.appendChild(row);
    openSubModal("価格の変更", content);
  }

  function actionBuyEquipment() {
    var content = h("div", {});
    content.appendChild(h("p", {}, ["所持金: ", h("span", { className: "money", text: U.formatMoneyShort(state.money) })]));
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
          renderStatus();
          refreshShop();  // 券売機やテーブル席は買った瞬間に絵へ出す
          actionBuyEquipment();
        }
      }, [
        h("div", { className: "emoji", text: eq.emoji }),
        h("div", { className: "name", text: eq.name + (owned ? "（導入済）" : "") }),
        h("div", { className: "cost", text: U.formatMoney(eq.cost) }),
        h("div", { className: "sub", text: eq.effect })
      ]));
    });
    content.appendChild(grid);
    openSubModal("設備の購入", content);
  }

  function actionStaff() {
    var content = h("div", {});
    var grid = h("div", { className: "choice-grid" });
    STAFF.forEach(function (def) {
      var hired = state.staffHired.indexOf(def.id) >= 0;
      var rating = Scoring.staffRating(def);
      grid.appendChild(h("div", {
        className: "choice-card" + (hired ? " selected" : ""),
        onclick: function () {
          if (hired) {
            state.staffHired = state.staffHired.filter(function (id) { return id !== def.id; });
            window.UI.toast(def.name + "が店を離れた");
          } else {
            state.staffHired.push(def.id);
            EE.ensureStaffState(state, def.id);
            if (def.id === "yuta") state.flags.yutaHireWeek = state.week;
            window.UI.toast(def.name + "を雇用した");
          }
          renderStatus();
          refreshShop();  // 店員が絵に増える/減る
          actionStaff();
        }
      }, [
        h("div", { className: "emoji" }, [
          def.emoji, " ", window.StatusPanel.rankBadge(rating.rank)
        ]),
        h("div", { className: "name", text: def.name + "（" + def.role + "）" + (hired ? " 雇用中" : "") }),
        h("div", { className: "cost", text: U.formatMoney(def.wage) + "/月" }),
        window.StatusPanel.staffStats(def),
        h("div", { className: "sub", text: def.personality })
      ]));
    });
    content.appendChild(grid);
    openSubModal("従業員の雇用・解雇", content);
  }

  function actionTalk() {
    var content = h("div", {});
    content.appendChild(h("p", { className: "dim", text: "1回 " + TALK_COST + "円。関係値+" + TALK_GAIN + "。" }));
    var grid = h("div", { className: "choice-grid" });
    CARDS.forEach(function (c) {
      var rel = state.relationships[c.id] || 0;
      grid.appendChild(h("div", {
        className: "choice-card" + (state.money < TALK_COST ? " disabled" : ""),
        onclick: function () {
          if (state.money < TALK_COST) return;
          state.money -= TALK_COST;
          state.relationships[c.id] = U.clamp(rel + TALK_GAIN, 0, 100);
          window.UI.toast(c.name + "と話した（関係値 " + state.relationships[c.id] + "）");
          actionTalk();
        }
      }, [
        h("div", { className: "emoji", text: c.emoji }),
        h("div", { className: "name", text: c.name }),
        h("div", { className: "sub", text: "関係値 " + rel })
      ]));
    });
    state.staffHired.forEach(function (id) {
      var def = findStaffDef(id);
      var s = EE.ensureStaffState(state, id);
      grid.appendChild(h("div", {
        className: "choice-card" + (state.money < TALK_COST ? " disabled" : ""),
        onclick: function () {
          if (state.money < TALK_COST) return;
          state.money -= TALK_COST;
          s.rel = U.clamp(s.rel + TALK_GAIN, 0, 100);
          s.morale = U.clamp(s.morale + 4, 0, 100);
          window.UI.toast(def.name + "と話した（関係値 " + s.rel + "）");
          actionTalk();
        }
      }, [
        h("div", { className: "emoji", text: def.emoji }),
        h("div", { className: "name", text: def.name }),
        h("div", { className: "sub", text: "関係値 " + s.rel + " / 士気 " + s.morale })
      ]));
    });
    content.appendChild(grid);
    openSubModal("人と話す", content);
  }

  function renderActionBar() {
    var bar = document.getElementById("action-bar-area");
    if (!bar) return;
    window.UI.clear(bar);
    [
      ["🍜 レシピ変更", actionChangeRecipe],
      ["💴 価格変更", actionChangePrice],
      ["🛠 設備購入", actionBuyEquipment],
      ["👥 従業員", actionStaff],
      ["💬 人と話す", actionTalk]
    ].forEach(function (pair) {
      bar.appendChild(h("button", { className: "btn", text: pair[0], onclick: pair[1] }));
    });
  }

  function render(gameState, gameOverCb) {
    state = gameState;
    onGameOver = gameOverCb;
    var root = document.getElementById("screen-loop");
    window.UI.clear(root);
    root.appendChild(h("div", { className: "hud pixel-panel", id: "hud-area" }));
    root.appendChild(h("div", { className: "shop-floor", id: "shop-floor-area" }));
    root.appendChild(h("div", { className: "queue-banner", id: "queue-banner" }));
    root.appendChild(h("div", { className: "action-bar", id: "action-bar-area" }));
    root.appendChild(h("div", { className: "status-row", id: "status-area" }));
    root.appendChild(h("div", { className: "week-log-panel", id: "week-log-area" }));

    lastFinance = null;
    lastCustomers = null;
    window.ShopView.destroy();
    window.ShopView.mount(document.getElementById("shop-floor-area"), state);

    renderActionBar();
    renderHUD();
    renderStatus();
    renderWeekLog();
    setSpeed(1);
  }

  return { render: render, setSpeed: setSpeed };
})();
