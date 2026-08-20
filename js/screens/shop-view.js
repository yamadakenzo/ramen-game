// 店舗の斜め上視点(アイソメトリック)とアニメーション。
// v32(docs/指示書/v32_斜め上視点_指示書.md): 横から見た断面図(枠線+ベタ塗り+絵文字)から、
// img/stage/(floor.webp下地 + 家具・人・丼を画像で重ねる)へ作り直した。
// 客・従業員・設備・物件の絵は v31 で img/ に入れたものをそのまま使う(新しく作らない)。
//
// 座標系: x は舞台幅に対する%、y は舞台高さに対する%。斜め上視点なので「奥へ進む」動きは
// x・yが同時に動く(横から見た旧版のように一方向だけの移動ではない)。
// v32(§3-1): 座標は GEO の1箇所だけが出典。CSS(css/style.css の .sv-*)には座標(top/left/
// width/height)を一切持たせない。壁・床・カウンター・券売機も含め、位置はすべてここから
// JSがインラインstyleで書く。CSSに残すのは色・枠線・角丸・トランジション・アニメーションだけ
// (v02から続いていた「GEOとCSSの座標二重管理」はこれで解消。詳細はdocs/設計判断記録.md §42)。
window.ShopView = (function () {
  var h = window.UI.h;
  var U = window.Utils;
  var AI = window.AssetImage;
  var SEGMENTS = window.DATA.segments.segments;
  var STAFF = window.DATA.characters.staff;
  var EQUIP = window.DATA.property.equipment;

  // v32: 斜め上視点の間取り(img/stage/floor.webpの絵に合わせて実測した座標)。
  // 各地点は{x,y}(舞台%)。線状に並べる場所(カウンター・テーブル・行列)は始点/終点の
  // 2点だけを持ち、isoSpread()で等間隔に割り付ける(旧spread()の2D版)。
  var GEO = {
    door: { x: 23, y: 53 },   // 入口(暖簾の足元、床の切れ目)
    off: { x: 23, y: 107 },   // 画面外(退場・湧き出し先)。入口の真下(overflow:hiddenで隠れる)
    kitchenHome: { x: 72, y: 36 }, // 厨房担当の定位置の基準(タイル側、奥の壁寄り。カウンターより
                                    // 十分奥<yが小さい>に置き、カウンターの絵と重なって隠れないようにする)
    soup: { x: 88, y: 34 },        // 寸胴/鍋
    noodle: { x: 78, y: 31 },      // 茹で麺器(無い場合の代役も同じ位置を使う)
    plate: { x: 62, y: 43 },       // 盛り付け台=受け渡し口(カウンター客はここが受け取り場所そのもの)
    hallHome: { x: 48, y: 50 },    // ホール担当の定位置(受け渡し口のすぐ手前)
    // カウンター客席は受け渡し口の手前(ウッド床側)に並べる。線の始点/終点は
    // 実測(img/stage/floor.webpの木目床とタイルの境界に沿わせた)。
    counterLine: { x0: 42, y0: 53, x1: 80, y1: 60 },
    counterSeatOffset: { dx: 0, dy: 2 },  // カウンター本体(絵)に対する客の座り位置の微調整(手前へ)
    // テーブル席(img/equipment/table_seats.webpを1卓ぶんの絵として使う)は手前の板張り床に置く。
    tableLine: { x0: 10, y0: 60, x1: 32, y1: 67 },
    // 行列: 入口のすぐ内側から、壁沿い(手前)へ短い列を作る。GEO.queueColsで折り返す。
    queueOrigin: { x: 13, y: 54 },
    queueColStep: { dx: -1.8, dy: 2.6 },  // 列の中で1人ずつ進む方向(手前へ)
    queueRowStep: { dx: 6, dy: 1 },       // 列が埋まったら次列(奥側へ少し戻ってずらす)
    queueCols: 4,
    drawMaxTable: 4 // テーブル側は実際の卓数より多くは描かない(絵は代表表示。v24からの既存方針)
  };

  // v12-1: 各フェーズの尺は「ゲーム内で何分か」で持ち、gm()でwindow.BASE_HOUR_MS(js/utils.js の
  // 1箇所だけ)から実ms(×1基準)を作る。later()/move()は1x基準のmsを受け取って内部でspd()で
  // 割る作りなので、ここでも1x基準のまま渡す(実時間へは変換しない)。
  // 下の分数値は、旧基準(1時間=5000ms@×1)のときに実際に使っていた実秒の直値を「その時点で
  // 何ゲーム内分だったか」に換算しただけで、体感の尺そのものは変えていない
  // (BASE_HOUR_MSを変えても客の動きが速すぎ/遅すぎにならないようにするための書き換え)。
  var OLD_MS_PER_MIN = 5000 / 60; // 換算の物差し。以後この値そのものを直接使うことはない
  var WALK_MIN_PER_PCT = 22 / OLD_MS_PER_MIN;        // 通常の歩行、距離1%あたりの分
  var SEAT_WALK_MIN_PER_PCT = 20 / OLD_MS_PER_MIN;   // 席へ向かう/席から出るときの歩行
  var ENTER_EXTRA_MIN = 200 / OLD_MS_PER_MIN;        // 席へ向かう前の一拍
  var SIT_MIN = 420 / OLD_MS_PER_MIN;                // 席に着く/席を立つ(間合いの一拍)
  var LEAVE_WAIT_MIN = 460 / OLD_MS_PER_MIN;         // 席を立ってから実際に歩き出すまでの間
  var QUEUE_REFLOW_MIN = 500 / OLD_MS_PER_MIN;       // 行列の詰め直し
  // v16-2/3: 我慢の限界。「並んで待つ」「着席して丼を待つ」の両方でこの1本だけを使う
  // (指示書3番「別々の仕組みを作らない」への対応。v15までは行列側は確率判定、着席側は決定的な
  // タイマーと、別の仕組みが2つあった)。新しい数値は増やさず、既存の客層データ(queue_tolerance)
  // だけで個体差を付ける。v15時点の値(48〜156分)は、通常営業(従業員2人・満席でない)でも
  // 頻発するほど短すぎたため、v16で十分に長く取り直した(150〜300分。詳細はPROGRESS.md参照)。
  var PATIENCE_BASE_MIN = 150;
  var PATIENCE_TOL_MIN = 150;
  var MEAL_MIN_MIN = 2500 / OLD_MS_PER_MIN;          // 提供+食事(最短)。約30分
  var MEAL_MIN_MAX = 3500 / OLD_MS_PER_MIN;          // 提供+食事(最長)。約42分
  var RESUME_FLOOR_MIN = 200 / OLD_MS_PER_MIN;       // 一時停止/速度変更からの再開時の最短尺
  var RESUME_Y_MIN_PER_PCT = 6 / OLD_MS_PER_MIN;     // 同、縦移動ぶんの上乗せ(%あたり)
  // v13-1: 厨房の作業ポーズの基準値(ゲーム内分)。
  // v28-2(docs/指示書/v28-2追補2_移動時間を含めた目標間隔の実現.md §J)以降、これらは
  // 「pace=1のときの基準値」としてのみ使う。実際の所要時間は目標間隔(targetIntervalMin()、
  // Scoring.staffProcessingCapacity()由来のW、window.Scoring.totalSeats()×
  // window.SEATS_TO_WEEKLY_CAPACITY由来のSから決まる)へ一致するよう、移動時間も含めて
  // 一律にスケールする(runSoloCycle/runKitchenCycle/runHallCycleが1件ごとにpaceを逆算する)。
  // 従業員個人の能力(旧5能力)は絵の速度からは参照しない——Wを決める新4能力と二重に効かせない
  // ため(同追補§J後半)。ここは「絵の忙しさ」のためだけの尺で、週次計算には一切フィードバック
  // しない(この原則自体はv13から変わっていない)。
  var KITCHEN_STATION_MIN = 2.5; // 中継地点(スープ/麺/盛り付け)1箇所あたりの作業ポーズの基準
  var KITCHEN_HANDOFF_MIN = 1;   // 客に渡す一拍の基準
  // v28-2: 週の営業ゲーム分(BANDSの合計×7日)。既存のwindow.BANDSから導出するだけで、
  // 新しい数値は増やさない。他のファイル(loop.js)もDAYS_PER_WEEK=7を前提にしている
  // (週7日はゲーム全体の既存の前提であり、ここで新設する定数ではない)。
  var WEEK_OPERATING_MIN = (window.BANDS || []).reduce(function (s, b) { return s + (b.end - b.start) * 60; }, 0) * 7;

  function gm(min) { return U.gameMinMs(min); }

  var stage = null;      // 舞台のDOM
  var actorLayer = null; // 客・店員を載せるレイヤー
  var state = null;
  var seats = [];        // {x, y, kind, occupant}
  var actors = [];       // 客
  var staffActors = [];  // 互換用。実体はkitchenWorkers(下)
  var queue = [];        // 入店待ちの客
  // v13-1/v14-5: 厨房・ホールの作業動線。1人 = state.staffHired の1人ぶん。
  var kitchenWorkers = []; // {id, def, el, gone, busy, homeX, homeY, curX, curY, role: "kitchen"|"hall"|"both"}
  var orderQueue = [];     // {id, seat, actor} まだ厨房が着手していない注文
  var readyQueue = [];     // {id, seat, actor} 盛り付け済みで、ホールが客席へ運ぶのを待っている丼(=丼の山)。
                            // v32(§37): カウンター席の注文はここを経由せず厨房から直接届ける(下記参照)。
  var orderSeq = 0;
  var orderPileEl = null;  // 積まれた丼を表示するDOM
  var timers = [];       // {fn, remaining(ms), id, startedAt} v09: 残り時間を持たせ、凍結中は完全に止める
  var builtSig = "";
  // v24(指示書§3-3): 前回buildScenery()時点で描いていたカウンター席の所持数。nullは
  // 「まだ一度も描いていない」(=初回描画では席をポップさせない。読み込み直後の6席が
  // いきなり跳ねて出るのを防ぐため)。
  var prevDrawnCounter = null;
  var STOOL_POP_STAGGER_MS = 150; // §3-2手順3: 1席あたり0.15秒間隔(card-reveal.jsのSTAGGER_MSと揃える)
  function reducedMotionSV() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  // v10-3: 週次のcomputeWeeklyCustomersの結果を「曜日×帯」へ配分したもの(js/scoring.jsの
  // weeklyBandSchedule)。openBand()がここから今日・その帯ぶんを取り出して実数だけ湧かせる。
  // 以前あった traffic.pool/occupancy(Math.pow で稼働率を持ち上げる演出)は廃止した
  // (客数と絵が一致しない原因そのものだったため。v10指示3)。
  // v26(追補§B-2): weekは客が湧いた時点の週番号(a.spawnWeekへ渡す元)。priceOwedと同じ経路で
  // traffic経由に1キー足すだけ(新しい仕組みは増やさない)。
  // v28-2: targetIntervalは絵の配膳1杯あたりの目標ゲーム分(T=WEEK_OPERATING_MIN÷min(W,S))。
  // 週替わり・設備/座席購入のたびにupdate()で再計算する(pricePerCustomer/weekと同じ経路)。
  var traffic = { schedule: null, queueLevel: 0, satBySeg: {}, pricePerCustomer: 0, week: 0, targetInterval: WEEK_OPERATING_MIN };
  // v09-1: 中央の pauseReasons(js/screens/loop.js)から setPaused() で渡される、唯一の一時停止フラグ。
  // 以前は state.speed===0 を「止まっている」の代用にしていたが、v09で速度の選択と一時停止を
  // 分離したため(停止中でも「選んでいる速度」自体は保持し続ける)、ここでは専用のフラグを持つ。
  var frozen = false;
  // v12-1: 直近にsyncSpeed()した時点の速度。これと今のspd()がズレていたら「速度が変わった瞬間」と
  // 判定し、画面上の客の残り時間・移動もその場で新しい速度に追随させる(retime())。
  var curSpd = 1;
  // v13-3/v16-1: 丼が客の席に届いた瞬間(deliverToSeat)にloop.js側へ知らせる。その客のpriceOwedを渡す。
  // (v15まではfinishMeal=食べ終わった瞬間だった。v16でタイミングを配膳の瞬間に変更)
  var onServeCb = null;
  // v15-1/6: 客ごとの一生をログに残す(調査用・確認用)。新しい客数計算は一切しない、
  // 既存の状態遷移が起きた時刻を記録するだけの読み取り専用ログ。
  var lifecycleLog = [];
  var custSeq = 0;
  function nowLabel() {
    return U.calMonth(state.day) + "/" + U.dayOfMonth(state.day) + "(" + U.dowLabel(state.day) + ") " + U.timeLabel(state.clockMin);
  }
  function logLifecycle(a) {
    lifecycleLog.push({
      客: "#" + a.id, 客層: (segDef(a.segId) || {}).name || a.segId,
      着席: a.seatedAt || "", 注文: a.orderedAt || "", 丼受取: a.deliveredAt || "",
      食事開始: a.eatStartAt || "", 退店: a.exitAt || "", 退店理由: a.exitReason || ""
    });
  }

  function spd() { return state && state.speed > 0 ? state.speed : 1; }
  function paused() { return frozen; }

  // v32: y座標(舞台%)から重なり順(z-index)を作る、唯一の関数。「奥にあるものほど先に描く」を
  // 満たすため、静物(buildScenery時に1回だけ計算)・俳優(move()のたびに計算)の両方がこれを通す。
  // 係数10は0〜100%を0〜1000の整数へ広げるだけ(層の余地を確保するため。特別な意味は無い)。
  // 基準値100を足しているのは、床(floor.webp、z-index無し=0扱い)より必ず上に来るようにするため。
  function zForY(y) { return 100 + Math.round((y || 0) * 10); }

  // 2点間を(2軸とも動く前提で)n個の等間隔点に割り付ける。旧spread()(横1軸だけ)の2D版。
  function isoSpread(n, p0, p1) {
    var pts = [];
    if (n <= 0) return pts;
    if (n === 1) return [{ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }];
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1);
      pts.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });
    }
    return pts;
  }

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
    move(a, tgtX, tgtY, Math.max(gm(RESUME_FLOOR_MIN), walkMs2(curX, curY, tgtX, tgtY)));
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

  // v24(docs/指示書/v24_席の設備化とプレゼント演出_指示書.md §2-4、
  // docs/指示書/v24_追補_調査への回答と追加指示.md §2): カウンター席は物件の固定値ではなく
  // 持ち物(state.seats.counter)。counterSlotsは物件が持つ「置ける上限」(枠の数)、
  // counterは実際に描く丸椅子の数(所持数、上限で頭打ち)。テーブル側は既存のまま変更していない。
  // v32(§1-2/§3-2、懸念11): テーブル席+4の計算はここでは行わず、Scoring.tableSeats()を読むだけ
  // にした(以前はここに"has('table_seats')?4:0"という同じ式が別に書かれていた二重管理だった)。
  function seatCounts() {
    var p = window.Scoring.getProperty(state);
    if (!p) return { counter: 0, counterSlots: 0, table: 0 };
    var owned = (state.seats && state.seats.counter) || 0;
    return {
      counter: Math.min(p.counterSlots, owned),
      counterSlots: p.counterSlots,
      table: Math.min(GEO.drawMaxTable, window.Scoring.tableSeats(state))
    };
  }

  // v32: idとcategoryから直接img/配下のパスを作って画像ノードを返す(v31のwindow.AssetImage.node()
  // はデータ定義(emoji/img)を持つ"def"を前提にしているため、店内固有の小物(丼・表情・家具)には
  // 疑似的なdefを作って渡す。読み込み失敗時のフォールバックもAssetImage側の仕組みがそのまま効く)。
  // idがnull/undefinedのときは絵が用意されていないものとして扱い、最初から絵文字のみを返す
  // (架空のファイル名を作って毎回読み込み失敗させない)。
  function stageDef(id, emojiFallback) {
    return id ? { img: "stage/" + id, emoji: emojiFallback, name: "" } : { emoji: emojiFallback, name: "" };
  }

  function block(cls, style, children) {
    return h("div", { className: cls, style: style }, children || []);
  }

  // 静物を(x,y)に置く。z-indexはyから自動計算する(zForY、店の躯体・俳優共通の1つの関数)。
  function placeAt(el, x, y) {
    el.style.left = x + "%";
    el.style.top = y + "%";
    el.style.zIndex = zForY(y);
    return el;
  }

  function buildScenery() {
    window.UI.clear(stage);
    seats = [];
    actors = [];
    staffActors = [];
    queue = [];

    var counts = seatCounts();

    // 下地(1枚絵)。v32: 壁・床・出入口はすべてこの絵の中に描かれている(旧版のようにCSSの
    // 箱を積んで作らない)。z-indexは付けない(0扱い=必ず一番奥)。
    var floorImg = AI.node(stageDef("floor"));
    floorImg.className = "sv-floor-img";
    stage.appendChild(floorImg);

    actorLayer = block("sv-actors", {});
    stage.appendChild(actorLayer);

    // 天井の設備(壁に埋め込まれた下地には無いので、小物として重ねる)。ランプ自体は常設の
    // 装飾(専用の絵は無い)なので絵文字のまま。「明るい照明」を導入していると数が増える
    // (既存の演出、v14以来変更なし)。
    var lampSpots = has("bright_light") ? [{ x: 30, y: 26 }, { x: 50, y: 22 }, { x: 68, y: 27 }] : [{ x: 50, y: 22 }];
    lampSpots.forEach(function (spot) {
      var el = block("sv-lamp", {}, [AI.node(stageDef(null, "💡"))]);
      placeAt(el, spot.x, spot.y);
      stage.appendChild(el);
    });
    if (has("exhaust")) {
      var ductEl = block("sv-duct", {}, [AI.node(U.findById(EQUIP, "exhaust"))]);
      placeAt(ductEl, 12, 30);
      stage.appendChild(ductEl);
    }

    // 厨房設備(タイル側の奥の壁沿い)。既製品(big_pot/noodle_boiler/extra_boiler)は
    // v31のimg/equipment/を使い、常設の寸胴(未購入時のベース)だけは絵が無いので絵文字のまま。
    var kit = [{ x: GEO.soup.x - 4, y: GEO.soup.y + 8, def: stageDef(null, "🍥") }];
    if (has("big_pot")) kit.push({ x: GEO.soup.x, y: GEO.soup.y, def: U.findById(EQUIP, "big_pot") });
    if (has("noodle_boiler")) kit.push({ x: GEO.noodle.x, y: GEO.noodle.y, def: U.findById(EQUIP, "noodle_boiler") });
    if (has("extra_boiler")) kit.push({ x: GEO.noodle.x + 8, y: GEO.noodle.y - 4, def: U.findById(EQUIP, "extra_boiler") });
    kit.forEach(function (k) {
      var el = block("sv-kit-item", {}, [AI.node(k.def)]);
      placeAt(el, k.x, k.y);
      stage.appendChild(el);
    });
    // v13-1/v14-5: 盛り付け済みでホールが運ぶのを待っている丼が積まれて見える場所
    // (受け渡し口=GEO.plateのすぐ奥)。v32(§37): カウンター客の丼はここを経由せず直接届くため、
    // ここに積まれるのはテーブル客ぶんだけになる。
    orderPileEl = block("sv-order-pile", {});
    placeAt(orderPileEl, GEO.plate.x, GEO.plate.y - 8);
    stage.appendChild(orderPileEl);
    if (has("multilingual")) {
      var signEl = block("sv-wall-sign", {}, [AI.node(U.findById(EQUIP, "multilingual"))]);
      placeAt(signEl, 46, 33);
      stage.appendChild(signEl);
    }
    if (has("pos")) {
      var posEl = block("sv-kit-item", {}, [AI.node(U.findById(EQUIP, "pos"))]);
      placeAt(posEl, 60, 44);
      stage.appendChild(posEl);
    }

    // カウンター本体(1枚を受け渡し口の手前に大きめに置く。実際の座席数に応じて伸び縮みはしない
    // ——既存のsv-kitchen-counterと同じく「代表表示」の1枚絵)。
    var counterEl = block("sv-counter-img", {}, [AI.node(stageDef("counter"))]);
    placeAt(counterEl, (GEO.counterLine.x0 + GEO.counterLine.x1) / 2, (GEO.counterLine.y0 + GEO.counterLine.y1) / 2 - 3);
    stage.appendChild(counterEl);

    // カウンター席の丸椅子。
    // v24(指示書§3-5、追補§2): 枠(物件のcounterSlots)を先に等間隔で確保し、所持している席
    // (counts.counter)だけを左から順に埋める。空き枠には席を描かない(カウンターだけが見える)。
    // こうすると席を1つ足しても既にある席は動かない。
    // §3-3: 前回描画時より所持数が増えていたら、増えた席にだけポップ用のクラス+✨を付ける
    // (チュートリアルのプレゼント演出・§5の購入演出、どちらもこの1つの仕組みで賄う)。
    var slots = isoSpread(counts.counterSlots,
      { x: GEO.counterLine.x0, y: GEO.counterLine.y0 }, { x: GEO.counterLine.x1, y: GEO.counterLine.y1 });
    var isFirstBuild = prevDrawnCounter == null;
    var rm = reducedMotionSV();
    var popIndex = 0;
    for (var si = 0; si < counts.counter; si++) {
      var sp = slots[si];
      var sx = sp.x + GEO.counterSeatOffset.dx, sy = sp.y + GEO.counterSeatOffset.dy;
      var isNew = !isFirstBuild && si >= prevDrawnCounter && !rm;
      var stoolEl = block("sv-stool" + (isNew ? " sv-stool-pop" : ""), {}, [AI.node(stageDef("stool", "🪑"))]);
      placeAt(stoolEl, sx, sy);
      if (isNew) {
        var delay = (popIndex * STOOL_POP_STAGGER_MS) + "ms";
        stoolEl.style.animationDelay = delay;
        var sparkleEl = h("span", { className: "sv-stool-sparkle emoji-font", text: "✨" });
        sparkleEl.style.animationDelay = delay;
        stoolEl.appendChild(sparkleEl);
        popIndex++;
      }
      stage.appendChild(stoolEl);
      seats.push({ x: sx, y: sy, kind: "counter", occupant: null });
    }
    prevDrawnCounter = counts.counter;

    // テーブル席。v32: v31のimg/equipment/table_seats.webp(卓+丸椅子2脚が1枚に描かれた絵)を
    // 1卓ぶんの代表表示として使う(専用のテーブル画像はv32では作っていないため。指示書§2の
    // 「客・従業員・設備・物件の絵はv31のものをそのまま使う」に沿った判断)。1枚=2席として数える。
    if (counts.table > 0) {
      var tableCount = Math.ceil(counts.table / 2);
      var tPts = isoSpread(tableCount,
        { x: GEO.tableLine.x0, y: GEO.tableLine.y0 }, { x: GEO.tableLine.x1, y: GEO.tableLine.y1 });
      var tableDef = U.findById(EQUIP, "table_seats");
      var seatIdx = 0;
      tPts.forEach(function (pt) {
        var tEl = block("sv-table-img", {}, [AI.node(tableDef)]);
        placeAt(tEl, pt.x, pt.y);
        stage.appendChild(tEl);
        for (var k = 0; k < 2 && seatIdx < counts.table; k++, seatIdx++) {
          seats.push({ x: pt.x + (k === 0 ? -3 : 3), y: pt.y + 2, kind: "table", occupant: null });
        }
      });
    }

    // 券売機は入口の内側。
    if (has("ticket_machine")) {
      var ticketEl = block("sv-ticket", {}, [AI.node(U.findById(EQUIP, "ticket_machine"))]);
      placeAt(ticketEl, GEO.door.x + 14, GEO.door.y + 2);
      stage.appendChild(ticketEl);
    }

    var prop = window.Scoring.getProperty(state);
    var signboardEl = block("sv-signboard", {}, [
      AI.node(prop || stageDef(null, "🏪")),
      h("span", { text: prop ? prop.name : "" })
    ]);
    placeAt(signboardEl, 88, 20);
    stage.appendChild(signboardEl);

    stage.className = "shop-stage" + (has("bright_light") ? " bright" : "");

    buildStaff();
  }

  // v14-5: 店員の役割を「厨房」「ホール」に分ける(プレイヤーには選ばせない。既存の接客能力から
  // 自動で決める)。2人以上いれば接客(service)が最も高い1名をホール・残りを厨房、1人なら兼任。
  // 役割は既存の従業員能力(effectiveStat。「教える」の伸びも反映済み)を読むだけで、新しい設定項目・
  // 新しい数値は一切増やしていない。定位置(homeX/homeY)も役割ごとに分け、厨房は寸胴側、ホールは
  // 受け渡し口(GEO.plate)寄りに置く(1人兼任のときは厨房側の定位置のまま)。
  function assignRoles(workers) {
    if (workers.length >= 2) {
      var bestIdx = 0;
      for (var i = 1; i < workers.length; i++) {
        if (effectiveOf(workers[i], "service") > effectiveOf(workers[bestIdx], "service")) bestIdx = i;
      }
      workers.forEach(function (w, idx) { w.role = (idx === bestIdx) ? "hall" : "kitchen"; });
    } else {
      workers.forEach(function (w) { w.role = "both"; });
    }
  }

  function effectiveOf(w, key) {
    var bonus = state.staffState && state.staffState[w.id] && state.staffState[w.id].statBonus;
    return window.Scoring.effectiveStat(w.def, bonus, key);
  }

  // v13-1: 店員1人 = 厨房またはホールで働く1人ぶんの俳優(kitchenWorkers。名前はv13のまま、
  // 実際には両役割を含む)。移動はcustomerと同じmove()/later()を使うので、一時停止・速度追随は
  // movingActors()経由でそのまま効く。
  function buildStaff() {
    staffActors = [];
    kitchenWorkers = [];
    orderQueue = [];
    readyQueue = [];
    var workers = state.staffHired.map(function (id) {
      var def = window.Scoring.findStaffDef(state, id); // STEP6: スカウト勢も対象に含める
      return def ? { id: id, def: def } : null;
    }).filter(Boolean);
    assignRoles(workers);
    var kitchenSpots = isoSpread(workers.filter(function (w) { return w.role !== "hall"; }).length,
      { x: GEO.kitchenHome.x - 6, y: GEO.kitchenHome.y - 4 }, { x: GEO.kitchenHome.x + 6, y: GEO.kitchenHome.y + 4 });
    var kIdx = 0;
    workers.forEach(function (w) {
      var home = w.role === "hall" ? GEO.hallHome : (kitchenSpots[kIdx++] || GEO.kitchenHome);
      var el = h("div", { className: "sv-staff" }, [
        h("span", { className: "sv-body" }, [AI.node(w.def)]),
        h("span", { className: "sv-bowl" }, [AI.node(stageDef("bowl", "🍜"))])
      ]);
      placeAt(el, home.x, home.y);
      el.dataset.x = home.x;
      actorLayer.appendChild(el);
      w.el = el; w.gone = false; w.busy = false; w.homeX = home.x; w.homeY = home.y; w.curY = home.y;
      kitchenWorkers.push(w);
      staffActors.push(el);
    });
    renderReadyPile();
    dispatchOrders();
    syncSpeed();
  }

  // ---------- v13-1/v14-5: 厨房の作業動線(寸胴→茹で麺器→盛り付け→[受け渡し口]→客席→戻る) ----------
  // 「絵は計算を決めない」の指示どおり、ここは既に計算済みの値(客の入店タイミング=既存の週次客数を
  // 帯へ配分したスケジュール由来、traffic.targetInterval=Scoring.staffProcessingCapacity()由来の
  // Wと座席数から導出した目標間隔)を読むだけで、ここから週次計算(scoring.js)側へ書き戻すことは
  // 一切しない。v28-2(追補2§J)以降、従業員個人の能力(旧5能力)は絵の速度からは参照しない
  // (Wを決める新4能力と二重に効かせないため。assignRoles()の役割選定だけは既存のまま
  // effectiveOf()=旧5能力を使い続ける。触れない範囲)。
  //
  // v14-5: 役割を「厨房」(寸胴→茹で麺器→盛り付け→受け渡し口に置く)と「ホール」(受け渡し口の丼を
  // 取る→客席へ運ぶ→戻る)に分けた。1人だけの店は兼任(runSoloCycle。v13までと同じ、作って自分で
  // 運んで戻るの一続き)。厨房・ホールで別々に動くのは2人以上のときだけ(runKitchenCycle/runHallCycle、
  // orderQueue=厨房が未着手の注文/readyQueue=盛り付け済みでホール待ちの丼、の2段構え)。
  // v32(§37、指示書§3-3): カウンター席(kind==="counter")は受け渡し口のすぐそばという設定に
  // 合わせ、盛り付けた瞬間に直接提供する(ホールの客席までの往復を挟まない)。テーブル席
  // (kind==="table")は今までどおりホールが運ぶ。seats.kindを初めて読む箇所がここ。
  var KITCHEN_PILE_MAX = 6; // 積める丼アイコンの表示上限(それ以上は「+N」で表す)
  // v15-2: 「待機中(丼がまだ届いていない)」の我慢の限界。v14-5にあった60分の安全弁は
  // 「強制的に食べさせる」処理だったため、丼を受け取っていない客が満足顔で帰る不具合の原因に
  // なっていた(v15指示書 0番)。ここでは「食べ始めさせる」のではなく「怒って帰らせる」に統一する。
  // v16: 我慢の限界の実体(PATIENCE_BASE_MIN/TOL_MIN)は行列側と共有(ファイル冒頭で定義)。
  // 従業員0人(異常系)・注文ロストのときもここで必ず時間切れになり、無限に待ち続けることはない
  // (v14-5にあった「0人なら即座に食べ始める」特例は廃止済み——丼が無いのに食べ始めるのは、
  // 0人でも他の異常系でも同じく誤りのため)。

  // v14-5: 「厨房が遅い→受け渡し口に丼が無い」「ホールが足りない→受け渡し口に丼が積み上がる」と
  // 詰まっている場所によって絵が変わるようにするため、v13で入れた「丼の山」はホール側の詰まり
  // (=盛り付け済みで運ばれるのを待っているreadyQueue)を表すものとして位置づけ直した
  // (厨房側の未着手の注文=orderQueueには専用の絵を足していない。客が席で待ったままなのが
  // 「厨房が遅い」の見え方になる)。v32: カウンター客ぶんはここに積まれない(直接提供のため)。
  function renderReadyPile() {
    if (!orderPileEl) return;
    window.UI.clear(orderPileEl);
    var n = readyQueue.length;
    var shown = Math.min(n, KITCHEN_PILE_MAX);
    for (var i = 0; i < shown; i++) {
      orderPileEl.appendChild(h("span", { className: "sv-pile-bowl" }, [AI.node(stageDef("bowl", "🍜"))]));
    }
    if (n > KITCHEN_PILE_MAX) {
      orderPileEl.appendChild(h("span", { className: "sv-pile-more", text: "+" + (n - KITCHEN_PILE_MAX) }));
    }
  }

  // 客が入店した瞬間(=席へ向かい始めた瞬間)に「注文」を1件発生させる。手が空いている厨房担当が
  // いればすぐに掴む。全員手一杯なら(厨房側は絵を出さず)客が席で待ったままになる。
  // v14-5: 客の実体(actor)も持たせておき、配膳時に「まだその客がその席にいるか」を確認できるようにする。
  function placeOrder(seat, actor) {
    orderQueue.push({ id: ++orderSeq, seat: seat, actor: actor });
    dispatchOrders();
  }

  function dispatchOrders() {
    kitchenWorkers.forEach(function (w) {
      if (w.gone || w.busy) return;
      if (w.role === "hall") return; // ホール専任は厨房の注文を取らない
      if (!orderQueue.length) return;
      var order = orderQueue.shift();
      if (w.role === "both") runSoloCycle(w, order); else runKitchenCycle(w, order);
    });
    kitchenWorkers.forEach(function (w) {
      if (w.gone || w.busy || w.role !== "hall") return;
      if (!readyQueue.length) return;
      var ready = readyQueue.shift();
      renderReadyPile();
      runHallCycle(w, ready);
    });
  }

  // v28-2(指示書§4、追補2§J): 絵の配膳能力をWから導出する。
  // traffic.targetInterval(T、update()で算出。ゲーム分/杯)から、店全体で一律の速度係数
  // (pace)を作る。従業員個人の能力(旧5能力)は参照しない——その能力は既にW
  // (Scoring.staffProcessingCapacity())に入っており、絵の側でも掛けると同じ能力が二重に
  // 効いてしまうため(追補2§J後半)。
  function targetIntervalMin() { return traffic.targetInterval || WEEK_OPERATING_MIN; }

  // 現在地(fromX,fromY)からある地点(toX,toY)までの「pace=1のときの」移動ゲーム分(1x基準ms)。
  // v32: 斜め上視点では移動が斜めになるため、x・y両方の距離を合成する(旧版はxだけ・yだけを
  // 別々に足すマンハッタン距離に近い式だったが、斜め移動の実態に合わせ直線距離にした)。
  function legBaseMs(fromX, fromY, toX, toY) {
    return walkMs2(fromX, fromY, toX, toY);
  }

  // moveWorker()と同じ移動を、渡されたpaceで一律にスケールして実行する(CSS遷移の尺と
  // later()の待ち時間を必ず一致させるため、スケールはここで一度だけ行う)。
  function moveWorker(w, x, y, pace) {
    var fromX = parseFloat(w.el.dataset.x != null ? w.el.dataset.x : x);
    var fromY = w.curY != null ? w.curY : GEO.kitchenHome.y;
    var travelMs = legBaseMs(fromX, fromY, x, y) / (pace || 1);
    move(w, x, y, travelMs);
    w.curY = y;
    return travelMs;
  }

  // 客がまだその席で待っているときだけ、実際に食べ始めさせる(丼が届くまで食べない)。
  // 客が先に帰っていた(seat.occupantが入れ替わっている/空いている)場合は、その丼は
  // 静かに廃棄する(v15-3。作り直しのループは作らない——ここでは何もしないだけ)。
  // v16-1: 所持金・売上は「丼が客の席に置かれた瞬間」であるここで加算する(以前はfinishMeal、
  // つまり食べ終わった瞬間だった。待ちきれず帰った客は元々ここへ来ないので二重取りではないが、
  // 「食べ終わるまでの30〜40分ぶん、実際の受け渡しと所持金の増加がずれて見える」ことが
  // 「怒って帰った客の分も売上に乗っているように見える」という体感の原因になっていた)。
  function deliverToSeat(order) {
    var seat = order.seat, a = order.actor;
    if (!a || a.gone || seat.occupant !== a) return;
    a.deliveredAt = nowLabel();
    // v26(追補§B-2): spawnWeekも渡す。loop.js側で今週の週番号と比較し、週をまたいで配膳された
    // 客(厨房が調理着手済みでclearSeatedWaiters()の安全弁が効かなかったケース)は金銭の加算だけ
    // スキップする。絵の配膳シーケンス(このあとのstartEating等)はそのまま完走させる。
    if (onServeCb) onServeCb(a.segId, a.priceOwed, a.spawnWeek);
    startEating(a);
  }

  // v15-3: 客ごとの注文を、厨房未着手(orderQueue)・盛り付け済みでホール待ち(readyQueue)の
  // 両方から取り除く。厨房が作業中(w.busy)の分はここでは止められないが、出来上がってもdeliverToSeat
  // が客の不在を検知して静かに捨てるので、作り直しのループにはならない。
  function cancelOrderFor(a) {
    orderQueue = orderQueue.filter(function (o) { return o.actor !== a; });
    var before = readyQueue.length;
    readyQueue = readyQueue.filter(function (o) { return o.actor !== a; });
    if (readyQueue.length !== before) renderReadyPile();
  }

  // v14-5: 兼任(1人)。v13までと同じ、寸胴→茹で麺器→盛り付け→客席→定位置、の一続き。
  // 客席へ届けた瞬間に食べ始めさせる(以前は席に着いてから固定時間で自動的に食べ始めていた)。
  // v28-2(追補2§J):「1人兼任(従業員1人)の場合=調理+ホール1サイクルの合計=目標間隔」。
  // 移動時間を含む全行程の合計がtargetIntervalMin()と一致するよう、pace(店全体で共通の速度係数)を
  // この1件ぶんの実際の距離から逆算する。個人の能力(旧5能力)は参照しない。
  // v32(§37): カウンター席は「客席へ運ぶ」を「受け渡し口=GEO.plateで直接手渡す」に短縮する
  // (実際には客がすぐそこに座っているという設定のため、盛り付け台から先の移動が要らない)。
  function runSoloCycle(w, order) {
    w.busy = true;
    w.el.classList.add("carrying");
    var target = targetIntervalMin();
    var fromX = parseFloat(w.el.dataset.x != null ? w.el.dataset.x : w.homeX);
    var fromY = w.curY != null ? w.curY : GEO.kitchenHome.y;
    var seat = order.seat;
    var isCounter = seat.kind === "counter";
    var stops = isCounter ? [
      { x: GEO.soup.x, y: GEO.soup.y, wait: 0 },
      { x: GEO.noodle.x, y: GEO.noodle.y, wait: 0 },
      { x: GEO.plate.x, y: GEO.plate.y, wait: 0, deliver: true }, // 受け渡し口=カウンター客への直接提供
      { x: w.homeX, y: w.homeY, wait: 0 }
    ] : [
      { x: GEO.soup.x, y: GEO.soup.y, wait: 0 },
      { x: GEO.noodle.x, y: GEO.noodle.y, wait: 0 },
      { x: GEO.plate.x, y: GEO.plate.y, wait: 0 },
      { x: seat.x, y: seat.y, wait: 0, deliver: true },
      { x: w.homeX, y: w.homeY, wait: 0 }
    ];
    var stationCount = isCounter ? 3 : 3; // 寸胴・茹で麺器・盛り付け(共通)
    var baseTravel = 0;
    var fx = fromX, fy = fromY;
    stops.forEach(function (s) { baseTravel += legBaseMs(fx, fy, s.x, s.y); fx = s.x; fy = s.y; });
    var baseWait = gm(KITCHEN_STATION_MIN) * stationCount + gm(KITCHEN_HANDOFF_MIN);
    var pace = (baseTravel + baseWait) / gm(target);
    var pauseMs = gm(KITCHEN_STATION_MIN) / pace;
    var handoffMs = gm(KITCHEN_HANDOFF_MIN) / pace;
    stops.forEach(function (s, i) {
      if (i === stops.length - 1) return; // 最後(定位置へ戻る)は待ちを付けない
      s.wait = s.deliver ? handoffMs : pauseMs;
    });
    function step(i) {
      if (w.gone) return;
      if (i >= stops.length) { w.busy = false; dispatchOrders(); return; }
      var s = stops[i];
      var travelMs = moveWorker(w, s.x, s.y, pace);
      later(function () {
        if (s.deliver) { w.el.classList.remove("carrying"); deliverToSeat(order); }
        step(i + 1);
      }, travelMs + s.wait);
    }
    step(0);
  }

  // v14-5: 厨房担当。寸胴→茹で麺器→盛り付けまでで、客席へは行かない。
  // v32(§37): テーブル客ぶんは今までどおりreadyQueueへ置いてホール待ちにするが、
  // カウンター客ぶんは盛り付けた瞬間にそのままdeliverToSeat()する(ホールを挟まない)。
  // v28-2(追補2§J):「厨房1人の1サイクル=目標間隔×厨房人数」。dispatchOrders()で人数比例に
  // 並列化される前提のため、1人あたりの持ち時間は目標間隔にその時点の厨房役割の人数を掛けた値。
  function runKitchenCycle(w, order) {
    w.busy = true;
    w.el.classList.add("carrying");
    var kCount = kitchenWorkers.filter(function (x) { return x.role === "kitchen"; }).length || 1;
    var target = targetIntervalMin() * kCount;
    var fromX = parseFloat(w.el.dataset.x != null ? w.el.dataset.x : w.homeX);
    var fromY = w.curY != null ? w.curY : GEO.kitchenHome.y;
    var baseTravel = legBaseMs(fromX, fromY, GEO.soup.x, GEO.soup.y) +
      legBaseMs(GEO.soup.x, GEO.soup.y, GEO.noodle.x, GEO.noodle.y) +
      legBaseMs(GEO.noodle.x, GEO.noodle.y, GEO.plate.x, GEO.plate.y);
    var baseWait = gm(KITCHEN_STATION_MIN) * 3;
    var pace = (baseTravel + baseWait) / gm(target);
    var pauseMs = gm(KITCHEN_STATION_MIN) / pace;
    var stops = [
      { x: GEO.soup.x, y: GEO.soup.y, wait: pauseMs },
      { x: GEO.noodle.x, y: GEO.noodle.y, wait: pauseMs },
      { x: GEO.plate.x, y: GEO.plate.y, wait: pauseMs }
    ];
    function step(i) {
      if (w.gone) return;
      if (i >= stops.length) {
        w.el.classList.remove("carrying");
        w.busy = false;
        if (order.seat.kind === "counter") {
          deliverToSeat(order); // v32(§37): 受け渡し口のすぐそばのカウンター客へ直接提供
        } else {
          readyQueue.push(order);
          renderReadyPile();
        }
        dispatchOrders(); // 次の注文と、待っているホール担当の両方へ回す
        return;
      }
      var travelMs = moveWorker(w, stops[i].x, stops[i].y, pace);
      later(function () { step(i + 1); }, travelMs + stops[i].wait);
    }
    step(0);
  }

  // v14-5: ホール担当。受け渡し口の丼を取る→客席へ運ぶ→受け渡し口寄りの定位置へ戻る。調理設備には触れない。
  // v32(§37): readyQueueにはもうテーブル客ぶんしか積まれない(カウンター客は厨房が直接届けるため)。
  // v28-2(追補2§B・§J):「ホール1サイクル=目標間隔」。常に1人(assignRoles()、変更なし)の
  // ため、この1サイクル(移動時間込み)がそのまま系全体のボトルネックになる。
  function runHallCycle(w, order) {
    w.busy = true;
    var target = targetIntervalMin();
    var fromX = parseFloat(w.el.dataset.x != null ? w.el.dataset.x : w.homeX);
    var fromY = w.curY != null ? w.curY : GEO.kitchenHome.y;
    var seat = order.seat;
    var baseTravel = legBaseMs(fromX, fromY, GEO.plate.x, GEO.plate.y) +
      legBaseMs(GEO.plate.x, GEO.plate.y, seat.x, seat.y) +
      legBaseMs(seat.x, seat.y, w.homeX, w.homeY);
    var baseWait = gm(KITCHEN_HANDOFF_MIN);
    var pace = (baseTravel + baseWait) / gm(target);
    var handoffMs = gm(KITCHEN_HANDOFF_MIN) / pace;
    var stops = [
      { x: GEO.plate.x, y: GEO.plate.y, wait: 0, pickup: true },
      { x: seat.x, y: seat.y, wait: handoffMs, deliver: true },
      { x: w.homeX, y: w.homeY, wait: 0 }
    ];
    function step(i) {
      if (w.gone) return;
      if (i >= stops.length) { w.busy = false; dispatchOrders(); return; }
      var s = stops[i];
      var travelMs = moveWorker(w, s.x, s.y, pace);
      later(function () {
        if (s.pickup) w.el.classList.add("carrying");
        if (s.deliver) { w.el.classList.remove("carrying"); deliverToSeat(order); }
        step(i + 1);
      }, travelMs + s.wait);
    }
    step(0);
  }

  // ---------- 客 ----------
  function segDef(id) { return U.findById(SEGMENTS, id); }

  // v16-2/3: 我慢の限界(ゲーム内分→1x基準ms)。行列(joinQueue)・着席後の待機(enterAndSit)の
  // どちらもこの1つだけを使う。客層ごとの行列耐性(queue_tolerance)だけで個体差を付け、
  // 新しいデータ項目は増やさない。
  function patienceMs(segId) {
    var def = segDef(segId);
    var tol = def ? def.weights.queue_tolerance : 0.5;
    return gm(PATIENCE_BASE_MIN + tol * PATIENCE_TOL_MIN);
  }

  // v32: 満足/普通/不満の3種(img/stage/face_*.webp)は、満足度の数値から選ぶだけ
  // (§0の逆流禁止どおり、絵から数値を作る経路は無い)。3段階の判定式自体は据え置き
  // (moodClassFor()と共有。閾値60/45は既存のまま変更していない)。
  var FACE_EMOJI = { good: "😄", neutral: "😐", bad: "😒" };
  function moodKeyFor(segId) {
    var sat = traffic.satBySeg[segId];
    if (sat == null) return "neutral";
    if (sat >= 60) return "good";
    if (sat >= 45) return "neutral";
    return "bad";
  }
  // v14-2: 絵文字が単色フォント(Noto Emoji)になり表情の区別が付きにくいため、faceFor()と
  // 同じ閾値で満足/普通/不満のクラス名を作り、CSS側(.sv-bubble.mood-*)で色を分ける。
  // v32: 表情そのものは画像(FACE_EMOJIはフォールバック用)になったが、🕐(丼待ち)・😡(退店)の
  // 吹き出しは引き続きこの色分けを使うので、クラスとしては残す。
  function moodClassFor(segId) { return "mood-" + moodKeyFor(segId); }

  function setBubbleText(a, text) {
    window.UI.clear(a.bubble);
    a.bubble.textContent = text;
  }
  function setBubbleFace(a, moodKey) {
    window.UI.clear(a.bubble);
    a.bubble.appendChild(AI.node(stageDef("face_" + moodKey, FACE_EMOJI[moodKey])));
  }

  // ---------- v13-2: 退店時のフィードバック(表情の下に「評判 +1」を出す) ----------
  // 週の評判は既存の式(runWeeklyCalc: reputation += (avgSat-50)*0.04)で週の平均満足度から
  // 一括更新されており、客1人ぶんの寄与という数値は元々存在しない。ここでは新しい数値を作らず、
  // 既存の満足度3段階の判定(moodKeyForと同じ閾値: 60以上=満足/45未満=不満)をそのまま符号に使う
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
    var el = h("div", { className: "sv-cust" }, [
      h("span", { className: "sv-bowl" }, [AI.node(stageDef("bowl", "🍜"))]),
      h("span", { className: "sv-body" }, [AI.node(def || stageDef(null, "🧑"))]),
      h("span", { className: "sv-bubble", text: "" })
    ]);
    placeAt(el, GEO.off.x, GEO.off.y);
    var a = {
      id: ++custSeq, // v15-1: 客ごとのID。注文・丼はこの客への参照(actor自体)で1対1に結び付ける
      segId: segId, el: el, seat: null, queued: false, gone: false,
      eatingStarted: false, // v14-5: 丼が届いて食べ始めたかどうか(届くまでは席で待つ)
      waiting: false, // v15-2: 着席して丼を待っている(=我慢の限界タイマーが有効な)間だけtrue
      tgtY: GEO.off.y, // v32: 現在地(y)を追う。move()のたびに更新される(2D移動の距離計算に使う)
      // v15-1/6: ライフサイクルの各時刻(ログ・確認用。計算には一切使わない)
      seatedAt: null, orderedAt: null, deliveredAt: null, eatStartAt: null, exitAt: null, exitReason: null,
      // v13-3: 湧いた瞬間の「今週の1杯あたり売価」を固定で持たせる。週をまたいで退店した場合でも
      // (v12で分かった、帯の終盤に来た客がまれに週をまたいで完食するケース)、この客が本来属していた
      // 週の額のまま計上されるようにするため、退店時ではなく湧いた時点の値を握らせておく。
      priceOwed: traffic.pricePerCustomer || 0,
      // v26(追補§B-2): 同じ理由で、湧いた時点の週番号も固定で持たせる(priceOwedと同じ経路)。
      spawnWeek: traffic.week || 0,
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

  // v32: y座標も動かすため、z-indexをここで一括更新する(奥にあるものほど先に描く=手前にいる
  // ものが後で描かれて重なった相手を隠す、をzForY()で機械的に満たす)。
  function move(a, x, y, ms) {
    if (a.gone) return;
    a.el.style.transitionDuration = Math.max(16, ms / spd()) + "ms";
    a.el.style.left = x + "%";
    if (y != null) { a.el.style.top = y + "%"; a.tgtY = y; a.el.style.zIndex = zForY(y); }
    a.el.classList.toggle("flip", x > (parseFloat(a.el.dataset.x || GEO.off.x)));
    a.el.dataset.x = x;
  }

  function walkMs(fromX, toX, minPerPct) {
    return Math.abs(toX - fromX) * gm(minPerPct || WALK_MIN_PER_PCT);
  }
  // v32: 斜め上視点では移動が斜めになるため、x・y両方の距離を合成した直線距離で歩行時間を計算する。
  function walkMs2(fromX, fromY, toX, toY, minPerPct) {
    var dx = toX - fromX, dy = toY - fromY;
    return Math.sqrt(dx * dx + dy * dy) * gm(minPerPct || WALK_MIN_PER_PCT);
  }

  function spawnCustomer(segId) {
    var a = makeActor(segId);
    // 初期位置を確定させてから移動させる。requestAnimationFrame だと
    // タブが非表示のときにコールバックが来ず、客が湧いた位置で固まる。
    void a.el.offsetWidth;
    var ms = walkMs2(GEO.off.x, GEO.off.y, GEO.door.x, GEO.door.y);
    move(a, GEO.door.x, GEO.door.y, ms);
    later(function () { arriveDoor(a); }, ms);
  }

  function freeSeat() {
    var open = seats.filter(function (s) { return !s.occupant; });
    if (!open.length) return null;
    return open[U.randInt(0, open.length - 1)];
  }

  // v10-3: 実数だけ湧かせるようになったので、「席が空いていても行列を作る」演出上の水増しは廃止。
  // 満席なら並ぶ・空いていれば座る、という素直な判定にした。行列は実際の混雑から自然に生まれる。
  // v25(§4-2/追補§D-1): 行列の上限とturnAwayFull()を廃止した。並びたい客は全員並べる
  // (queueSlot()が列を折り返して座標を割り当てるので、人数がいくつでも破綻しない)。
  function arriveDoor(a) {
    if (a.gone) return;
    var seat = freeSeat();
    if (seat) { enterAndSit(a, seat); return; }
    joinQueue(a);
  }

  // v25(§4-2): 行列に並んだ順(0始まり)から、列(row)・その中の位置(col)を求めて座標にする。
  // GEO.queueCols人ぶん埋まったら次の列へ折り返す。
  // v32(§1-5/指示書「行列」): 横一列の代わりに、入口のすぐ内側から手前へ短く伸びる斜めの列にした
  // (queueColStepで1人ずつ手前へ、queueRowStepで列が折り返るたびに奥へ少しずらす)。
  function queueSlot(i) {
    var row = Math.floor(i / GEO.queueCols);
    var col = i % GEO.queueCols;
    return {
      x: GEO.queueOrigin.x + col * GEO.queueColStep.dx + row * GEO.queueRowStep.dx,
      y: GEO.queueOrigin.y + col * GEO.queueColStep.dy + row * GEO.queueRowStep.dy
    };
  }

  function layoutQueue() {
    queue.forEach(function (a, i) {
      var slot = queueSlot(i);
      move(a, slot.x, slot.y, gm(QUEUE_REFLOW_MIN));
    });
  }

  // v16-3: 行列に並ぶ判断も、着席後に丼を待つ判断も、同じ我慢の限界(patienceMs)を使う
  // (指示書「別々の仕組みを作らない」への対応。v15までは行列側だけ確率判定だった)。
  function joinQueue(a) {
    a.queued = true;
    queue.push(a);
    layoutQueue();
    later(function () {
      if (a.gone || !a.queued) return;
      leaveQueue(a);
    }, patienceMs(a.segId));
  }

  function leaveQueue(a) {
    a.queued = false;
    var i = queue.indexOf(a);
    if (i >= 0) queue.splice(i, 1);
    layoutQueue();
    a.exitAt = nowLabel();
    a.exitReason = "待ちきれず(行列)";
    logLifecycle(a);
    setBubbleText(a, "😡"); // v15-4: 待ちきれず帰るのは怒った表情に統一(隠さずはっきり見せる)。v25§5で😠→😡(より赤く、視認性を上げる)
    a.bubble.className = "sv-bubble mood-bad";
    a.el.classList.add("show-bubble");
    var slot = queueSlot(i < 0 ? 0 : i);
    var ms = walkMs2(slot.x, slot.y, GEO.off.x, GEO.off.y);
    move(a, GEO.off.x, GEO.off.y, ms);
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
    // v26(指示書§3-1、追補§C-1):「今週の客」はweeklyBandSchedule由来の理論値から都度計算する
    // 方式に変わったため、着席イベントを数えるコールバック(onEnterCb)は廃止した。
    a.orderedAt = nowLabel(); // v15-1: 着席が決まった瞬間=注文発生(既存のplaceOrderと同じ瞬間)
    placeOrder(seat, a); // v13-1: 入店=注文発生。手が空いている厨房担当がいなければ席で待ったままになる
    var fromX = parseFloat(a.el.dataset.x || GEO.door.x);
    var fromY = a.tgtY != null ? a.tgtY : GEO.door.y;
    // v32: 横から見た旧版は「席のx手前まで歩く→縦にsitYまで座る」の2段階だったが、斜め上視点は
    // 席のx・yへ1本の斜め移動で向かう(そのぶんSIT_MINは「座る間合い」の一拍としてタイマーだけ残す)。
    var ms = walkMs2(fromX, fromY, seat.x, seat.y, SEAT_WALK_MIN_PER_PCT) + gm(ENTER_EXTRA_MIN);
    move(a, seat.x, seat.y, ms);
    later(function () {
      if (a.gone) return;
      a.seatedAt = nowLabel();
      setBubbleText(a, "🕐");
      a.bubble.className = "sv-bubble mood-neutral";
      a.el.classList.add("show-bubble");
      // v25(指示書§2): 着席した客は丼が届くまで必ず待つ(待ちきれずに席を立つ経路を廃止)。
      // a.waitingは「まだ丼を受け取っていない着席客」の目印として残す
      // (startEating()でfalseになる。週の境界の片付け=clearSeatedWaiters()がこれを見て使う)。
      // v28-2: 配膳(厨房・ホール)は目標間隔まで速くなった一方、客側の着席の尺(SIT_MIN等)は
      // 指示書§Dどおり変更していないため、極端に配膳が速い条件では「着席が完了する前に
      // 丼が届いてstartEating()が先に走る」逆転が起こり得る(既存の実装にはこの逆転が
      // 起こらない前提=常に着席完了→配膳の順、という暗黙の前提があった)。その場合
      // startEating()が既にeatingStarted=true/waiting=falseにしているので、ここで
      // waiting=trueを無条件に上書きしない(eatingStartedならもう「食事中」であり
      // 「丼待ち」ではないため)。数値・タイミング定数は一切変えていない、状態機械の
      // 整合性だけを直す修正。
      if (!a.eatingStarted) a.waiting = true;
    }, ms + gm(SIT_MIN));
  }

  // v14-5: 丼が実際に届いた瞬間(runSoloCycle/runHallCycle/runKitchenCycleのdeliverステップ)にだけ
  // 食べ始めさせる。
  function startEating(a) {
    if (a.gone || a.eatingStarted) return;
    a.eatingStarted = true;
    a.waiting = false; // v15-2: 我慢の限界タイマーはここで無効化(guardで再チェックしているが念のため)
    a.eatStartAt = nowLabel();
    setBubbleText(a, "");
    a.el.classList.remove("show-bubble");
    a.el.classList.add("eating");
    // v10-3/v12-1: 滞在時間はゲーム内時間で持つ(提供+食事で30〜40分程度)。実秒は
    // BASE_HOUR_MS(js/utils.js)から作るので、速度体系を変えても比率は崩れない。
    later(function () { finishMeal(a); }, gm(U.rand(MEAL_MIN_MIN, MEAL_MIN_MAX)));
  }

  // v25(指示書§2/追補§B-2): 週の切り替わりの安全弁。着席していてまだ丼を受け取っていない客
  // (a.waiting===true)だけを片付ける。食事中の客(a.waiting===false)には触れない。
  // 「我慢の限界」の復活ではない——客ごとのタイマーでは判定せず、週の境界という構造的な
  // 区切りで一律に片付けるだけ(新しい数値・定数は作らない)。見た目は行列で諦めた客と同じ扱い。
  // 客が退店できるのはここ・finishMeal()・leaveQueue()(行列側)だけ。
  // 数値(逃した客数・満足度・評判)には一切影響させない(§Aの数字は週次計算から出る)。
  function clearSeatedWaiters() {
    actors.slice().forEach(function (a) {
      if (a.gone || !a.waiting) return;
      a.waiting = false;
      cancelOrderFor(a); // 厨房・ホールはこの客ぶんを作り続けない(未処理の注文も同時に取り除く)
      a.exitAt = nowLabel();
      a.exitReason = "待ちきれず(週の切り替わり)";
      logLifecycle(a);
      setBubbleText(a, "😡"); // v25§5で😠→😡(より赤く、視認性を上げる)
      a.bubble.className = "sv-bubble mood-bad";
      a.el.classList.add("show-bubble");
      var seat = a.seat;
      if (!seat) return; // 通常は起こらない(a.waiting=trueならa.seatは必ずある。念のための保険)
      later(function () {
        if (a.gone) return;
        seat.occupant = null;
        a.seat = null;
        var ms = walkMs2(seat.x, seat.y, GEO.off.x, GEO.off.y, SEAT_WALK_MIN_PER_PCT);
        move(a, GEO.off.x, GEO.off.y, ms);
        later(function () { removeActor(a); }, ms);
        pullFromQueue();
      }, gm(LEAVE_WAIT_MIN));
    });
  }

  function finishMeal(a) {
    if (a.gone) return;
    a.exitAt = nowLabel();
    a.exitReason = "食べ終わった";
    logLifecycle(a);
    a.el.classList.remove("eating");
    setBubbleFace(a, moodKeyFor(a.segId));
    a.bubble.className = "sv-bubble " + moodClassFor(a.segId);
    a.el.classList.add("show-bubble");
    showExitPopup(a); // v13-2: 退店の動きが始まった瞬間、表情の下に「評判 ±1」を出す(変化があるときだけ)
    // v16-1: 所持金への加算はdeliverToSeat()へ移した(丼が届いた瞬間)。ここでは行わない。
    var seat = a.seat;
    later(function () {
      if (a.gone) return;
      seat.occupant = null;
      a.seat = null;
      var ms = walkMs2(seat.x, seat.y, GEO.off.x, GEO.off.y, SEAT_WALK_MIN_PER_PCT);
      move(a, GEO.off.x, GEO.off.y, ms);
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

  // v15-5/v16-2: 帯が終わる瞬間(閉店)。「パッと全員消す」のをやめ、状態ごとに正しい形で退かせる。
  // - 外に並んでいる客: 諦めて帰る(既存のleaveQueueをそのまま使う。「待ちきれず」と同じ形。
  //   満席が続いていた=詰まっていた状況なので、指示書2番の「満席でない状態」には当たらない)
  // - 着席済み・待機中の客: v15では閉店時に強制的に「待ちきれず」扱いで退店させていたが、
  //   v16の確認プレイで、これが「従業員2人・満席でない状態でも、帯が終わる瞬間に丼が
  //   まだ届いていない客が機械的に切り捨てられる」原因になっていることが分かった
  //   (通常営業でも普通に起きてしまい、指示書2番の「満席でない状態では0人」を満たせなかった)。
  //   実店舗でも「すでに座って注文している客を、営業時間が終わったからと追い出す」ことは
  //   しない(新規の呼び込みだけ止める)のが自然なため、v16では着席済みの客には触れないよう
  //   変更した。厨房・ホールは帯の状態を見ずに動き続けるので(dispatchOrders)、残っていた
  //   注文はそのまま作られ続け、客は通常どおり自分の我慢の限界(patienceMs)か配膳で決着する。
  // - 食事中の客: 引き続き何もしない。既存の仕組み(finishMeal)で食べ終わるまで見せてから退店させる
  function closeBand(bandKey) {
    queue.slice().forEach(function (a) { leaveQueue(a); });
  }

  // v13-1: 店員の往復は(客と同じく)move()/later()で駆動するようになったため、CSSキーフレーム用の
  // animationDuration/Delayはもう不要(廃止)。ここでは一時停止クラスの反映とretime()だけ行う。
  function syncSpeed() {
    if (stage) stage.classList.toggle("paused", paused());
    retime(); // v12-1: 速度が変わっていれば、画面上の客の残り時間もここで追随させる
  }

  // ---------- 外部API ----------
  // callbacks: { onServe(segId, price, spawnWeek) v13-3/v16-1(丼が客の席に届いた瞬間。
  // その客ぶんの売価=priceOwedと、湧いた時点の週番号=spawnWeekを渡す。v26追補§B-2でspawnWeekを追加) }
  function mount(container, gameState, callbacks) {
    state = gameState;
    onServeCb = (callbacks && callbacks.onServe) || null;
    clearTimers();
    stage = h("div", { className: "shop-stage" });
    container.appendChild(stage);
    builtSig = "";
    curSpd = spd();
    lifecycleLog = []; // v15-6: 新しいプレイの開始/再開のたびにログをリセットする
    custSeq = 0;
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
    // v26(追補§B-2): 湧かせる客に持たせる週番号。state.weekRevenue.week(loop.jsのstageWeekCustomers
    // が確定させる、既存の週番号)をそのまま使う。新しい通し番号は作らない。
    traffic.week = (state.weekRevenue && state.weekRevenue.week) || 0;
    // v28-2(指示書§2、追補§A): 絵の配膳1杯あたりの目標ゲーム分 T = WEEK_OPERATING_MIN ÷ min(W, S)。
    // A = min(D', S, W) より A <= min(W, S) が常に成立するため、絵が保証すべき上限はWではなく
    // min(W, S)で足りる(Wだけだと過剰に速くなる。追補§A)。D'(需要側)は絶対に入れない
    // (需要が絵の速さを決めると逆流になる。追補§A)。
    // W=customers.staffCapacity(既存、Scoring.staffProcessingCapacity()の戻り値そのもの)。
    // S=座席数×45(既存のwindow.SEATS_TO_WEEKLY_CAPACITY、Scoring.computeWeeklyCustomers()と
    // 同じ式・同じ定数を再利用するだけで、新しい係数は作らない)。
    var W = customers ? customers.staffCapacity : 0;
    var S = window.Scoring.totalSeats(state) * window.SEATS_TO_WEEKLY_CAPACITY;
    var T = Math.min(W > 0 ? W : Infinity, S > 0 ? S : Infinity);
    traffic.targetInterval = (T > 0 && isFinite(T)) ? WEEK_OPERATING_MIN / T : WEEK_OPERATING_MIN;

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
    readyQueue = [];
    orderSeq = 0;
    orderPileEl = null;
    activePopups = 0;
    builtSig = "";
    prevDrawnCounter = null;
    frozen = false;
    onServeCb = null;
    traffic = { schedule: null, queueLevel: 0, satBySeg: {}, pricePerCustomer: 0, week: 0, targetInterval: WEEK_OPERATING_MIN };
  }

  // v09-1: 中央のpauseReasons(js/screens/loop.js)から呼ばれる、唯一の一時停止スイッチ。
  function setPaused(on) { if (on) freeze(); else unfreeze(); }

  // v24(指示書§3-2「演出中にタップされた場合: 残りの席を即座に全部配置」): まだアニメーション
  // 待ち(delay中)のポップ演出を全部即座に最終状態へ進める。sv-stool-popクラスを外すと
  // (.sv-stoolの素の見た目=不透明・アニメーション無しへ戻るだけなので)即座に確定表示になる。
  // ✨はもう出す意味が無いので取り除く。js/screens/setup.jsの演出中タップから呼ばれる。
  function skipSeatPop() {
    if (!stage) return;
    var pops = stage.querySelectorAll(".sv-stool-pop");
    for (var i = 0; i < pops.length; i++) {
      pops[i].classList.remove("sv-stool-pop");
      pops[i].style.animationDelay = "";
    }
    var sparkles = stage.querySelectorAll(".sv-stool-sparkle");
    for (var i = 0; i < sparkles.length; i++) {
      if (sparkles[i].parentNode) sparkles[i].parentNode.removeChild(sparkles[i]);
    }
  }

  return {
    mount: mount, update: update, syncSpeed: syncSpeed, destroy: destroy, setPaused: setPaused,
    openBand: openBand, closeBand: closeBand, skipSeatPop: skipSeatPop,
    clearSeatedWaiters: clearSeatedWaiters, // v25(追補§B-2): 週の切り替わりの安全弁
    getLifecycleLog: function () { return lifecycleLog; } // v15-6: 確認用(客ごとの着席/注文/丼受取/食事開始/退店ログ)
  };
})();
