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

  // v12-1: 各フェーズの尺は「ゲーム内で何分か」で持ち、gm()でwindow.BASE_HOUR_MS(js/utils.js の
  // 1箇所だけ)から実ms(×1基準)を作る。later()/move()は1x基準のmsを受け取って内部でspd()で
  // 割る作りなので、ここでも1x基準のまま渡す(実時間へは変換しない)。
  // 下の分数値は、旧基準(1時間=5000ms@×1)のときに実際に使っていた実秒の直値を「その時点で
  // 何ゲーム内分だったか」に換算しただけで、体感の尺そのものは変えていない
  // (BASE_HOUR_MSを変えても客の動きが速すぎ/遅すぎにならないようにするための書き換え)。
  var OLD_MS_PER_MIN = 5000 / 60; // 換算の物差し。以後この値そのものを直接使うことはない
  var WALK_MIN_PER_PCT = 22 / OLD_MS_PER_MIN;        // 通常の歩行、横1%あたりの分
  var SEAT_WALK_MIN_PER_PCT = 20 / OLD_MS_PER_MIN;   // 席へ向かう/席から出るときの歩行
  var ENTER_EXTRA_MIN = 200 / OLD_MS_PER_MIN;        // 席へ向かう前の一拍
  var SIT_MIN = 420 / OLD_MS_PER_MIN;                // 席に着く/席を立つ
  var LEAVE_WAIT_MIN = 460 / OLD_MS_PER_MIN;         // 席を立ってから実際に歩き出すまでの間
  var QUEUE_REFLOW_MIN = 500 / OLD_MS_PER_MIN;       // 行列の詰め直し
  var QUEUE_PATIENCE_BASE_MIN = 4000 / OLD_MS_PER_MIN; // 行列を諦めるか判定するまでの最短
  var QUEUE_PATIENCE_TOL_MIN = 9000 / OLD_MS_PER_MIN;  // 行列耐性ぶんの上乗せ(客層ごとに変わる)
  var MEAL_MIN_MIN = 2500 / OLD_MS_PER_MIN;          // 提供+食事(最短)。約30分
  var MEAL_MIN_MAX = 3500 / OLD_MS_PER_MIN;          // 提供+食事(最長)。約42分
  var RESUME_FLOOR_MIN = 200 / OLD_MS_PER_MIN;       // 一時停止/速度変更からの再開時の最短尺
  var RESUME_Y_MIN_PER_PCT = 6 / OLD_MS_PER_MIN;     // 同、縦移動ぶんの上乗せ(%あたり)
  // v13-1: 厨房の作業ポーズの基準値(ゲーム内分)。既存の提供速度の値(Scoring.computeShopStats().speed)
  // と、その店員自身の麺上げ能力(Scoring.effectiveStat、既存)でstationごとに個人ごとスケールする
  // (workerPace())。ここは「絵の忙しさ」のためだけの尺で、週次計算には一切フィードバックしない。
  var KITCHEN_STATION_MIN = 2.5; // 中継地点(スープ/麺/盛り付け)1箇所あたりの作業ポーズの基準
  var KITCHEN_HANDOFF_MIN = 1;   // 客に渡す一拍の基準

  function gm(min) { return U.gameMinMs(min); }

  var stage = null;      // 舞台のDOM
  var actorLayer = null; // 客・店員を載せるレイヤー
  var state = null;
  var seats = [];        // {x, sitY, kind, occupant}
  var actors = [];       // 客
  var staffActors = [];  // 互換用。実体はkitchenWorkers(下)
  var queue = [];        // 入店待ちの客
  // v13-1: 厨房の作業動線。1人 = state.staffHired の1人ぶん。
  var kitchenWorkers = []; // {id, def, el, gone, busy, homeX, curY}
  var orderQueue = [];     // {id, seat, actor} まだどの店員も掴んでいない注文(=丼が厨房に積まれて見える)
  var orderSeq = 0;
  var orderPileEl = null;  // 積まれた丼を表示するDOM
  var timers = [];       // {fn, remaining(ms), id, startedAt} v09: 残り時間を持たせ、凍結中は完全に止める
  var builtSig = "";
  // v10-3: 週次のcomputeWeeklyCustomersの結果を「曜日×帯」へ配分したもの(js/scoring.jsの
  // weeklyBandSchedule)。openBand()がここから今日・その帯ぶんを取り出して実数だけ湧かせる。
  // 以前あった traffic.pool/occupancy(Math.pow で稼働率を持ち上げる演出)は廃止した
  // (客数と絵が一致しない原因そのものだったため。v10指示3)。
  var traffic = { schedule: null, queueLevel: 0, satBySeg: {}, pricePerCustomer: 0 };
  // v09-1: 中央の pauseReasons(js/screens/loop.js)から setPaused() で渡される、唯一の一時停止フラグ。
  // 以前は state.speed===0 を「止まっている」の代用にしていたが、v09で速度の選択と一時停止を
  // 分離したため(停止中でも「選んでいる速度」自体は保持し続ける)、ここでは専用のフラグを持つ。
  var frozen = false;
  // v12-1: 直近にsyncSpeed()した時点の速度。これと今のspd()がズレていたら「速度が変わった瞬間」と
  // 判定し、画面上の客の残り時間・移動もその場で新しい速度に追随させる(retime())。
  var curSpd = 1;
  // v12-3:「今週の客」カウンタ用。客が実際に入店した瞬間(enterAndSit)にloop.js側へ知らせる。
  var onEnterCb = null;
  // v13-3: 客が退店した瞬間(finishMeal)にloop.js側へ知らせる。その客のpriceOwedを渡す。
  var onExitCb = null;

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
    move(a, tgtX, tgtY, Math.max(gm(RESUME_FLOOR_MIN), walkMs(curX, tgtX) + Math.abs(curY - tgtY) * gm(RESUME_Y_MIN_PER_PCT)));
  }

  // v13-1: 客(actors)だけでなく厨房の店員(kitchenWorkers)も同じ「移動中の俳優」として
  // 一時停止・速度追随の対象にする(move()/later()を共用しているため形は同じ)。
  function movingActors() { return actors.concat(kitchenWorkers); }

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
    movingActors().forEach(pinActor);
    syncSpeed(); // stage の .paused クラスを更新(食事の弾みも止まる)
  }

  function unfreeze() {
    if (!frozen) return;
    frozen = false;
    timers.forEach(armTimer);
    movingActors().forEach(resumeActor);
    syncSpeed();
  }

  // ---------- v12-1: 速度を切り替えた瞬間、画面上の客の残り時間・移動を新しい速度に追随させる ----------
  // pause/resume(freeze/unfreeze)と同じ考え方(残り時間を覚えて作り直す)を、止めずにその場で行う。
  // timers.remaining は「現在の速度での実ms」を持っているので、旧速度/新速度の比率を掛け直すだけで
  // 正しい実msに変換できる。移動中の客はpinActor→resumeActorで、今いる位置から新しい尺で動き直す。
  function retime() {
    var ns = spd();
    if (ns === curSpd) return;
    var ratio = curSpd / ns; // 旧速度/新速度
    var now = Date.now();
    timers.forEach(function (rec) {
      if (rec.id) {
        clearTimeout(rec.id);
        rec.remaining = Math.max(0, rec.remaining - (now - rec.startedAt));
      }
      rec.remaining = Math.max(16, rec.remaining * ratio);
      if (!frozen) armTimer(rec);
    });
    if (!frozen) movingActors().forEach(function (a) { pinActor(a); resumeActor(a); });
    curSpd = ns;
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
    // v13-1: 誰も取っていない注文(丼)が積まれて見える場所。既存のスープ鍋(x=20)の位置を起点に、
    // 新しい座標系を作らず既存の厨房カウンター上へ並べる。
    orderPileEl = block("sv-order-pile", { left: "20%", top: "9%" });
    stage.appendChild(orderPileEl);
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

  // v13-1: 店員1人 = 厨房で働く1人ぶんの俳優(kitchenWorkers)。移動はcustomerと同じmove()/later()を
  // 使うので、一時停止・速度追随はmovingActors()経由でそのまま効く。
  function buildStaff() {
    staffActors = [];
    kitchenWorkers = [];
    orderQueue = [];
    var homeXs = spread(state.staffHired.length, 10, 18); // 複数人いても定位置が重ならないよう少しだけ散らす
    state.staffHired.forEach(function (id, i) {
      var def = U.findById(STAFF, id);
      if (!def) return;
      var homeX = homeXs[i] != null ? homeXs[i] : 14;
      var el = h("div", { className: "sv-staff", style: { top: GEO.kitchenY + "%", left: homeX + "%" } }, [
        h("span", { className: "sv-body", text: def.emoji }),
        h("span", { className: "sv-bowl", text: "🍜" })
      ]);
      el.dataset.x = homeX;
      actorLayer.appendChild(el);
      var w = { id: id, def: def, el: el, gone: false, busy: false, homeX: homeX, curY: GEO.kitchenY };
      kitchenWorkers.push(w);
      staffActors.push(el);
    });
    renderOrderPile();
    dispatchOrders();
    syncSpeed();
  }

  // ---------- v13-1: 厨房の作業動線(寸胴→茹で麺器→盛り付け→客席→厨房) ----------
  // 「絵は計算を決めない」の指示どおり、ここは既に計算済みの値(客の入店タイミング=既存の週次客数を
  // 帯へ配分したスケジュール由来、Scoring.computeShopStats().speed、Scoring.effectiveStatの
  // 麺上げ能力)を読むだけで、ここから週次計算(scoring.js)側へ書き戻すことは一切しない。
  function soupStationX() { return 20; }             // 既存: 寸胴/鍋の座標(buildScenery)
  function noodleStationX() { return has("noodle_boiler") ? 32 : 8; } // 既存: 茹で麺器、無ければ既存の別の厨房座標で代用
  var PLATE_X = 56;      // 既存: 店員の待機ペーシング可動域の右端(旧svPaceキーフレームと同じ値を踏襲)
  var KITCHEN_PILE_MAX = 6; // 積める丼アイコンの表示上限(それ以上は「+N」で表す)

  function renderOrderPile() {
    if (!orderPileEl) return;
    window.UI.clear(orderPileEl);
    var n = orderQueue.length;
    var shown = Math.min(n, KITCHEN_PILE_MAX);
    for (var i = 0; i < shown; i++) {
      orderPileEl.appendChild(h("span", { className: "sv-pile-bowl", text: "🍜" }));
    }
    if (n > KITCHEN_PILE_MAX) {
      orderPileEl.appendChild(h("span", { className: "sv-pile-more", text: "+" + (n - KITCHEN_PILE_MAX) }));
    }
  }

  // 客が入店した瞬間(=席へ向かい始めた瞬間)に「注文」を1件発生させる。手が空いている店員がいれば
  // すぐに掴む。全員手一杯なら丼が積まれて見える(このqueueは表示専用。売上・満足度には使わない)。
  function placeOrder(seat) {
    orderQueue.push({ id: ++orderSeq, seat: seat });
    renderOrderPile();
    dispatchOrders();
  }

  function dispatchOrders() {
    kitchenWorkers.forEach(function (w) {
      if (w.gone || w.busy || !orderQueue.length) return;
      var order = orderQueue.shift();
      renderOrderPile();
      runOrderCycle(w, order);
    });
  }

  // 既存の提供速度(店の"speed"、equipment由来)と、その店員自身の麺上げ能力(既存のeffectiveStat。
  // 「教える」で伸びた分も既に反映済み)から、1中継地点あたりの作業ポーズをスケールする係数を作る。
  // どちらも既に計算済みの値を読むだけで、ここで新しい週次パラメータは作らない。
  function workerPace(w) {
    var shopSpeed = window.Scoring.computeShopStats(state).speed; // 既存(equipment由来、0〜100)
    var bonus = state.staffState && state.staffState[w.id] && state.staffState[w.id].statBonus;
    var noodle = window.Scoring.effectiveStat(w.def, bonus, "noodle"); // 既存(staffRatingで使っている値と同じ)
    return U.clamp((shopSpeed * 0.4 + noodle * 0.6) / 100, 0.15, 1.4);
  }

  function moveWorker(w, x, y) {
    var fromX = parseFloat(w.el.dataset.x != null ? w.el.dataset.x : x);
    var fromY = w.curY != null ? w.curY : GEO.kitchenY;
    var travelMs = walkMs(fromX, x) + Math.abs(fromY - y) * gm(RESUME_Y_MIN_PER_PCT);
    move(w, x, y, travelMs);
    w.curY = y;
    return travelMs;
  }

  function runOrderCycle(w, order) {
    w.busy = true;
    w.el.classList.add("carrying");
    var pace = workerPace(w);
    var pauseMs = gm(KITCHEN_STATION_MIN / pace);
    var handoffMs = gm(KITCHEN_HANDOFF_MIN / pace);
    var stops = [
      { x: soupStationX(), y: GEO.kitchenY, wait: pauseMs },
      { x: noodleStationX(), y: GEO.kitchenY, wait: pauseMs },
      { x: PLATE_X, y: GEO.kitchenY, wait: pauseMs },
      { x: order.seat.x, y: order.seat.sitY, wait: handoffMs, deliver: true }, // 客席へ運ぶ
      { x: w.homeX, y: GEO.kitchenY, wait: 0 }                                 // 厨房へ戻る
    ];
    function step(i) {
      if (w.gone) return;
      if (i >= stops.length) { w.busy = false; dispatchOrders(); return; }
      var s = stops[i];
      var travelMs = moveWorker(w, s.x, s.y);
      later(function () {
        if (s.deliver) w.el.classList.remove("carrying");
        step(i + 1);
      }, travelMs + s.wait);
    }
    step(0);
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

  // ---------- v13-2: 退店時のフィードバック(表情の下に「評判 +1」を出す) ----------
  // 週の評判は既存の式(runWeeklyCalc: reputation += (avgSat-50)*0.04)で週の平均満足度から
  // 一括更新されており、客1人ぶんの寄与という数値は元々存在しない。ここでは新しい数値を作らず、
  // 既存の満足度3段階の判定(faceForと同じ閾値: 60以上=満足/45未満=不満)をそのまま符号に使う
  // ——満足なら平均を押し上げる側(+1)、不満なら押し下げる側(-1)、普通(0)は出さない。
  // 週の実際の評判の増減量そのものはこれまで通りrunWeeklyCalcで一括計算する(ここは表示専用)。
  var activePopups = 0;
  var POPUP_MAX = 3;   // 同時に出るのは最大3件まで
  var POPUP_MS = 800;  // 指示どおり実秒固定(ゲーム内時間ではない)。toast()と同じくlater()を使わない
  function reputationSign(segId) {
    var sat = traffic.satBySeg[segId];
    if (sat == null) return 0;
    if (sat >= 60) return 1;
    if (sat < 45) return -1;
    return 0;
  }
  function showExitPopup(a) {
    var d = reputationSign(a.segId);
    if (!d) return; // 変化なしのときは出さない
    if (activePopups >= POPUP_MAX) return; // うるさくなるので上限を超えたら出さない
    activePopups++;
    var el = h("span", {
      className: "sv-rep-pop " + (d > 0 ? "good" : "bad"),
      text: "評判 " + (d > 0 ? "+" : "") + d
    });
    a.el.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
      activePopups = Math.max(0, activePopups - 1);
    }, POPUP_MS);
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
      // v13-3: 湧いた瞬間の「今週の1杯あたり売価」を固定で持たせる。週をまたいで退店した場合でも
      // (v12で分かった、帯の終盤に来た客がまれに週をまたいで完食するケース)、この客が本来属していた
      // 週の額のまま計上されるようにするため、退店時ではなく湧いた時点の値を握らせておく。
      priceOwed: traffic.pricePerCustomer || 0,
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

  function walkMs(fromX, toX, minPerPct) {
    return Math.abs(toX - fromX) * gm(minPerPct || WALK_MIN_PER_PCT);
  }

  function spawnCustomer(segId) {
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

  // v10-3: 実数だけ湧かせるようになったので、「席が空いていても行列を作る」演出上の水増しは廃止。
  // 満席なら並ぶ・空いていれば座る、という素直な判定にした。行列は実際の混雑から自然に生まれる。
  function arriveDoor(a) {
    if (a.gone) return;
    var seat = freeSeat();
    if (seat) { enterAndSit(a, seat); return; }
    joinQueue(a);
  }

  function queueSlot(i) { return GEO.queueX0 + i * GEO.queueGap; }

  // 縦長の枠では表示できる行列の人数に限りがある(GEO.queueMax)。それを超えるぶんは
  // 最後の見える位置に重ねておく(データ上は全員実在し、席が空けば順番に呼ばれる)。
  function layoutQueue() {
    queue.forEach(function (a, i) {
      var slot = Math.min(i, GEO.queueMax - 1);
      move(a, queueSlot(slot), GEO.walkY, gm(QUEUE_REFLOW_MIN));
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
    }, gm(QUEUE_PATIENCE_BASE_MIN + tol * QUEUE_PATIENCE_TOL_MIN));
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
    // v12-3:「今週の客」は実際に入店した(=席へ向かい始めた)瞬間に+1する。諦めて帰った行列客は
    // ここを通らないので数えない。
    if (onEnterCb) onEnterCb(a.segId);
    placeOrder(seat); // v13-1: 入店=厨房への注文発生。手が空いている店員がいなければ丼が積まれる
    var fromX = parseFloat(a.el.dataset.x || GEO.doorX);
    var ms = walkMs(fromX, seat.x, SEAT_WALK_MIN_PER_PCT) + gm(ENTER_EXTRA_MIN);
    move(a, seat.x, GEO.walkY, ms);
    later(function () {
      if (a.gone) return;
      move(a, seat.x, seat.sitY, gm(SIT_MIN));      // 席に着く
      later(function () {
        if (a.gone) return;
        a.el.classList.add("eating");
        // v10-3/v12-1: 滞在時間はゲーム内時間で持つ(提供+食事で30〜40分程度)。実秒は
        // BASE_HOUR_MS(js/utils.js)から作るので、速度体系を変えても比率は崩れない。
        later(function () { finishMeal(a); }, gm(U.rand(MEAL_MIN_MIN, MEAL_MIN_MAX)));
      }, gm(SIT_MIN));
    }, ms);
  }

  function finishMeal(a) {
    if (a.gone) return;
    a.el.classList.remove("eating");
    a.bubble.textContent = faceFor(a.segId);
    a.el.classList.add("show-bubble");
    showExitPopup(a); // v13-2: 退店の動きが始まった瞬間、表情の下に「評判 ±1」を出す(変化があるときだけ)
    if (onExitCb) onExitCb(a.segId, a.priceOwed); // v13-3: 退店の瞬間、その1杯の売価を所持金へ
    var seat = a.seat;
    move(a, seat.x, GEO.walkY, gm(SIT_MIN));        // 席を立つ
    later(function () {
      if (a.gone) return;
      seat.occupant = null;
      a.seat = null;
      var ms = walkMs(seat.x, GEO.offX, SEAT_WALK_MIN_PER_PCT);
      move(a, GEO.offX, GEO.walkY, ms);
      later(function () { removeActor(a); }, ms);
      pullFromQueue();
    }, gm(LEAVE_WAIT_MIN));
  }

  // ---------- v10-3: 送り出し(客の湧き)。帯の開始時にその帯ぶんを一括で予約する ----------
  // 「その日・その帯に来る客数を週客数から逆算し、実際にその人数だけ湧かせる」への対応。
  // week次のschedule(js/scoring.jsのweeklyBandSchedule)から、今日の曜日×この帯の内訳を取り出し、
  // 到着時刻を帯の中盤に寄せて(2つの一様乱数の平均≒三角分布)個別にlater()で予約する。
  // 確率で間引く仕組みは無い(誰か1人でも来なくなると週の合計とズレるため、全員を必ず湧かせる)。
  function openBand(bandKey) {
    if (!stage || !state) return;
    var band = U.bandDef(bandKey);
    if (!band) return;
    var dow = U.dow(state.day);
    var counts = (traffic.schedule && traffic.schedule[dow] && traffic.schedule[dow][bandKey]) || {};
    var durationMs = gm((band.end - band.start) * 60); // ゲーム内分→1x基準ms。実際の速さはlater()側で調整される
    Object.keys(counts).forEach(function (segId) {
      var n = counts[segId];
      for (var i = 0; i < n; i++) {
        var t = (Math.random() + Math.random()) / 2; // 中盤に寄せた到着時刻(0〜1)
        later(function () { spawnCustomer(segId); }, t * durationMs);
      }
    });
  }

  // 帯が終わる瞬間。今のところ特別な後処理はしていない(この帯の到着予定は既に上のopenBandで
  // 帯の範囲内に収まるよう予約済みなので、閉店の瞬間に残っているのは接客中・行列中の客だけ。
  // それらは既存の自然な退店・行列諦めの仕組みに任せる)。将来、帯終了で行列を強制的に
  // 解散させたくなった場合はここに書く。
  function closeBand(bandKey) { /* noop */ }

  // v13-1: 店員の往復は(客と同じく)move()/later()で駆動するようになったため、CSSキーフレーム用の
  // animationDuration/Delayはもう不要(廃止)。ここでは一時停止クラスの反映とretime()だけ行う。
  function syncSpeed() {
    if (stage) stage.classList.toggle("paused", paused());
    retime(); // v12-1: 速度が変わっていれば、画面上の客の残り時間もここで追随させる
  }

  // ---------- 外部API ----------
  // callbacks: { onEnter(segId) v12-3(客が入店した瞬間), onExit(segId, price) v13-3(客が退店した瞬間。
  // その客ぶんの売価=priceOwedを渡す) }
  function mount(container, gameState, callbacks) {
    state = gameState;
    onEnterCb = (callbacks && callbacks.onEnter) || null;
    onExitCb = (callbacks && callbacks.onExit) || null;
    clearTimers();
    stage = h("div", { className: "shop-stage" });
    container.appendChild(stage);
    builtSig = "";
    curSpd = spd();
    ensureBuilt();
  }

  function ensureBuilt() {
    var counts = seatCounts();
    var sig = state.property + "|" + state.equipment.slice().sort().join(",") + "|" +
      state.staffHired.slice().sort().join(",") + "|" + counts.counter + "/" + counts.table;
    if (sig === builtSig) return;
    builtSig = sig;
    clearTimers(); // v10-3: 組み直すと、その帯の予約済みだった到着もろとも消える(既知の割り切り。
    // 設備購入などで帯の途中にシーンを作り直すと、その帯の客が少なめに見えることがある)
    buildScenery();
  }

  // finance / customers は週次計算の結果。schedule はその内訳を「曜日×帯」へ配分したもの
  // (js/scoring.jsのweeklyBandSchedule)。無い場合(開業直後、まだ1週目の計算前)は空の店にする。
  function update(gameState, finance, customers, schedule) {
    state = gameState;
    if (!stage) return;
    ensureBuilt();

    traffic.schedule = schedule || null;
    traffic.queueLevel = customers ? customers.queueLevel : 0;
    // v13-3: 1杯あたり所持金へ加算する額。既存の週次収支(finance.revenue)を今週の客数で均等割り
    // しているだけで、新しい金額は作っていない(全客層とも同じ価格setで支払う前提は既存の計算と同じ)。
    traffic.pricePerCustomer = (finance && finance.totalCustomers > 0) ? finance.revenue / finance.totalCustomers : 0;

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
    kitchenWorkers = [];
    orderQueue = [];
    orderSeq = 0;
    orderPileEl = null;
    activePopups = 0;
    builtSig = "";
    frozen = false;
    onEnterCb = null;
    onExitCb = null;
    traffic = { schedule: null, queueLevel: 0, satBySeg: {}, pricePerCustomer: 0 };
  }

  // v09-1: 中央のpauseReasons(js/screens/loop.js)から呼ばれる、唯一の一時停止スイッチ。
  function setPaused(on) { if (on) freeze(); else unfreeze(); }

  return {
    mount: mount, update: update, syncSpeed: syncSpeed, destroy: destroy, setPaused: setPaused,
    openBand: openBand, closeBand: closeBand
  };
})();
