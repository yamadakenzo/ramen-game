// 店舗の断面図とアニメーション。画像は一切使わず CSS ブロック + 絵文字だけで作る。
// 座標系: x は舞台幅に対する % 、y は舞台の上端からの px（舞台の高さは CSS の .shop-stage と合わせる）。
window.ShopView = (function () {
  var h = window.UI.h;
  var U = window.Utils;
  var SEGMENTS = window.DATA.segments.segments;
  var STAFF = window.DATA.characters.staff;
  var EQUIP = window.DATA.property.equipment;

  var GEO = {
    stageH: 250,
    kitchenY: 30,      // 厨房で働く店員の立ち位置(上端)
    counterSitY: 100,  // カウンター席に座った客
    stoolY: 132,       // 丸椅子
    tableSitY: 150,    // テーブル席に座った客
    tableY: 178,       // テーブルの天板
    walkY: 196,        // 床を歩いている客
    inMinX: 6, inMaxX: 70,   // 店内の可動範囲(%)
    doorX: 78,               // 出入口(%)
    queueX0: 84.5, queueGap: 2.6, queueMax: 6,
    offX: 112                // 画面外(%)
  };

  var stage = null;      // 舞台のDOM
  var actorLayer = null; // 客・店員を載せるレイヤー
  var state = null;
  var seats = [];        // {x, sitY, kind, occupant}
  var actors = [];       // 客
  var staffActors = [];
  var queue = [];        // 入店待ちの客
  var timers = [];
  var spawnTimer = null;
  var builtSig = "";
  var traffic = { pool: [], occupancy: 0, queueLevel: 0, satBySeg: {} };

  function spd() { return state && state.speed > 0 ? state.speed : 1; }
  function paused() { return !state || state.speed === 0; }

  function later(fn, ms) {
    var t = setTimeout(function () {
      var i = timers.indexOf(t);
      if (i >= 0) timers.splice(i, 1);
      fn();
    }, Math.max(16, ms / spd()));
    timers.push(t);
    return t;
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    if (spawnTimer) { clearTimeout(spawnTimer); spawnTimer = null; }
  }

  // ---------- 静物(店の躯体・設備) ----------
  function has(id) { return state.equipment.indexOf(id) >= 0; }

  function seatCounts() {
    var p = window.Scoring.getProperty(state);
    if (!p) return { counter: 8, table: 0 };
    var table = p.seats_table + (has("table_seats") ? 4 : 0);
    return { counter: Math.min(14, p.seats_counter), table: Math.min(10, table) };
  }

  function spread(n, min, max) {
    var xs = [];
    if (n <= 0) return xs;
    if (n === 1) return [(min + max) / 2];
    for (var i = 0; i < n; i++) xs.push(min + (max - min) * (i / (n - 1)));
    return xs;
  }

  function block(cls, style, children) {
    return h("div", { className: cls, style: style }, children || []);
  }

  function buildScenery() {
    window.UI.clear(stage);
    seats = [];
    actors = [];
    staffActors = [];
    queue = [];

    var counts = seatCounts();

    // 外(通り) と 店内 を分ける躯体
    stage.appendChild(block("sv-sky", {}));
    stage.appendChild(block("sv-outwall", {})); // 向かいの建物。行列の客が夜空に浮いて見えるのを防ぐ
    stage.appendChild(block("sv-street", {}));
    stage.appendChild(block("sv-room", {}));
    stage.appendChild(block("sv-ceiling", {}));
    stage.appendChild(block("sv-floor", {}));
    stage.appendChild(block("sv-wall-right", {}));

    // 天井の設備
    var lamps = has("bright_light") ? [26, 44, 62] : [44];
    lamps.forEach(function (x) {
      stage.appendChild(block("sv-lamp", { left: x + "%" }, [
        block("sv-lamp-cord", {}),
        h("span", { className: "sv-lamp-bulb", text: "💡" })
      ]));
    });
    if (has("exhaust")) {
      stage.appendChild(block("sv-duct", { left: "10%" }, [h("span", { text: "💨" })]));
    }

    // 厨房(カウンターの向こう側)
    stage.appendChild(block("sv-kitchen-counter", {}));
    var kit = [{ x: 9, e: "🍥" }];
    if (has("big_pot")) kit.push({ x: 17, e: "🍲" }); else kit.push({ x: 17, e: "🥘" });
    if (has("noodle_boiler")) kit.push({ x: 25, e: "♨️" });
    if (has("extra_boiler")) kit.push({ x: 32, e: "♨️" }); // 増設した茹で麺器
    kit.forEach(function (k) {
      stage.appendChild(block("sv-kit-item", { left: k.x + "%" }, [h("span", { text: k.e })]));
    });
    if (has("multilingual")) {
      stage.appendChild(block("sv-wall-sign", { left: "50%" }, [h("span", { text: "🌏 MENU" })]));
    }
    if (has("pos")) {
      stage.appendChild(block("sv-kit-item", { left: "64%" }, [h("span", { text: "🖥️" })]));
    }

    // カウンター
    stage.appendChild(block("sv-counter", {}));

    // カウンター席の丸椅子
    var cx = spread(counts.counter, GEO.inMinX + 2, GEO.inMaxX - 2);
    cx.forEach(function (x) {
      stage.appendChild(block("sv-stool", { left: x + "%", top: GEO.stoolY + "px" }));
      seats.push({ x: x, sitY: GEO.counterSitY, kind: "counter", occupant: null });
    });

    // テーブル席(2席ごとに卓を1つ置く)
    if (counts.table > 0) {
      var tx = spread(counts.table, 12, 66);
      for (var i = 0; i < tx.length; i += 2) {
        var cxx = tx[i + 1] != null ? (tx[i] + tx[i + 1]) / 2 : tx[i];
        stage.appendChild(block("sv-table", { left: cxx + "%", top: GEO.tableY + "px" }));
      }
      tx.forEach(function (x) {
        seats.push({ x: x, sitY: GEO.tableSitY, kind: "table", occupant: null });
      });
    }

    // 券売機は入口の内側
    if (has("ticket_machine")) {
      stage.appendChild(block("sv-ticket", { left: "72%" }, [h("span", { text: "🎫" })]));
    }

    // 入口・暖簾
    stage.appendChild(block("sv-doorway", { left: GEO.doorX + "%" }));
    stage.appendChild(block("sv-noren", { left: GEO.doorX + "%" }, [
      h("span", { className: "sv-noren-text", text: "らーめん" })
    ]));
    var prop = window.Scoring.getProperty(state);
    stage.appendChild(block("sv-signboard", {}, [
      h("span", { text: (prop ? prop.emoji : "🏪") + " " + (prop ? prop.name : "") })
    ]));

    actorLayer = block("sv-actors", {});
    stage.appendChild(actorLayer);

    stage.className = "shop-stage" + (has("bright_light") ? " bright" : "");

    buildStaff();
  }

  function buildStaff() {
    staffActors = [];
    state.staffHired.forEach(function (id, i) {
      var def = U.findById(STAFF, id);
      if (!def) return;
      var el = h("div", { className: "sv-staff", style: { top: GEO.kitchenY + "px", left: "20%" } }, [
        h("span", { className: "sv-body", text: def.emoji })
      ]);
      el.dataset.idx = i; // 速度変更時にディレイを掛け直すため
      actorLayer.appendChild(el);
      staffActors.push(el);
    });
    syncSpeed();
  }

  // ---------- 客 ----------
  function segDef(id) { return U.findById(SEGMENTS, id); }

  function faceFor(segId) {
    var sat = traffic.satBySeg[segId];
    if (sat == null) return "😐";
    if (sat >= 60) return "😄";
    if (sat >= 45) return "😐";
    return "😒";
  }

  function makeActor(segId) {
    var def = segDef(segId);
    var el = h("div", { className: "sv-cust", style: { left: GEO.offX + "%", top: GEO.walkY + "px" } }, [
      h("span", { className: "sv-bowl", text: "🍜" }),
      h("span", { className: "sv-body", text: def ? def.emoji : "🧑" }),
      h("span", { className: "sv-bubble", text: "" })
    ]);
    var a = {
      segId: segId, el: el, seat: null, queued: false, gone: false,
      body: el.querySelector(".sv-body"),
      bowl: el.querySelector(".sv-bowl"),
      bubble: el.querySelector(".sv-bubble")
    };
    actorLayer.appendChild(el);
    actors.push(a);
    return a;
  }

  function removeActor(a) {
    if (a.gone) return;
    a.gone = true;
    if (a.el.parentNode) a.el.parentNode.removeChild(a.el);
    var i = actors.indexOf(a);
    if (i >= 0) actors.splice(i, 1);
    var q = queue.indexOf(a);
    if (q >= 0) queue.splice(q, 1);
  }

  function move(a, x, y, ms) {
    if (a.gone) return;
    a.el.style.transitionDuration = Math.max(16, ms / spd()) + "ms";
    a.el.style.left = x + "%";
    if (y != null) a.el.style.top = y + "px";
    a.el.classList.toggle("flip", x > (parseFloat(a.el.dataset.x || GEO.offX)));
    a.el.dataset.x = x;
  }

  function walkMs(fromX, toX, perPct) {
    return Math.abs(toX - fromX) * (perPct || 22);
  }

  function spawnCustomer() {
    var segId = traffic.pool[U.randInt(0, traffic.pool.length - 1)];
    var a = makeActor(segId);
    // 初期位置を確定させてから移動させる。requestAnimationFrame だと
    // タブが非表示のときにコールバックが来ず、客が湧いた位置で固まる。
    void a.el.offsetWidth;
    var ms = walkMs(GEO.offX, GEO.doorX);
    move(a, GEO.doorX, GEO.walkY, ms);
    later(function () { arriveDoor(a); }, ms);
  }

  function freeSeat() {
    var open = seats.filter(function (s) { return !s.occupant; });
    if (!open.length) return null;
    return open[U.randInt(0, open.length - 1)];
  }

  function queueTarget() {
    return Math.min(GEO.queueMax, Math.round(traffic.queueLevel * 4));
  }

  function arriveDoor(a) {
    if (a.gone) return;
    // 行列が出ている週は、席が空いていても外に列を作る。
    // 「空席があるなら必ず座る」だと行列が絵に出ないまま終わってしまう。
    if (queue.length < queueTarget()) { joinQueue(a); return; }
    var seat = freeSeat();
    if (seat) { enterAndSit(a, seat); return; }
    joinQueue(a);
  }

  function queueSlot(i) { return GEO.queueX0 + i * GEO.queueGap; }

  function layoutQueue() {
    queue.forEach(function (a, i) {
      move(a, queueSlot(i), GEO.walkY, 500);
    });
  }

  function joinQueue(a) {
    a.queued = true;
    queue.push(a);
    layoutQueue();
    // 行列耐性が低い客ほど早く諦める
    var def = segDef(a.segId);
    var tol = def ? def.weights.queue_tolerance : 0.5;
    later(function () {
      if (a.gone || !a.queued) return;
      if (Math.random() > tol * 0.9 + 0.05) leaveQueue(a);
    }, 4000 + tol * 9000);
  }

  function leaveQueue(a) {
    a.queued = false;
    var i = queue.indexOf(a);
    if (i >= 0) queue.splice(i, 1);
    layoutQueue();
    a.bubble.textContent = "😒";
    a.el.classList.add("show-bubble");
    var ms = walkMs(queueSlot(i < 0 ? 0 : i), GEO.offX);
    move(a, GEO.offX, GEO.walkY, ms);
    later(function () { removeActor(a); }, ms);
  }

  function pullFromQueue() {
    if (!queue.length) return;
    var seat = freeSeat();
    if (!seat) return;
    var a = queue.shift();
    a.queued = false;
    layoutQueue();
    enterAndSit(a, seat);
  }

  function enterAndSit(a, seat) {
    seat.occupant = a;
    a.seat = seat;
    var fromX = parseFloat(a.el.dataset.x || GEO.doorX);
    var ms = walkMs(fromX, seat.x, 20) + 200;
    move(a, seat.x, GEO.walkY, ms);
    later(function () {
      if (a.gone) return;
      move(a, seat.x, seat.sitY, 420);      // 席に着く
      later(function () {
        if (a.gone) return;
        a.el.classList.add("eating");
        later(function () { finishMeal(a); }, 3200);
      }, 420);
    }, ms);
  }

  function finishMeal(a) {
    if (a.gone) return;
    a.el.classList.remove("eating");
    a.bubble.textContent = faceFor(a.segId);
    a.el.classList.add("show-bubble");
    var seat = a.seat;
    move(a, seat.x, GEO.walkY, 420);        // 席を立つ
    later(function () {
      if (a.gone) return;
      seat.occupant = null;
      a.seat = null;
      var ms = walkMs(seat.x, GEO.offX, 20);
      move(a, GEO.offX, GEO.walkY, ms);
      later(function () { removeActor(a); }, ms);
      pullFromQueue();
    }, 460);
  }

  // ---------- 送り出し(客の湧き) ----------
  function spawnLoop() {
    if (!stage) { spawnTimer = null; return; }
    spawnTimer = setTimeout(spawnLoop, Math.max(80, 620 / spd()));
    if (paused()) return;
    if (!traffic.pool.length) return;

    var occupied = seats.filter(function (s) { return !!s.occupant; }).length;
    var want = Math.round(seats.length * traffic.occupancy) + queueTarget();
    if (occupied + queue.length < want && actors.length < want + 4) spawnCustomer();
  }

  function syncSpeed() {
    var sec = 6 / spd();
    staffActors.forEach(function (el) {
      el.style.animationDuration = sec + "s";
      // ディレイも速度に比例させないと、速いときに全員の動きが揃ってしまう
      el.style.animationDelay = (-(Number(el.dataset.idx) || 0) * sec * 0.37) + "s";
    });
    if (stage) stage.classList.toggle("paused", paused());
  }

  // ---------- 外部API ----------
  function mount(container, gameState) {
    state = gameState;
    clearTimers();
    stage = h("div", { className: "shop-stage" });
    container.appendChild(stage);
    builtSig = "";
    ensureBuilt(); // ここで組み立てと spawnLoop の起動まで済む
  }

  function ensureBuilt() {
    var counts = seatCounts();
    var sig = state.property + "|" + state.equipment.slice().sort().join(",") + "|" +
      state.staffHired.slice().sort().join(",") + "|" + counts.counter + "/" + counts.table;
    if (sig === builtSig) return;
    builtSig = sig;
    clearTimers();
    buildScenery();
    spawnLoop();
  }

  // finance / customers は processWeek の計算結果。無い場合(開業直後)は空の店にする。
  function update(gameState, finance, customers) {
    state = gameState;
    if (!stage) return;
    ensureBuilt();

    var pool = [];
    var bySeg = finance ? finance.bySegment : {};
    Object.keys(bySeg).forEach(function (id) {
      var n = Math.round(bySeg[id]);
      for (var i = 0; i < n; i++) pool.push(id);
    });
    traffic.pool = pool;

    // 実際の稼働率(週の客数/週のキャパ)をそのまま席数に掛けると、繁盛していても
    // 常時1〜2席しか埋まらず店が死んで見える。見せ方として指数で持ち上げる。
    var cap = customers ? customers.weeklyCapacity : 0;
    var total = finance ? finance.totalCustomers : 0;
    var ratio = cap > 0 ? U.clamp(total / cap, 0, 1) : 0;
    traffic.occupancy = ratio > 0 ? U.clamp(Math.pow(ratio, 0.55), 0.08, 1) : 0;
    traffic.queueLevel = customers ? customers.queueLevel : 0;

    traffic.satBySeg = {};
    if (customers) {
      Object.keys(customers.results).forEach(function (id) {
        traffic.satBySeg[id] = customers.results[id].satisfaction;
      });
    }
    syncSpeed();
  }

  function destroy() {
    clearTimers();
    stage = null;
    actorLayer = null;
    actors = [];
    queue = [];
    staffActors = [];
    builtSig = "";
  }

  return { mount: mount, update: update, syncSpeed: syncSpeed, destroy: destroy };
})();
