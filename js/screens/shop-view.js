// 店舗の断面図とアニメーション。画像は一切使わず CSS ブロック + 絵文字だけで作る。
// v05: 舞台を固定枠いっぱい(9:16)に広げたので、縦位置も px ではなく舞台高さに対する % で持つ。
// 座標系: x は舞台幅に対する %、y は舞台高さに対する %。CSS の .sv-* と同じ数値を二重に持っている。
window.ShopView = (function () {
  var h = window.UI.h;
  var U = window.Utils;
  var SEGMENTS = window.DATA.segments.segments;
  var STAFF = window.DATA.characters.staff;
  var EQUIP = window.DATA.property.equipment;

  var GEO = {
    kitchenY: 15,      // 厨房で働く店員の立ち位置(上端)
    counterSitY: 43.5, // カウンター席に座った客(天板のすぐ下から頭が出る)
    stoolY: 48.5,      // 丸椅子(座った客の足元)
    tableSitY: 62,     // テーブル席に座った客
    tableY: 67,        // テーブルの天板
    walkY: 76,         // 床を歩いている客(足元が床の線に乗る)
    inMinX: 5, inMaxX: 71,   // 店内の可動範囲(%)
    doorX: 78,               // 出入口(%)
    // 縦長の枠では通りの幅が狭いので、行列は間隔を広く・人数を少なくして潰れないようにする
    queueX0: 84, queueGap: 5, queueMax: 4,
    offX: 112,               // 画面外(%)
    // 縦長では横に並べられる席数が限られる。実際の席数より多くは描かない(絵は代表表示)
    drawMaxCounter: 8, drawMaxTable: 4
  };

  var stage = null;      // 舞台のDOM
  var actorLayer = null; // 客・店員を載せるレイヤー
  var state = null;
  var seats = [];        // {x, sitY, kind, occupant}
  var actors = [];       // 客
  var staffActors = [];
  var queue = [];        // 入店待ちの客
  var timers = [];       // {fn, remaining(ms), id, startedAt} v09: 残り時間を持たせ、凍結中は完全に止める
  var spawnTimer = null;
  var builtSig = "";
  var traffic = { pool: [], occupancy: 0, queueLevel: 0, satBySeg: {} };
  // v09-1: 中央の pauseReasons(js/screens/loop.js)から setPaused() で渡される、唯一の一時停止フラグ。
  // 以前は state.speed===0 を「止まっている」の代用にしていたが、v09で速度の選択と一時停止を
  // 分離したため(停止中でも「選んでいる速度」自体は保持し続ける)、ここでは専用のフラグを持つ。
  var frozen = false;

  function spd() { return state && state.speed > 0 ? state.speed : 1; }
  function paused() { return frozen; }

  // 凍結中は新規タイマーを仕込むだけで実際にはarmしない(unfreezeで一括再開する)。
  function armTimer(rec) {
    rec.startedAt = Date.now();
    rec.id = setTimeout(function () {
      var i = timers.indexOf(rec);
      if (i >= 0) timers.splice(i, 1);
      rec.fn();
    }, Math.max(16, rec.remaining));
  }

  function later(fn, ms) {
    var rec = { fn: fn, remaining: Math.max(16, ms / spd()), id: null, startedAt: 0 };
    timers.push(rec);
    if (!frozen) armTimer(rec);
    return rec;
  }

  function clearTimers() {
    timers.forEach(function (rec) { if (rec.id) clearTimeout(rec.id); });
    timers = [];
    if (spawnTimer) { clearTimeout(spawnTimer); spawnTimer = null; }
  }

  // ---------- v09-1: 一時停止(パネル・モーダル・週末停止・非表示タブ)----------
  // 「止めるのは日付タイマーだけではない。客の歩行・食事・退店、店員の往復、行列、すべて止める」
  // という指示への対応。setTimeoutは止めて残り時間を覚えておき、CSSトランジション中の客も
  // その場でピン留めする(見た目が一瞬で目的地へワープしてしまわないよう、計算上の現在地を読み取って
  // 固定する)。再開時は同じ目的地へ向けて動きを作り直す(中断した瞬間の正確な残り時間の再現はしていない。
  // 距離から所要時間を作り直す簡易措置。プロトタイプの検証用途としては十分と判断した)。
  function pinActor(a) {
    if (a.gone || !stage) return;
    var cs = getComputedStyle(a.el);
    var leftPx = parseFloat(cs.left), topPx = parseFloat(cs.top);
    var rect = stage.getBoundingClientRect();
    var leftPct = rect.width ? (leftPx / rect.width) * 100 : parseFloat(a.el.dataset.x || 0);
    var topPct = rect.height ? (topPx / rect.height) * 100 : (a.tgtY || 0);
    a.el.style.transitionDuration = "0s";
    a.el.style.left = leftPct + "%";
    a.el.style.top = topPct + "%";
  }

  function resumeActor(a) {
    if (a.gone) return;
    a.el.style.transitionDuration = ""; // 一旦解除。moveが必要ならすぐ上書きする
    var curX = parseFloat(a.el.style.left);
    var curY = parseFloat(a.el.style.top);
    var tgtX = parseFloat(a.el.dataset.x);
    var tgtY = a.tgtY != null ? a.tgtY : curY;
    if (isNaN(tgtX)) return;
    if (Math.abs(curX - tgtX) < 0.5 && Math.abs(curY - tgtY) < 0.5) return; // 既に目的地
    move(a, tgtX, tgtY, Math.max(200, walkMs(curX, tgtX) + Math.abs(curY - tgtY) * 6));
  }

  function freeze() {
    if (frozen) return;
    frozen = true;
    var now = Date.now();
    timers.forEach(function (rec) {
      if (!rec.id) return;
      clearTimeout(rec.id);
      rec.remaining = Math.max(0, rec.remaining - (now - rec.startedAt));
      rec.id = null;
    });
    if (spawnTimer) { clearTimeout(spawnTimer); spawnTimer = null; }
    actors.forEach(pinActor);
    syncSpeed(); // stage の .paused クラスを更新(店員の往復・食事の弾みも一括で止まる)
  }

  function unfreeze() {
    if (!frozen) return;
    frozen = false;
    timers.forEach(armTimer);
    actors.forEach(resumeActor);
    syncSpeed();
    if (!spawnTimer && stage) spawnLoop();
  }

  // ---------- 静物(店の躯体・設備) ----------
  function has(id) { return state.equipment.indexOf(id) >= 0; }

  function seatCounts() {
    var p = window.Scoring.getProperty(state);
    if (!p) return { counter: 8, table: 0 };
    var table = p.seats_table + (has("table_seats") ? 4 : 0);
    return {
      counter: Math.min(GEO.drawMaxCounter, p.seats_counter),
      table: Math.min(GEO.drawMaxTable, table)
    };
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
    var kit = [{ x: 8, e: "🍥" }];
    if (has("big_pot")) kit.push({ x: 20, e: "🍲" }); else kit.push({ x: 20, e: "🥘" });
    if (has("noodle_boiler")) kit.push({ x: 32, e: "♨️" });
    if (has("extra_boiler")) kit.push({ x: 44, e: "♨️" }); // 増設した茹で麺器
    kit.forEach(function (k) {
      stage.appendChild(block("sv-kit-item", { left: k.x + "%" }, [h("span", { text: k.e })]));
    });
    if (has("multilingual")) {
      stage.appendChild(block("sv-wall-sign", { left: "50%" }, [h("span", { text: "🌏 MENU" })]));
    }
    if (has("pos")) {
      stage.appendChild(block("sv-kit-item", { left: "62%" }, [h("span", { text: "🖥️" })]));
    }

    // カウンター
    stage.appendChild(block("sv-counter", {}));

    // カウンター席の丸椅子
    var cx = spread(counts.counter, GEO.inMinX + 2, GEO.inMaxX - 2);
    cx.forEach(function (x) {
      stage.appendChild(block("sv-stool", { left: x + "%", top: GEO.stoolY + "%" }));
      seats.push({ x: x, sitY: GEO.counterSitY, kind: "counter", occupant: null });
    });

    // テーブル席(2席ごとに卓を1つ置く)
    if (counts.table > 0) {
      var tx = spread(counts.table, 12, 66);
      for (var i = 0; i < tx.length; i += 2) {
        var cxx = tx[i + 1] != null ? (tx[i] + tx[i + 1]) / 2 : tx[i];
        stage.appendChild(block("sv-table", { left: cxx + "%", top: GEO.tableY + "%" }));
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
      var el = h("div", { className: "sv-staff", style: { top: GEO.kitchenY + "%", left: "20%" } }, [
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
    var el = h("div", { className: "sv-cust", style: { left: GEO.offX + "%", top: GEO.walkY + "%" } }, [
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
    if (y != null) { a.el.style.top = y + "%"; a.tgtY = y; } // v09: 凍結からの再開(resumeActor)で目的地を辿るために覚えておく
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
    if (!stage || frozen) { spawnTimer = null; return; } // 凍結中はこの周期タイマー自体を止める(unfreezeが再度呼ぶ)
    spawnTimer = setTimeout(spawnLoop, Math.max(80, 620 / spd()));
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
    // v09-1: 凍結中(パネルを開いたまま設備を買った、等)に組み直した場合は湧きループを起こさない。
    // unfreeze() 側が再開時にちゃんと spawnLoop() を呼ぶ。
    if (!frozen) spawnLoop();
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
    frozen = false;
  }

  // v09-1: 中央のpauseReasons(js/screens/loop.js)から呼ばれる、唯一の一時停止スイッチ。
  function setPaused(on) { if (on) freeze(); else unfreeze(); }

  return { mount: mount, update: update, syncSpeed: syncSpeed, destroy: destroy, setPaused: setPaused };
})();
