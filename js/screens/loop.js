// 営業ループ本体（v10）
//  - 店の絵を固定枠いっぱいに広げ、その上に情報とボタンを重ねる
//  - パネルは下半分だけ。上半分の店は見えたまま残す（レシピを変えた瞬間の客の反応が同じ画面で見える）
//  - v10-2: 時間は「時刻」単位で刻む(1時間=5秒@×1)。営業していない時間帯は一気に飛ばす。
//    週末は完全停止し、今週の収支 → イベント → 月次まとめ(あれば) → 定休日のアクション、の順に
//    必ず止まって見せる。「次の週へ」を押すまで絶対に時間は動かない(自動再開しない)。
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
  var SIDES = window.DATA.sides.items; // STEP8: サイドメニュー5種
  var WEEKS_PER_RUN = window.WEEKS_PER_RUN;
  var DAYS_PER_WEEK = 7;
  var TICK_MIN = 15; // 時計を進める最小刻み(分)。表示は15分単位

  var state, onGameOver;
  var tickTimer = null;
  var TALK_COST = 1200;
  var TALK_GAIN = 8;
  // 満足/不満の分け目。この値以上を「満足して帰った客」として数える
  var SATISFIED_LINE = 55;
  // 直近の週次計算結果。設備変更などで店の絵を組み直すときに再利用する。
  var lastFinance = null, lastCustomers = null, lastSchedule = null;
  var openSheetKey = null, sheetBuilder = null;
  var lastFlashData = null; // 週末の収支表示(詳細/1行トグル用に直近データを保持)
  // v22(docs/指示書/v22_ラーメン開発チュートリアル_修正指示書.md): 「ラーメン開発」まわりの
  // 画面専用の状態。state(セーブ)には持たせない一時的な値だけをここに置く
  // (tutorialStep・developedRamensはstate側。§2「途中でリロードしても再開できる」対象はそちら)。
  var devSelection = null;      // 開発パネルで今選んでいる{soup,tare,noodle,topping}(idまたはnull)
  var devPrevSpeed = null;      // 開発パネルを開く直前の速度(閉じたときに戻す用)
  var devSpeedPaused = false;   // 上のdevPrevSpeedによる一時停止が今かかっているか
  var devFlowContinuing = false; // 「開発する」を押してsheetを閉じ、完成演出へ続ける途中かどうか
  var devFabRevealed = false;   // 「開発」ボタンのバウンド出現(handleDevelopSubmit.fab-develop-in)を1回だけ出す
  var devPointerEl = null;      // 誘導の指アイコン(#app直下)
  var devIntroTimer = null;
  // STEP10: 認知度・評判の「今週いくつ動いたか」の表示用。表示専用の値なのでstateには持たせない
  // (セーブする必要が無い上、renderTopBarは週次計算以外のタイミングでも何度も呼ばれるため)。
  var lastAwarenessDelta = 0, lastReputationDelta = 0;
  // v26(指示書§3-1、追補§C-1):「今週の客」は、以前は着席イベントを1人ずつ数えるアキュムレータ
  // (weekLiveCount)だったが、それをやめてweeklyBandSchedule由来の理論値から都度計算する
  // (weekCustomerProgress()、下記)。lastRenderedWeekCustomerCountは.tv-pulse(値が変わった
  // 瞬間の演出)を出すためだけの表示専用の記憶値で、stateには持たせない。
  var lastRenderedWeekCustomerCount = 0;
  // v26(追補§B-2): 週またぎでスキップした配膳の件数(診断用、コンソールに情報として出すだけ)。
  // stateには持たせない(数値計算に一切使わない、確認用のカウンタ)。
  var weekRevenueSkipCount = 0;

  function findStaffDef(id) { return window.Scoring.findStaffDef(state, id); } // STEP6: スカウト勢も対象に含める

  // ---------- v09-1: 停止の一本化 ----------
  // 「週末だから止める」「パネルが開いたから止める」を別々のフラグで書くと、両方の条件が重なった
  // ときに片方を解除した瞬間に動き出してしまう(実際に起きていた不具合はこの形だった)。
  // 理由を集合で持ち、空になったときだけ実際に動かす。
  var pauseReasons = new Set();
  function pause(reason) { pauseReasons.add(reason); syncClock(); }
  function resume(reason) { pauseReasons.delete(reason); syncClock(); }
  function isPaused() { return pauseReasons.size > 0; }

  // 現在の一時停止の状態を、実際の動き(日付タイマー・店の絵)に反映する。何度呼んでも安全(冪等)。
  function syncClock() {
    if (window.ShopView) window.ShopView.setPaused(isPaused());
    scheduleDayTick();
  }

  function onVisibilityChange() {
    if (!state) return; // ゲーム開始前(まだloop画面に来ていない)は無視
    if (document.hidden) pause("hidden"); else resume("hidden");
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  // v12-1: ×1 = 1時間1.7秒(window.BASE_HOUR_MS。js/utils.jsの1箇所だけで持つ)。
  // TICK_MIN(15分)刻みで進めるので、1ティックの実時間はこの1/4。
  // 倍率テーブルはここには持たない(U.hourMsがBASE_HOUR_MS/速度倍率を計算する)。
  function hourMs() {
    return U.hourMs(state.speed);
  }
  function tickMs() {
    var hm = hourMs();
    return hm ? hm * TICK_MIN / 60 : null;
  }

  function clearTick() { if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; } }

  // ---------- v10-2: 営業時間帯のヘルパー ----------
  // v17(docs/新設計/v17_ラーメン屋_修正指示書.md §1-5/§1-6): 営業時間の選択が無くなり、
  // window.BANDSの4帯(昼/昼下がり/夕/夜)が常に全て開いている。BANDSは既にstart昇順で
  // 定義されているので、そのまま返すだけでよい。
  function activeBandDefs() {
    return window.BANDS;
  }
  function bandAt(min, bands) {
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      if (min >= b.start * 60 && min < b.end * 60) return b;
    }
    return null;
  }
  function nextBandToday(min, bands) {
    var best = null;
    bands.forEach(function (b) { if (b.start * 60 > min && (!best || b.start < best.start)) best = b; });
    return best;
  }
  // 今どの帯にいるか(いなければ次に開く帯)に応じて、ShopViewへ開店/湧きの開始を伝える。
  // 新しいゲーム開始・週替わり・セーブからの再開(帯の途中に保存されていた場合を含む)の
  // どこから呼んでも安全なように、判定はここに一本化してある。
  function syncBandForNow() {
    var cur = bandAt(state.clockMin, activeBandDefs());
    if (cur) window.ShopView.openBand(cur.key);
  }

  // ---------- v10-2: 時刻を刻むティック。pauseReasonsが空の間だけ動く ----------
  function scheduleDayTick() {
    clearTick();
    if (isPaused()) return;
    var ms = tickMs();
    if (!ms) return; // 速度「停止」が選ばれている(この場合もisPaused()がtrueになるので実質ここには来ない)
    tickTimer = setTimeout(tickClock, ms);
  }

  function tickClock() {
    var bands = activeBandDefs();
    var cur = bandAt(state.clockMin, bands);
    if (cur) {
      // 営業中: 時計を進める。
      state.clockMin += TICK_MIN;
      var nowBand = bandAt(state.clockMin, bands);
      if (!nowBand) {
        // 帯の終わりを超えて、次の帯まで隙間がある(=閉店)。既存の客は自然に帰る。
        window.ShopView.closeBand(cur.key);
      } else if (nowBand.key !== cur.key) {
        // v17(docs/新設計/v17_ラーメン屋_修正指示書.md §1-6): 4帯が隙間なく11:00〜23:00を
        // 埋めているため、帯の切れ目(14:00/17:00/20:00)では次の帯へそのまま繋がる。
        // 閉店処理(closeBand)は呼ばない(店は閉まっていない)が、新しい帯ぶんの客の湧きを
        // 予約するためopenBandは呼ぶ必要がある(隙間ジャンプ時しかopenBandを呼んでいなかった
        // 旧ロジックのままだと、隙間の無い帯の切り替わりで客が一切湧かなくなってしまう)。
        window.ShopView.openBand(nowBand.key);
      }
      renderTopBar();
      scheduleDayTick();
      return;
    }
    var next = nextBandToday(state.clockMin, bands);
    if (next) {
      // 営業していない時間: 待たずに次の帯の頭まで一気に飛ぶ
      state.clockMin = next.start * 60;
      window.ShopView.openBand(next.key);
      renderTopBar();
      scheduleDayTick();
      return;
    }
    // 今日はもう開く帯が無い -> 日をまたぐ。週の7日目を使い切っていたらここで週次計算へ。
    if (state.day % DAYS_PER_WEEK === 0) {
      runWeeklyCalc(); // state.dayはまだ進めない(週末シーケンスの間は今週最終日のまま)
      return;
    }
    state.day++;
    var firstBand = bands.length ? bands[0] : null;
    state.clockMin = firstBand ? firstBand.start * 60 : 0;
    renderTopBar();
    if (firstBand) window.ShopView.openBand(firstBand.key);
    scheduleDayTick();
  }

  // v09-2: 速度の選択は state.speed に持たせ、ゲームのセーブ(GameState)に乗せて引き継ぐ。
  // 週をまたいでも(advanceWeekはstate.speedに一切触れない)、ページを閉じて再開しても
  // 直前に選んでいた速度のまま続く。新規ゲームはfreshState()通り×1から始まる。
  function setSpeed(n) {
    state.speed = n;
    if (n === 0) pause("speed0"); else resume("speed0"); // pause/resumeが内部でsyncClock()を呼ぶ
    window.ShopView.syncSpeed(); // アニメーションの速さのスケーリングを更新(一時停止の可否とは別軸)
    renderTopBar();
    renderSpeedDock();
    window.GameState.save();
  }

  // v23(docs/完了/v23_週次費用と月次成績_指示書.md §1-1/§1-2/§E): 家賃・人件費は月初一括では
  // なく毎週発生する固定費になった。データ側(js/data/property.jsのrent、js/data/characters.js
  // のwage)を最初から週額で持つよう書き換えたので、ここで月額を割る処理は一切しない(v14で
  // 「表示と実引き落としが合わない」不具合の原因になった方式を踏まない)。名前も実態に合わせて
  // monthlyCostBreakdown→weeklyCostBreakdownに変更した。
  function weeklyCostBreakdown() {
    var property = Scoring.getProperty(state);
    var rent = Math.round(property.rent * (state.rentMultiplier || 1)); // v10-2-4: 家賃は営業時間に関係しない固定費
    var costMult = Scoring.hoursCostMultiplier(state); // v17: 営業時間固定に伴い常に1.0(§1-3)
    var wages = 0;
    state.staffHired.forEach(function (id) {
      var s = EE.ensureStaffState(state, id);
      var def = findStaffDef(id);
      wages += Math.round(def.wage * (s.wageMult || 1) * costMult);
    });
    // v17(docs/新設計/v17_ラーメン屋_修正指示書.md §2-3): 返済(loanPay)を撤去した。
    return { rent: rent, wages: wages, total: rent + wages };
  }

  // v23(§3-1): 週の合計(客数 or 売上)を、曜日ごとの重み比で7日へ配分する。0〜5日目は重み比で
  // 丸め、6日目(週の最終日)で端数を吸収し、7日の合計が必ずweekTotalと一致するようにする
  // (四捨五入の積み上げでズレるのを防ぐ、指示書§3-1の指定どおり)。
  function distributeWeekToDays(weekTotal, dayWeights) {
    var weightSum = dayWeights.reduce(function (a, b) { return a + b; }, 0);
    var out = [0, 0, 0, 0, 0, 0, 0];
    if (weightSum <= 0) { out[6] = weekTotal; return out; }
    var acc = 0;
    for (var d = 0; d < 6; d++) {
      out[d] = Math.round(weekTotal * dayWeights[d] / weightSum);
      acc += out[d];
    }
    out[6] = weekTotal - acc;
    return out;
  }

  // Scoring.weeklyBandScheduleの戻り値(schedule[dow][bandKey][segId]=count)から、曜日ごとの
  // 客数合計(全帯・全客層を合算した7要素の配列、dow=0〜6)を作る。weeklyBandSchedule自体が
  // 「マス目合計=週客数」と完全一致することを検証済みのデータなので、ここで作る7要素の合計は
  // 追加の丸めなしでfinance.totalCustomersと厳密に一致する。
  function dailyCustomerTotals(schedule) {
    var totals = [0, 0, 0, 0, 0, 0, 0];
    for (var d = 0; d < 7; d++) {
      var bandsObj = schedule[d] || {};
      Object.keys(bandsObj).forEach(function (bandKey) {
        var segObj = bandsObj[bandKey];
        Object.keys(segObj).forEach(function (segId) { totals[d] += segObj[segId]; });
      });
    }
    return totals;
  }

  // v26(指示書§3-1、追補§C-4): schedule[dow][bandKey]の客層別内訳を合計するだけの、
  // dailyCustomerTotals()の帯単位版。既存のdailyCustomerTotalsは壊さず、同じ形の小関数を
  // 横に置く(同じ計算を2箇所に書かない原則には反するが、「曜日単位」と「帯単位」は別の
  // 粒度なので、片方をもう片方の内部実装として書き換えることはしない=既存の挙動を変えない)。
  function bandCustomerTotal(schedule, dow, bandKey) {
    var segObj = (schedule[dow] && schedule[dow][bandKey]) || {};
    var sum = 0;
    Object.keys(segObj).forEach(function (id) { sum += segObj[id]; });
    return sum;
  }

  // v26(指示書§3-1、追補§C-2/§C-3): 「今週の客」を、着席イベントを1人ずつ数えるアキュムレータ
  // (旧weekLiveCount)ではなく、weeklyBandSchedule由来の理論値から都度計算する。
  // 追補§C-2の訂正: lastScheduleはv25(§4)以降D(潜在需要=r.potential)ベースなので、マス目の
  // 絶対値をそのまま合計するとAではなくDに揃ってしまう(D>Aの週でカウンタがAを上回る、
  // 今回直したかったのと同種の乖離が新しく生まれる)。scheduleは「曜日×帯の配分比率」を
  // 取るためだけに使い、その比率をA(lastCustomers.actualCustomers)に掛け直すことで、
  // Dベースだろうと結果は必ずAへ揃う(v23のwriteDailyLogがscheduleの比で週の客数・売上を
  // 7日へ配分しているのと同じ手口。新しい発想を持ち込まない)。
  // 案(b)(帯内線形補間、追補§C-1で承認): 現在の帯の内側もstate.clockMinから進行率を出して按分する。
  function weekCustomerProgress() {
    if (!lastSchedule || !lastCustomers) return 0;
    var A = lastCustomers.actualCustomers || 0;
    if (A <= 0) return 0;
    var bands = activeBandDefs();
    if (!bands.length) return 0;

    var grandTotal = 0;
    for (var d = 0; d < 7; d++) {
      bands.forEach(function (b) { grandTotal += bandCustomerTotal(lastSchedule, d, b.key); });
    }
    if (grandTotal <= 0) return 0;

    var dowNow = U.dow(state.day); // 0(月)〜6(日)。state.weekDayは存在しないため。
    var cur = bandAt(state.clockMin, bands);
    var lastBandEndMin = bands[bands.length - 1].end * 60;

    var cumulative = 0;
    for (var dd = 0; dd < dowNow; dd++) {
      bands.forEach(function (b) { cumulative += bandCustomerTotal(lastSchedule, dd, b.key); });
    }
    if (cur) {
      // 今日ぶん: 現在の帯より前は満額、現在の帯は帯内の進行率で按分する。
      for (var i = 0; i < bands.length; i++) {
        var b = bands[i];
        if (b.key === cur.key) {
          var frac = U.clamp((state.clockMin - b.start * 60) / ((b.end - b.start) * 60), 0, 1);
          cumulative += bandCustomerTotal(lastSchedule, dowNow, b.key) * frac;
          break;
        }
        cumulative += bandCustomerTotal(lastSchedule, dowNow, b.key);
      }
    } else if (state.clockMin >= lastBandEndMin) {
      // 追補§C-3: 最終帯(23:00)より後は「帯が無いから0」にせず、今日ぶんを満額計上する
      // (0扱いにすると23:00を跨いだ瞬間にカウンタが大きく逆行するため)。
      bands.forEach(function (b) { cumulative += bandCustomerTotal(lastSchedule, dowNow, b.key); });
    }
    // 最初の帯(11:00)より前は今日ぶん0のまま(cumulativeに何も足さない)。

    var progress = Math.round(A * (cumulative / grandTotal));
    // 追補§C-2: 週の最終帯(dow=6の夜)が閉じた時点は、丸め誤差を許さずAちょうどにクランプする。
    if (dowNow === 6 && !cur && state.clockMin >= lastBandEndMin) progress = Math.round(A);
    return U.clamp(progress, 0, Math.round(A));
  }

  // v23(§3-1): 週末処理でその週7日ぶんのdailyLogをまとめて書く(1杯ごとの書き足しはしない。
  // 売上のstate.moneyへの加算は「丼が客の席に届いた瞬間」に起きるため、バックグラウンドタブの
  // アニメーション遅延で実績値が理論値からズレることがあり、それを月次の集計元にすると週次画面の
  // 客数と食い違ってしまう。weeklyBandSchedule由来の確定データを使えば週次・月次が構造的に一致する)。
  // §B-1で検算済みのとおり、週初日のU.dow()は常に0固定なので、week初日の通算day
  // (=このrunWeeklyCalc実行時点でのstate.day-6。state.dayは週末処理中「今週最終日」のまま)に
  // オフセット無しでschedule[0]〜[6]をそのまま対応させられる。
  function writeDailyLog(finance) {
    if (!state.dailyLog) state.dailyLog = {};
    var weekStartDay = state.day - 6;
    var custByDay = dailyCustomerTotals(lastSchedule || {});
    var revByDay = distributeWeekToDays(Math.round(finance.revenue), custByDay);
    for (var d = 0; d < 7; d++) {
      state.dailyLog[weekStartDay + d] = { customers: custByDay[d], revenue: revByDay[d] };
    }
  }

  // ---------- v12-2: 週の客数・売上・湧きスケジュールを「週の開始」で確定する ----------
  // 以前は週の終わり(runWeeklyCalc)で計算し、その数字を「次の週」の絵の湧きに回していた
  // (店の絵は常に1週遅れの数字で動いていた)。このため開業直後の1週目は参照する前週データが
  // 無く、絵に客が一人も出ないまま収支だけが立っていた(v12指示2)。
  // 今回、この週の実時間が動き出す前(新規開始時のrender()、または前の週からのadvanceWeek())に
  // 計算を確定させ、その週の絵の湧きと週末の収支表示の両方に必ず同じ数字を使うようにする。
  // 収支の計算式そのもの(Scoringの中身)は一切変えていない——呼ぶタイミングだけを動かした。
  function stageWeekCustomers() {
    var customers = Scoring.computeWeeklyCustomers(state);
    // v22実機フィードバック対応: 「開発」チュートリアルを終える(tutorialStep==='done')まで、
    // まだ何も開発していない=お店に出す品が無いはずなので、客が来ない(売上0)ようにする。
    // Scoring側の計算式は一切変えず、ここで客層ごとの人数(count)だけを0に上書きする
    // (以後、computeWeeklyFinance/weeklyBandScheduleはこのcountから金額・湧きを導くだけなので、
    // 売上・原価・絵の湧きも連動して自動的に0になる。新しい計算経路を増やさない)。
    // v25(§F): potential(絵の湧き人数の元)とD/D'/T1/A(逃した客の内訳の元)も同時に0にする
    // (ロック中に「品がまだ無い」以外の理由(席・人手)で客を逃したように見せない・出さないため)。
    if (tutorialSalesLocked()) {
      Object.keys(customers.results).forEach(function (id) {
        customers.results[id].count = 0;
        customers.results[id].potential = 0;
      });
      customers.totalDemand = 0;
      customers.demandAfterQueuePushout = 0;
      customers.demandAfterSeatCap = 0;
      customers.actualCustomers = 0;
    }
    var finance = Scoring.computeWeeklyFinance(state, customers);
    lastCustomers = customers;
    lastFinance = finance;
    // v10-3: この週、実際に絵の上へ湧かせる「曜日×帯」の内訳。計算(売上・満足度)には一切使わない、
    // 可視化専用のデータ。ShopView.openBand()がここから今日・今の帯ぶんを取り出して湧かせる。
    // v25(§4-1/追補§F): 湧かせる総数は実客数(A)ではなく潜在需要(D)ぶんにする(行列が実際に
    // 伸びて見えるようにするため)。weeklyBandScheduleに渡すのは新しく組み立てた別オブジェクトで、
    // lastCustomers(収支・週次表示・満足度バブルが参照する元のcustomers、A基準)は書き換えない
    // (絵が計算より多く見えるようになるが、絵から計算への書き戻しは引き続き一切しない。§4-4)。
    // 帯への配分ロジック(weeklyBandScheduleの重み3/1)自体は変更しない。
    var displayCustomers = { results: {} };
    Object.keys(customers.results).forEach(function (id) {
      var r = customers.results[id];
      displayCustomers.results[id] = { count: r.potential || 0, satisfaction: r.satisfaction, blocked: r.blocked };
    });
    lastSchedule = Scoring.weeklyBandSchedule(state, displayCustomers);
    // v26(指示書§2-1、追補§D-2): 週の売上確定額(planned)と既払い額(paid)。
    // state.weekRevenue.weekが今週の週番号と一致する場合(=週の途中でのリロード)は、
    // 保存済みのplanned/paidをそのまま使う(上書きするとpaidが0に戻り、二重計上になる)。
    // 一致しない場合(=本当に新しい週が始まった)だけ、新しく確定してpaidを0にする。
    var wk = U.weekOfRun(state.day);
    var plannedNow = finance.revenue; // §1-2で確認済み: weekRevenueMultは既にfinance.revenueに適用済み
    if (!state.weekRevenue || state.weekRevenue.week !== wk) {
      state.weekRevenue = { week: wk, planned: plannedNow, paid: 0 };
      lastRenderedWeekCustomerCount = 0; // v26(追補§C-1):「今週の客」表示も週替わりで0に戻す
      weekRevenueSkipCount = 0; // v26(追補§B-2): 週またぎスキップの計測もここでリセット
    } else if (Math.abs(state.weekRevenue.planned - plannedNow) > 0.5) {
      // v26(追補§D-2): §D-1で決定性を確認済みなので、ここに来るのは想定外(バグの証拠)。
      // 保存値を正としつつ、見逃さないよう警告を出す。
      console.warn("[v26] weekRevenue.plannedがリロード後の再計算と食い違っています(保存値="
        + state.weekRevenue.planned + ", 再計算=" + plannedNow + ")。保存値を優先します。");
    }
    refreshShop();
    renderTopBar();
  }

  // v26(指示書§2-2、追補§B-2): 週の確定額(state.weekRevenue.planned)から配膳のたびに分割して
  // 払い出す。paid+priceOwedがplannedを超える場合はクランプし、絵が計算を追い越さないようにする。
  // spawnWeekは客が湧いた時点の週番号(ShopView.makeActor()のtraffic.week経由、priceOwedと同じ
  // 経路)。今週の週番号と一致しない場合(週境界をまたいで配膳された客、追補§1-3で確認した
  // 「厨房が調理着手済みで安全弁が効かない」ケース)は、二重計上・過少計上のどちらも避けるため
  // 金銭処理を丸ごとスキップする(絵の配膳シーケンス自体はshop-view.js側で最後まで完走させる。
  // ここで止めるのは所持金への加算だけ)。
  function onCustomerServed(segId, price, spawnWeek) {
    if (!price) return;
    if (state.weekRevenue && spawnWeek != null && spawnWeek !== state.weekRevenue.week) {
      weekRevenueSkipCount++;
      console.info("[v26] 週またぎの客の売上加算をスキップしました(spawnWeek=" + spawnWeek +
        ", 現在週=" + state.weekRevenue.week + ", 通算" + weekRevenueSkipCount + "件目)");
      return;
    }
    var owed = price;
    if (state.weekRevenue) {
      var room = Math.max(0, state.weekRevenue.planned - state.weekRevenue.paid);
      owed = Math.min(price, room);
      state.weekRevenue.paid += owed;
    }
    if (owed <= 0) return; // クランプで加算分が無くなった場合、renderTopBar等も呼ばない
    state.money += owed;
    renderTopBar();
    window.GameState.save();
  }

  // ---------- 週の計算(7日ぶんのティックがたまった時に1回だけ走る) ----------
  function runWeeklyCalc() {
    if (state.day > window.DAYS_PER_RUN) { finishGame(); return; } // 安全弁。実際の終了判定はadvanceWeek側

    // v09-1: ここから「週末の完全停止」に入る。理由「weekend」を積む(pause内でsyncClock()が
    // 呼ばれ、日付タイマー・店の絵の両方が止まる)。速度の選択(state.speed)自体には触れない
    // (以前はここでspeedを0へ強制的に書き換えて流用していたが、それだと「選んでいた速度」を
    // 覚えていられなかった。v09で廃止し、選択と一時停止を分離した)。
    state.weekEndActive = true;
    pause("weekend");
    renderSpeedDock(); // 速度ボタンを「停止中」表示に切り替える
    closeSheet(); // 開いていたパネルがあれば閉じる(resume("panel")も呼ばれる)

    var prev = state.history.length ? state.history[state.history.length - 1] : null;
    var repBefore = state.reputation;
    var awarenessBefore = state.awareness;
    var moneyBefore = state.money;

    // v12-2: この週の客数・売上はstageWeekCustomers()で週の開始時に確定済み。ここで計算し直すと
    // 「週の途中の変更が今週の数字に混ざる」上に、絵の湧きと収支の数字がズレてしまうため、
    // 確定済みの値をそのまま使う。
    var customers = lastCustomers;
    var finance = lastFinance;
    var avgSat = Scoring.weightedAvgSatisfaction(customers);
    state.lastAvgSatisfaction = avgSat;

    // v23(§1-1/§A-5): 家賃・人件費は「月が変わった週」だけの一括請求をやめ、毎週必ず発生させる。
    // monthJustChangedはもう費用の引き落とし判定には使わない(月次まとめのタイミング判定では
    // 引き続き使う。下のproceedToMonthlyRecap参照)。
    var weeklyFixedCosts = weeklyCostBreakdown();
    var fixedCosts = weeklyFixedCosts.total;
    state.money -= fixedCosts;

    // v13-3/v16-1: 売上(finance.revenue)は丼が客の席に届くごとにonCustomerServed()で既に所持金へ
    // 一部加算済み(v26以降はstate.weekRevenue.plannedからの分割払い出し。§2-2)。ここでは
    // 費用(仕入)だけを引く。表示用のprofit(週の損益)はこれまで通り売上込みの式のまま
    // ——週末の収支画面の「残り」の表示内容は変えない指示のため。
    state.money -= finance.foodCost;
    // STEP7(docs/新設計/07_STEP7_設備_修正版.md §2): 設備の週維持費。家賃・人件費(weeklyFixedCosts)
    // とは別枠の計算のまま、引き続き毎週必ず引く。
    var equipUpkeep = Scoring.weeklyEquipUpkeep(state);
    state.money -= equipUpkeep;
    // STEP8(docs/新設計/08_STEP8_複数ラーメンとサイドメニュー_修正版.md §2): サイドメニューの
    // 売上・原価。ラーメンと違って丼を席へ運ぶ絵の演出が無いため、onCustomerServed()を経由せず
    // ここで直接まとめて加減する(既存の「丼が届いた瞬間に加算」とは別枠。二重計上にはならない)。
    var sideSales = Scoring.computeSideSales(state, customers);
    state.money += sideSales.revenue;
    state.money -= sideSales.cost;
    // v26(指示書§2-3): 週の確定額(planned)の残り(=絵の配膳が追いつかなかった分)を、ここで
    // 一括精算する。これにより「週を通じてstate.moneyへ加算された売上の合計は必ずplannedと
    // 一致する」——絵の実給仕数がAを下回っても、従業員0人で丼が1杯も届かなくても同じ。
    // §2-2のクランプにより残りが負になることは無いはずだが、念のため負ならクランプし、
    // 実装のバグを見逃さないようコンソールに警告を出す。
    if (state.weekRevenue) {
      var remaining = state.weekRevenue.planned - state.weekRevenue.paid;
      if (remaining < 0) {
        console.warn("[v26] weekRevenue残りが負になりました(planned=" + state.weekRevenue.planned +
          ", paid=" + state.weekRevenue.paid + ")。0にクランプします。");
        remaining = 0;
      }
      state.money += remaining;
      state.weekRevenue.paid += remaining; // 精算後はpaid===plannedになる(次週のstageWeekCustomersで作り直す)
    }
    var profit = finance.revenue - finance.foodCost - fixedCosts - equipUpkeep + sideSales.revenue - sideSales.cost;

    state.reputation = U.clamp(state.reputation + (avgSat - 50) * 0.04, 0, 100);
    // STEP10(docs/新設計/10_STEP10_広告_認知度_評判_修正版.md §3): 宣伝を止めると毎週1.5%ずつ
    // 下がる(下限10。一度開業した店が完全に忘れられることはない、という指示のため0にはしない)。
    // 「宣伝をする」の効果は定休日アクション側(js/event-engine.js)で先に加算されており、ここは
    // 減衰だけを担当する(加算と減衰を同じ場所にまとめない=既存の評判と同じ「週1回動く」設計)。
    state.awareness = Math.max(10, (state.awareness || 0) * (1 - 0.015));
    lastAwarenessDelta = state.awareness - awarenessBefore;
    lastReputationDelta = state.reputation - repBefore;
    EE.tickTempBoosts(state);
    if (state.flags.recipeLockWeeksLeft > 0) state.flags.recipeLockWeeksLeft--;
    // v07-3-3: 通常営業でも疲労が少しずつ溜まる(混んだ週ほど少し多く)。
    // v17: 営業時間固定に伴いhoursCostMultiplierは常に1.0(§1-3)。疲労の量自体は変えていない。
    var hoursMult = Scoring.hoursCostMultiplier(state);
    state.flags.fatigue = U.clamp((state.flags.fatigue || 0) + U.clamp(3 + customers.queueLevel * 4, 3, 10) * hoursMult, 0, 100);

    var weekStats = { avgSatisfaction: avgSat, satisfactionBySeg: {}, queueLevel: customers.queueLevel };
    Object.keys(customers.results).forEach(function (id) { weekStats.satisfactionBySeg[id] = customers.results[id].satisfaction; });

    state.history.push({
      // v09-3: monthは実カレンダー月ではなく「開業から何ヶ月目か」(seq, 1〜12・巻き戻りなし)で
      // 持つ。1月をまたいで12月→1月と巻き戻る実カレンダー月のままだと月別集計のキーが壊れるため
      // (表示するときだけ U.monthSeqToCal で実際の月名に戻す)。
      week: U.weekOfRun(state.day), month: U.monthSeq(state.day), customers: finance.bySegment,
      totalCustomers: finance.totalCustomers, revenue: Math.round(finance.revenue), foodCost: Math.round(finance.foodCost),
      // v23(§E): monthlyCosts→fixedCostsにリネーム(毎週発生する固定費になったため)。
      fixedCosts: fixedCosts, rentCost: weeklyFixedCosts.rent, wageCost: weeklyFixedCosts.wages,
      equipUpkeep: equipUpkeep, // STEP7: 設備の週維持費(家賃・人件費とは別枠)
      sideRevenue: sideSales.revenue, sideCost: sideSales.cost, // STEP8: サイドメニューの売上・原価
      profit: Math.round(profit), money: Math.round(state.money),
      avgSatisfaction: Math.round(avgSat), queueLevel: customers.queueLevel,
      // v25(§3-5): 逃した客の内訳({total, seatShort, staffShort})。今回は週次画面にしか
      // 出さないが、月次まとめ・結果画面で使えるよう記録だけしておく(§8先送り)。
      missedCustomers: Scoring.missedCustomersBreakdown(customers)
    });
    // v23(§3-1): 月次成績の集計元となる日別ログ。月次まとめ(proceedToMonthlyRecap)より必ず先に
    // ここで書き終える(week末シーケンスは全てonDoneの連鎖で後から動くので、この関数の中で
    // 同期的に書いておけば順序は自動的に保証される)。
    writeDailyLog(finance);

    // 一週限りの効果をリセット
    state.flags.weekRevenueMult = null;
    state.flags.weekSatisfactionHit = null;
    state.flags.forceQueueSpike = false;

    EE.checkCardUnlocks(state).forEach(function (u) { window.UI.toast(u.text, 3200); });

    renderAll(finance, customers);
    // STEP10: 認知度は毎週かならず1.5%下がる(=毎週動く)ため、評判のように閾値超えでポップアップ
    // させると常時表示になってしまう。ポップアップはさせず、上帯の常時表示(renderTopBar)だけで
    // 「今週いくつ動いたか」を伝える(§5)。
    emitFloats(prev, finance, state.reputation - repBefore, state.money - moneyBefore);

    var guideLine = G.checkAuto(state, { profit: profit, queueLevel: customers.queueLevel });
    if (guideLine) G.say(guideLine);

    var finishedWeek = U.weekOfRun(state.day);
    window.GameState.save();

    // 1. 今週の収支 → 2. イベント(あれば) → 3. 月次まとめ(あれば) → 4. 定休日のアクション、の順で必ず止めて見せる。
    // どの段階も「次へ」を押すまで進まない。state.dayはこの間ずっと今週の最終日のまま動かさない
    // (advanceWeekで初めて次の週の頭に進める)。
    window.GameAudio.se("week"); // v39: 週末の収支が確定した瞬間(history に積み save した後、収支画面を出す直前)。演出のみ
    showWeeklyBalance(finance, customers, weeklyFixedCosts, equipUpkeep, sideSales, function () {
      proceedToEvents(finishedWeek, weekStats);
    });
  }

  function proceedToEvents(finishedWeek, weekStats) {
    var events = EE.checkWeeklyEvents(state, weekStats);
    if (events.length > 0) {
      state.pendingEvents = events;
      state.eventModalActive = true;
      window.GameState.save();
      pause("modal");
      window.ScreenEventModal.showQueue(state, events, function () {
        state.eventModalActive = false;
        resume("modal");
        proceedToMonthlyRecap(finishedWeek);
      });
      return;
    }
    proceedToMonthlyRecap(finishedWeek);
  }

  // v09-3: 月末まとめは「月が変わって最初の週末」に出す(週が月をまたいでよくなったため、
  // 「その月の最後の週」という区切りが無くなった)。最終月(3月)だけは「次の月」が来る前に
  // 52週目で終わってしまうので、最終週に特別扱いで出す。両方が同じ週に重なる可能性もゼロではない
  // ため、queueにして順番に見せる(実際には52週の通しプレイで重ならないことを確認済み)。
  function proceedToMonthlyRecap(finishedWeek) {
    var seq = U.monthSeq(state.day);
    var queue = [];
    if (U.monthJustChanged(state.day) && seq - 1 >= 1) queue.push(seq - 1);
    if (finishedWeek === WEEKS_PER_RUN && queue.indexOf(seq) < 0) queue.push(seq);
    function next() {
      if (!queue.length) { proceedToDayOff(finishedWeek); return; }
      showMonthlyRecap(queue.shift(), next);
    }
    next();
  }

  function proceedToDayOff(finishedWeek) {
    // 最終週は「次の週」が無く、選んでも効果が現れないので定休日アクションは出さない
    if (finishedWeek >= WEEKS_PER_RUN) { advanceWeek(); return; }
    window.DayOff.show(state, G, function () { advanceWeek(); });
  }

  // 「次の週へ」。ここで初めて時間が動く。
  function advanceWeek() {
    state.day++; // 今週の最終日で止めていた状態(runWeeklyCalc開始時点)から、次の週の1日目へ進める
    state.weekEndActive = false;
    var bands = activeBandDefs();
    state.clockMin = bands.length ? bands[0].start * 60 : 0;
    if (state.day > window.DAYS_PER_RUN) { window.GameState.save(); finishGame(); return; }
    window.GameState.save();
    // v25(§2/追補§B-2): 新しい週の客を仕込む直前に、前の週から着席したまま丼を待っていた客を
    // 片付ける安全弁。「我慢の限界」の復活ではなく、週の境界で一律に片付けるだけ(数値には
    // 一切影響しない、見た目専用の処理)。stageWeekCustomers()は開発完了時の再計算等、週の境界
    // 以外からも呼ばれるため、ここ(実際に週が切り替わる箇所)でだけ呼ぶ。
    window.ShopView.clearSeatedWaiters();
    // v12-2: 新しい週の客数・湧きスケジュールをここで確定する(内部でrenderTopBar/refreshShopも行う)。
    stageWeekCustomers();
    renderSpeedDock();
    if (bands.length) window.ShopView.openBand(bands[0].key);
    resume("weekend"); // pauseReasonsが空になれば(パネル等も閉じていれば)ここで自動的にtickが再開する
  }

  // ---------- v23(§3-2): 月末にまとめを出す ----------
  // 費用・利益は月次に出さない。費用は週の単位で発生する以上、月をまたぐ週の費用をどちらの月に
  // 帰属させるか決められないため(指示書§3-2)。集計元はstate.history(週ログ、費用込み)ではなく
  // state.dailyLog(暦月の初日〜末日をそのまま合計するだけ)に切り替えた。
  function monthAggregate(seq) {
    var start = U.monthSeqStartDay(seq);
    // §B-2: 最終月(3月)のmonthSeqEndDay(12)は365を返しDAYS_PER_RUN(364)を1超過するため、
    // 実在する最終日(364=3月30日)でクランプする。他の11ヶ月は元々DAYS_PER_RUN以内に収まる。
    var end = Math.min(U.monthSeqEndDay(seq), window.DAYS_PER_RUN);
    var customers = 0, revenue = 0;
    for (var d = start; d <= end; d++) {
      var rec = state.dailyLog && state.dailyLog[d];
      if (rec) { customers += rec.customers; revenue += rec.revenue; }
    }
    var unitPrice = customers > 0 ? Math.round(revenue / customers) : null; // 客数0のときは「−」表示(呼び出し側)
    return { seq: seq, start: start, end: end, customers: customers, revenue: revenue, unitPrice: unitPrice };
  }

  function monthPeriodDayLabel(day) { return U.calMonth(day) + "月" + U.dayOfMonth(day) + "日"; }

  // 前月比(%)。前月データが無い/0(割り算不能)/今月が客数0で単価がnullのときはnullを返す
  // (呼び出し側で「前月比」行そのものを出さない)。
  function monthPctDiff(cur, prev) {
    if (cur == null || !prev) return null;
    return Math.round((cur - prev) / prev * 100);
  }

  function recapPctRow(label, valueText, pct) {
    var row = h("div", { className: "recap-row" }, [
      h("span", { className: "recap-label", text: label }),
      h("span", { text: valueText })
    ]);
    if (pct != null) {
      row.appendChild(h("span", {
        className: "recap-diff " + (pct >= 0 ? "good" : "bad"),
        text: "前月比 " + (pct >= 0 ? "+" : "") + pct + "%"
      }));
    }
    return row;
  }

  // seq: 開業から何ヶ月目か(1〜12・巻き戻りなし)。見出しの月名・期間だけ実カレンダー月に変換して出す。
  function showMonthlyRecap(seq, onDone) {
    var cur = monthAggregate(seq);
    var prev = seq > 1 ? monthAggregate(seq - 1) : null;
    var unitPriceText = cur.unitPrice != null ? U.formatMoney(cur.unitPrice) : "−";

    var overlay = document.getElementById("event-modal-overlay");
    var box = document.getElementById("event-modal-box");
    box.className = "modal-box month-recap";
    window.UI.clear(box);
    box.appendChild(h("h2", { text: U.monthSeqToCal(seq) + "月のまとめ" }));
    // §3-2: 最終月(3月)だけ日数が違う(3/1〜3/30の30日)ことが、期間表示から読み取れるようにする。
    box.appendChild(h("div", { className: "dim", text: "（" + monthPeriodDayLabel(cur.start) + "〜" + monthPeriodDayLabel(cur.end) + "）" }));

    var table = h("div", { className: "recap-table" }, [
      recapPctRow("客数", cur.customers + "人", prev ? monthPctDiff(cur.customers, prev.customers) : null),
      recapPctRow("売上", U.formatMoney(cur.revenue), prev ? monthPctDiff(cur.revenue, prev.revenue) : null),
      recapPctRow("客単価", unitPriceText, prev ? monthPctDiff(cur.unitPrice, prev.unitPrice) : null)
    ]);
    box.appendChild(table);
    box.appendChild(h("p", { className: "dim", text: "※費用と収支は毎週の画面で確認できます" }));

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
    closeSheet();
    G.hide();
    // v15-6: destroy()の前に読む(destroy自体はログを消さないが、読む場所を明示するため先に確保)
    var lifecycleLog = window.ShopView.getLifecycleLog();
    window.ShopView.destroy();
    pauseReasons.clear(); // 次のプレイに影響しないよう、理由集合をリセットしておく
    console.log("=== イベント密度ログ ===");
    console.table(state.eventLog);
    console.log("=== 客ライフサイクルログ(着席/注文/丼受取/食事開始/退店/理由) ===");
    console.table(lifecycleLog);
    onGameOver();
  }

  // ---------- v07-2: 週の収支表示(1行版 / 詳細版)。週末停止の第1段階として、ブロッキングのモーダルで出す ----------
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

  function moneyRow(label, val, opts) {
    opts = opts || {};
    var cls = "wf-row" + (opts.tone === "bad" ? " wf-bad" : (opts.tone === "good" ? " wf-good" : ""));
    return h("div", { className: cls }, [
      h("span", { className: "wf-label", text: label }),
      h("span", { className: "wf-val", text: (opts.sign && val >= 0 ? "+" : "") + U.formatMoney(val) + (opts.suffix || "") })
    ]);
  }

  // v25(§3-3): moneyRowの人数版(円ではなく「N人」で出す)。既存のwf-row/wf-label/wf-valの
  // クラスをそのまま流用するだけで、新しいCSSは足さない。
  function peopleRow(label, val, opts) {
    opts = opts || {};
    var cls = "wf-row" + (opts.tone === "bad" ? " wf-bad" : (opts.tone === "good" ? " wf-good" : ""));
    return h("div", { className: cls }, [
      h("span", { className: "wf-label", text: label }),
      h("span", { className: "wf-val", text: val + "人" })
    ]);
  }

  // 「今週：客52人/満足38・不満14/売上¥46,800」のようなデータをまとめておく。トグル切替の再描画にも使う。
  // v23(§2-1/§E): 家賃・人件費は毎週発生する固定費になったため、月初かどうかで行の有無を
  // 切り替える必要が無くなった(weeklyFixedCostsは常に実際に引かれた額そのもの)。
  // v17(§2-3): 返済(loanPay)を撤去した。
  function buildFlashData(finance, customers, weeklyFixedCosts, equipUpkeep, sideSales) {
    var s = satSplit(finance, customers);
    var wfc = weeklyFixedCosts || { rent: 0, wages: 0 };
    var revenue = finance.revenue;
    var upkeep = equipUpkeep || 0;
    var side = sideSales || { revenue: 0, cost: 0 };
    return {
      week: U.weekOfRun(state.day),
      totalCustomers: finance.totalCustomers,
      satGood: s.good, satBad: s.bad,
      revenue: revenue, foodCost: finance.foodCost,
      foodCostPct: revenue > 0 ? Math.round((finance.foodCost / revenue) * 100) : 0,
      wages: wfc.wages, rent: wfc.rent,
      // STEP7(§2): 設備維持費は毎週発生するので、家賃・人件費とは別の行として持つ。
      equipUpkeep: upkeep,
      // STEP8(§2): サイドメニューの売上・原価。ラーメンの売上とは別の行として持つ。
      sideRevenue: side.revenue, sideCost: side.cost,
      net: revenue - finance.foodCost - wfc.rent - wfc.wages - upkeep + side.revenue - side.cost,
      // v25(§3-3): 逃した客の内訳({total, seatShort, staffShort})。週次計算(Scoring)側から
      // そのまま取り出すだけ(絵の実数はカウントしない。§3-1)。
      missed: Scoring.missedCustomersBreakdown(customers)
    };
  }

  // 週末停止の第1段階。読んでいる間に裏で時間が進むことは絶対にない(タイマーを一切使わない)。
  // 「次へ」を押すまでここで止まる。
  function showWeeklyBalance(finance, customers, weeklyFixedCosts, equipUpkeep, sideSales, onDone) {
    lastFlashData = buildFlashData(finance, customers, weeklyFixedCosts, equipUpkeep, sideSales);
    renderWeeklyBalanceModal(onDone);
  }

  function renderWeeklyBalanceModal(onDone) {
    var overlay = document.getElementById("event-modal-overlay");
    var box = document.getElementById("event-modal-box");
    var d = lastFlashData;
    box.className = "modal-box";
    window.UI.clear(box);

    box.appendChild(h("div", { className: "wf-head" }, [
      h("div", {}, [
        h("h2", { text: "第" + d.week + "週" }),
        h("div", { className: "wf-sub", text: "客 " + d.totalCustomers + "人（満足" + d.satGood + " / 不満" + d.satBad + "）" })
      ]),
      h("button", {
        className: "wf-toggle", text: isDetailedFlash() ? "1行に" : "詳細",
        onclick: function () {
          state.flags.weekFlashDetailed = !isDetailedFlash();
          window.GameState.save();
          renderWeeklyBalanceModal(onDone);
        }
      })
    ]));

    if (isDetailedFlash()) {
      var rows = [
        moneyRow("売上", d.revenue),
        moneyRow("仕入", -d.foodCost, { tone: "bad", suffix: "（原価率 " + d.foodCostPct + "%）" })
      ];
      // STEP8(§2): サイドメニューの売上・原価。ラーメンとは別の行にする(0円の週は出さない)。
      if (d.sideRevenue) rows.push(moneyRow("サイド売上", d.sideRevenue));
      if (d.sideCost) rows.push(moneyRow("サイド原価", -d.sideCost, { tone: "bad" }));
      // v23(§2-1): 家賃・人件費は毎週発生する固定費になったため、v14で入っていた「月初の週だけ
      // 行を出す」条件分岐を撤去した。金額の有無にかかわらず毎週この2行を出す。
      rows.push(moneyRow("人件費", -d.wages, { tone: "bad" }));
      rows.push(moneyRow("家賃", -d.rent, { tone: "bad" }));
      // STEP7(§2): 設備維持費も毎週発生する固定費(0円の週=設備未購入時は出さない)。
      if (d.equipUpkeep) rows.push(moneyRow("設備維持費", -d.equipUpkeep, { tone: "bad" }));
      // v25(§3-3): 逃した客が0人の週は行自体を出さない(v23の「発生する週にその額を出し、
      // 発生しない週には出さない」方針に揃える)。表示順は常に「席が足りず」→「手が足りず」で
      // 固定(追補§A-2。計算の通過順=先に効いている天井→あとに効いている天井、と一致させる)。
      if (d.missed && d.missed.total > 0) {
        rows.push(h("div", { className: "wf-divider" }));
        rows.push(peopleRow("逃した客", d.missed.total, { tone: "bad" }));
        if (d.missed.seatShort) rows.push(peopleRow("　席が足りず", d.missed.seatShort, { tone: "bad" }));
        if (d.missed.staffShort) rows.push(peopleRow("　手が足りず", d.missed.staffShort, { tone: "bad" }));
      }
      rows.push(h("div", { className: "wf-divider" }));
      rows.push(moneyRow("残り", d.net, { sign: true }));
      var table = h("div", { className: "wf-table" }, rows);
      table.lastChild.className = "wf-row wf-net";
      table.lastChild.querySelector(".wf-val").classList.add(d.net >= 0 ? "good" : "bad");
      box.appendChild(table);
    } else {
      box.appendChild(h("p", { text: "売上 " + U.formatMoney(d.revenue) }));
    }

    box.appendChild(h("div", { className: "modal-choices" }, [
      h("button", {
        className: "btn primary", text: "次へ",
        onclick: function () { overlay.classList.remove("show"); onDone(); }
      })
    ]));
    overlay.classList.add("show");
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
  // v09-3: 「4/1」のような日付を出す。内部の通算日数(state.day)を実際の暦(4月開業・平年固定)で
  // 逆算するだけなので、以前のような「2/35」等の存在しない日付は出ない。
  // v10-2-1: それに曜日と現在時刻を添える(例: 「4月1日(月) 12:40」)。
  function dateLabel() {
    return U.calMonth(state.day) + "月" + U.dayOfMonth(state.day) + "日" +
      "(" + U.dowLabel(state.day) + ") " + U.timeLabel(state.clockMin);
  }

  // v12-4: 上帯は固定グリッド(2行)。1行目=日時+所持金、2行目=今週の客/評判/疲労(+行列)。
  // 要素同士が重ならないことは幅(グリッド列+ellipsis)で保証する(CSSの.top-bar側)。
  // pulse: trueなら「今週の客」の数字が今変わったことを軽く強調する(v12-3)。
  function renderTopBar() {
    var root = document.getElementById("top-bar");
    if (!root) return;
    window.UI.clear(root);
    var queued = lastCustomers && lastCustomers.queueLevel > 0.1;
    var fatigue = Math.round(state.flags.fatigue || 0);
    var fatigueCls = fatigue >= 70 ? "bad" : (fatigue >= 40 ? "warn" : "");

    function item(label, value, cls) {
      return h("div", { className: "ti" }, [
        h("div", { className: "tl", text: label }),
        h("div", { className: "tv" + (cls ? " " + cls : ""), text: value })
      ]);
    }
    var mainRow = h("div", { className: "tb-row tb-row-main" }, [
      item("日時", dateLabel()),
      item("所持金", U.formatMoney(state.money), "money")
    ]);
    // v26(指示書§3-1、追補§C-1):「今週の客」は着席イベントのアキュムレータではなく、
    // weekCustomerProgress()でその都度計算する(理由は同関数のコメント参照)。値が前回の描画から
    // 変わった瞬間だけ.tv-pulse(v12由来の演出)を出す——以前は「着席イベントが来た」ことそのものが
    // 合図だったが、都度計算に変えたことで「前回描画との差分」が同じ役目を果たす。
    var custCount = weekCustomerProgress();
    var custCls = (custCount !== lastRenderedWeekCustomerCount) ? "tv-pulse" : null;
    lastRenderedWeekCustomerCount = custCount;
    // STEP10(docs/新設計/10_STEP10_広告_認知度_評判_修正版.md §5): 認知度と評判を並べて表示する。
    // 別物であることが分かるよう、それぞれ「今週の変化」(直近のrunWeeklyCalcで動いた分。認知度は
    // 放置による1.5%減、評判はその週の満足度による増減)をカッコ添えで見せる。
    function withDelta(v, delta) {
      var r = Math.round(delta);
      if (r === 0) return String(Math.round(v));
      return Math.round(v) + "(" + (r > 0 ? "+" : "") + r + ")";
    }
    var subRow = h("div", { className: "tb-row tb-row-sub" }, [
      item("今週の客", custCount + "人", custCls),
      item("認知度", withDelta(state.awareness, lastAwarenessDelta)),
      item("評判", withDelta(state.reputation, lastReputationDelta)),
      item("疲労", String(fatigue), fatigueCls)
    ]);
    if (queued) subRow.appendChild(h("div", { className: "ti queue-mark" }, [h("span", { className: "emoji-font", text: "🚶行列" })]));
    root.appendChild(mainRow);
    root.appendChild(subRow);
  }

  function renderSpeedDock() {
    var dock = document.getElementById("speed-dock");
    if (!dock) return;
    window.UI.clear(dock);
    // v07-2/v09-2: 週末の完全停止中は速度ボタンを効かせず、代わりに「停止中」と明示する
    var locked = state.weekEndActive;
    if (locked) dock.appendChild(h("div", { className: "speed-locked", text: "停止中" }));
    [[0, "■"], [1, "×1"], [2, "×2"], [4, "×4"]].forEach(function (pair) {
      dock.appendChild(h("button", {
        className: "btn small" + (state.speed === pair[0] && !locked ? " selected" : ""),
        text: pair[1],
        disabled: locked ? "disabled" : null,
        onclick: function () { if (!locked) setSpeed(pair[0]); }
      }));
    });
  }

  function refreshShop() { window.ShopView.update(state, lastFinance, lastCustomers, lastSchedule); }

  function renderAll(finance, customers) {
    lastFinance = finance;
    lastCustomers = customers;
    renderTopBar();
    refreshShop();
    if (openSheetKey) refreshSheet(); // 開きっぱなしのパネルも週ごとに更新する
  }

  // ---------- 1-3: 下半分のパネル ----------
  // v09-1: 開いている間は時間を止める(「パネルを読んでいる間に日付が進む」不具合の本体だった)。
  // ただし止まるのは時間の進行だけで、パネル自体はいつでも操作できる。レシピを変えた瞬間に
  // 上の店で客の反応が変わって見えるのは、時間が止まっていても refreshShop() が反映するので変わらない。
  function openSheet(key, title, builder) {
    // v22 §1: 開発パネルを開いたまま別のパネルへ直接切り替えた場合も「閉じた」扱いにし、
    // 速度・チュートリアルの状態を戻す(closeSheet()を経由しないルートのため、ここでも呼ぶ)。
    if (key !== "develop") abandonDevelopIfNeeded();
    if (openSheetKey === key) { closeSheet(); return; }
    openSheetKey = key;
    sheetBuilder = builder;
    document.getElementById("sheet-title").textContent = title;
    document.getElementById("sheet").classList.add("open");
    document.getElementById("sheet-backdrop").classList.add("open");
    raiseControls(true);
    refreshSheet();
    renderFabs();
    pause("panel");
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
    // v22 §1: 開発パネルを閉じたら速度を元に戻す(「開発する」を押して完成演出へ続く途中
    // (devFlowContinuing)は対象外。abandonDevelopIfNeeded()自身がそこを見て判定する)。
    abandonDevelopIfNeeded();
    devFlowContinuing = false;
    openSheetKey = null;
    sheetBuilder = null;
    var sheet = document.getElementById("sheet");
    if (sheet) sheet.classList.remove("open");
    var bd = document.getElementById("sheet-backdrop");
    if (bd) bd.classList.remove("open");
    raiseControls(false);
    renderFabs();
    resume("panel");
  }

  // ==================== v22: ラーメン開発 ====================
  // docs/指示書/v22_ラーメン開発チュートリアル_修正指示書.md。
  // 手順1(セリフ)→2(ボタン出現・誘導)→3(素材カード選択)→4(完成演出)→5(命名)の状態機械。
  // state.tutorialStep('intro'|'showButton'|'selectIngredients'|'pressDevelop'|'naming'|'done')が
  // 本体で、ここにあるのは画面(fab・パネル・指アイコン)をその値に同期させるための関数群。
  var DEV_LINES = window.DATA.guide.develop;
  var DEV_CATS = [["soup", "スープ"], ["tare", "タレ"], ["noodle", "麺"], ["topping", "トッピング"]];

  function tutorialStepVal() { return state.tutorialStep || "done"; }
  function setTutorialStep(v) {
    state.tutorialStep = v;
    window.GameState.save();
  }
  // v22実機フィードバック対応(2026-08-14): 「開発」を1回も終えていない間は、まだ何も
  // 開発していない=お店に出す品が無いはずなので、客を来させない(stageWeekCustomers()参照)。
  function tutorialSalesLocked() { return tutorialStepVal() !== "done"; }

  // §2: リロード後の再開。パネルを開いている最中や完成演出・命名モーダルの最中(いずれも
  // このモジュール内の一時変数(devSelection等)に依存し、stateには残らない)でリロードされたら、
  // 「ボタンが光っていて、押せば開発を始められる」手順2の状態まで戻す。選びかけのカードは
  // 失われるが、開発ボタンを押し直すだけで同じ場所からやり直せる(安全側の再開)。
  function ensureDevelopTutorialResume() {
    var ts = tutorialStepVal();
    if (ts === "selectIngredients" || ts === "pressDevelop" || ts === "naming") {
      setTutorialStep("showButton");
      // 開発パネルを開いていた間の「元の速度」はこの画面の一時変数(devPrevSpeed)にしか無く、
      // リロードで失われる。速度0(一時停止)のまま保存されていた場合、そのままだと再開後も
      // 動き出さず「なぜか進まない」に見えてしまうため、既定の×1へ戻す(新規開始時と同じ値)。
      if (state.speed === 0) state.speed = 1;
    }
  }

  function startDevelopIntroIfNeeded() {
    if (tutorialStepVal() !== "intro") return;
    if (devIntroTimer) clearTimeout(devIntroTimer);
    G.say(DEV_LINES.intro);
    devIntroTimer = setTimeout(function () {
      setTutorialStep("showButton");
      renderFabs();
    }, 2600);
  }

  // 手順2: 開発ボタン以外を触れなくする(他要素はopacity0.4+pointer-events:none)。
  function syncTutorialDim() {
    var dim = tutorialStepVal() === "showButton";
    ["shop-fill", "top-bar", "speed-dock"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.toggle("dev-tutorial-dim", dim);
    });
  }

  // ---- 指アイコン ----
  // 実機フィードバック対応(2026-08-14、Android Chrome): 開発パネル内の指アイコンが、
  // #app基準のビューポート相対座標を一度だけ計算して固定していたため、#sheet-body
  // (素材カードの一覧、overflow-y:autoでスクロールする)をスクロールすると追従しなかった。
  // 対応として、置き場所を呼び出し側で選べるようにした:
  //   - ホーム画面(開発ボタンを指す。#appはスクロールしない)→ #app直下、ビューポート相対
  //   - 開発パネル内(カード・「開発する」ボタンを指す)→ #sheet-body の**内側**の子要素として
  //     配置し、targetのoffsetTop/offsetLeft(スクロール量に依存しない、offsetParent基準の値)
  //     で位置を決める。ブラウザの通常のスクロール処理でコンテンツと一緒に動くため、scroll
  //     イベントでの再計算が要らない(offsetTop/LeftはCSSのtransform・スクロール位置の
  //     影響を受けない値なので、.sheetの出現アニメーション中に測っても安全)。
  //     #sheet-bodyには position: relative を付けてあり(css/style.css)、間にある
  //     .sheet-section/.choice-grid/.choice-cardはいずれもposition指定が無いため、
  //     targetのoffsetParentは必ず#sheet-bodyになる。
  var devPointerContainer = null; // 今どちらの置き場所に付いているか("app" | "panel" | null)

  function ensureDevPointerEl(container, key) {
    if (!devPointerEl || devPointerContainer !== key) {
      hideDevPointer(); // 置き場所が変わるときは前の要素を畳んでから作り直す
      devPointerEl = h("span", { className: "dev-pointer emoji-font", text: "👉" });
      devPointerContainer = key;
    }
    // 実機フィードバック対応(2026-08-14): カードを1枚選ぶたびにrefreshSheet()が
    // window.UI.clear(#sheet-body)で中身を全部消してから作り直すため、containerが
    // 変わっていなくても#sheet-bodyの子だった.dev-pointerはDOMから外れてしまっている
    // (devPointerElという参照自体は生きたまま「消えた」状態になり、指が見えなくなる不具合の
    // 原因だった)。同じ要素の使い回しでも、呼ばれるたびに必ず付け直す(既にcontainerの子なら
    // 実質何もしないのと同じで、外れていれば再接続される)。
    container.appendChild(devPointerEl);
    return devPointerEl;
  }

  // ホーム画面用: 「開発」ボタンを指す。#appはスクロールしないビューポート相対の座標でよい。
  function showDevPointerAtHome(targetEl) {
    if (!targetEl) { hideDevPointer(); return; }
    var appEl = document.getElementById("app");
    if (!appEl) return;
    var el = ensureDevPointerEl(appEl, "app");
    var appRect = appEl.getBoundingClientRect();
    var tRect = targetEl.getBoundingClientRect();
    var pw = el.offsetWidth || 28, ph = el.offsetHeight || 28;
    // §2「画面左側から右に向けて指す(画面端で見切れないように)」。targetの左側、縦位置は中央に
    // 合わせる。左に寄せきれない(target自体が画面の左端に近い)ときは4pxでクランプする。
    var left = Math.max(4, (tRect.left - appRect.left) - pw - 4);
    var top = (tRect.top - appRect.top) + tRect.height / 2 - ph / 2;
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  // 開発パネル用: カード・「開発する」ボタンを指す。#sheet-bodyの内側に置き、
  // targetのoffsetTop/offsetLeftで位置を決める(スクロールに自動で追従する)。
  function showDevPointerInPanel(targetEl) {
    if (!targetEl) { hideDevPointer(); return; }
    var body = document.getElementById("sheet-body");
    if (!body) return;
    var el = ensureDevPointerEl(body, "panel");
    var pw = el.offsetWidth || 28, ph = el.offsetHeight || 28;
    var left = Math.max(4, targetEl.offsetLeft - pw - 4);
    var top = targetEl.offsetTop + targetEl.offsetHeight / 2 - ph / 2;
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  function hideDevPointer() {
    if (devPointerEl && devPointerEl.parentNode) devPointerEl.parentNode.removeChild(devPointerEl);
    devPointerEl = null;
    devPointerContainer = null;
  }

  function devOwnedCategoryItems(cat) {
    return RECIPES[cat].filter(function (item) { return window.Scoring.isMaterialOwned(state, cat, item.id); });
  }

  // §3「素材カードを一覧表示(現状は各種1枚ずつ)」。トッピングだけは「なし」しか持っていない
  // ことが多い(初期所持カードにトッピングは無い)ので、実物の候補が無ければ最初から「なし」を
  // 選んだ状態にする(§3「全部選ぶまで無効」は満たしたまま、選びようが無いものを無理にタップ
  // させない)。
  function freshDevSelection() {
    var sel = { soup: null, tare: null, noodle: null, topping: null };
    var realToppings = devOwnedCategoryItems("topping").filter(function (i) { return i.id !== "none"; });
    if (!realToppings.length) sel.topping = "none";
    return sel;
  }

  function devAllSelected() {
    return !!(devSelection && devSelection.soup && devSelection.tare && devSelection.noodle && devSelection.topping);
  }

  // 設計判断(docs/設計判断記録.md参照): 最初の開発は必ずラーメン1品目(state.recipe)を対象にする
  // (チュートリアルが指す相手を1つに固定するため)。2回目以降は、解放済みでまだ埋まっていない
  // 2・3品目の枠を先頭から探す。空きが無ければnullを返す(呼び出し側は「開発する」を出さず案内する)。
  function devTargetSlot() {
    if (!state.developedRamens || !state.developedRamens.length) return "recipe";
    var slots = window.Scoring.unlockedRamenSlots(state);
    for (var i = 0; i < slots - 1; i++) {
      var r = state.extraRamens[i];
      if (!r || !(r.soup && r.tare && r.noodle && r.topping)) return i;
    }
    return null;
  }

  function defaultDevelopName(tareId) {
    var prefix = (DEV_LINES.namePrefix && DEV_LINES.namePrefix[tareId]) || DEV_LINES.nameFallback;
    return prefix + DEV_LINES.nameSuffix;
  }

  function restoreDevSpeed() {
    if (devPrevSpeed != null) { setSpeed(devPrevSpeed); devPrevSpeed = null; }
    devSpeedPaused = false;
  }
  // §1「開発パネルを開いたら時間を自動で一時停止...閉じたら元の速度に戻す」。「閉じる」には、
  // 開発する前に別のパネルへ切り替える・戻る、の両方を含める。devFlowContinuing中
  // (「開発する」を押してsheetを閉じ、完成演出へ続く途中)は対象外。
  function abandonDevelopIfNeeded() {
    if (!devSpeedPaused || devFlowContinuing) return;
    restoreDevSpeed();
    hideDevPointer();
    if (tutorialStepVal() !== "done") setTutorialStep("showButton");
    renderFabs();
  }

  function openDevelopPanel() {
    if (openSheetKey === "develop") { closeSheet(); return; }
    devSelection = freshDevSelection();
    devPrevSpeed = state.speed;
    devSpeedPaused = true;
    setSpeed(0);
    hideDevPointer();
    if (tutorialStepVal() === "showButton") setTutorialStep("selectIngredients");
    syncTutorialDim();
    openSheet("develop", "ラーメン開発", panelDevelop);
  }

  function panelDevelop() {
    var box = h("div", {});
    var target = devTargetSlot();
    if (target === null) {
      box.appendChild(h("div", { className: "sheet-section status-card" }, [
        h("h3", { className: "emoji-font", text: "🍜✨ 新しく開発する" }),
        h("p", { className: "dim", text: DEV_LINES.noSlot })
      ]));
      hideDevPointer();
      return box;
    }
    box.appendChild(h("div", { className: "sheet-section" }, [
      h("p", { className: "dim", text: "手持ちの素材カードから選んで、新しいラーメンを完成させよう。" })
    ]));

    var ts = tutorialStepVal();
    var tutorialActive = ts === "selectIngredients" || ts === "pressDevelop";
    var pointerCatKey = null; // 誘導が次に指すカテゴリ(無ければ「開発する」ボタンを指す)

    DEV_CATS.forEach(function (c) {
      var key = c[0];
      var items = devOwnedCategoryItems(key);
      if (!items.length) return; // 所持カードが1枚も無いカテゴリ(トッピング以外は起こらない)は出さない
      if (pointerCatKey === null && !devSelection[key]) pointerCatKey = key;
      var sec = h("div", { className: "sheet-section" }, [h("h3", { text: c[1] })]);
      var grid = h("div", { className: "choice-grid dev-card-grid", id: "dev-grid-" + key });
      items.forEach(function (item) {
        var selected = devSelection[key] === item.id;
        grid.appendChild(h("div", {
          className: "choice-card" + (selected ? " selected" : ""),
          onclick: function () {
            devSelection[key] = item.id;
            if (devAllSelected() && tutorialStepVal() === "selectIngredients") setTutorialStep("pressDevelop");
            refreshSheet();
          }
        }, [
          h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(item)]),
          h("div", { className: "name", text: item.name })
        ]));
      });
      sec.appendChild(grid);
      box.appendChild(sec);
    });

    var ready = devAllSelected();
    box.appendChild(h("button", {
      className: "btn primary dev-submit-btn",
      id: "dev-submit-btn",
      text: "開発する",
      disabled: ready ? null : "disabled",
      onclick: function () { if (ready) handleDevelopSubmit(target); }
    }));

    if (tutorialActive) {
      // showDevPointerInPanel()はoffsetTop/offsetLeft(スクロール位置・.sheetの出現transformの
      // 影響を受けない値)で位置を決めるため、DOMに実際に繋がった直後(次のフレーム)に測れば
      // 十分安全(以前はgetBoundingClientRect基準だったため.sheetの出現アニメーションが
      // 終わるまで待つ必要があったが、その制約はもう無い)。
      requestAnimationFrame(function () {
        var curTs = tutorialStepVal();
        if (openSheetKey !== "develop" || (curTs !== "selectIngredients" && curTs !== "pressDevelop")) { hideDevPointer(); return; }
        var targetEl = pointerCatKey
          ? (document.getElementById("dev-grid-" + pointerCatKey) || {}).firstElementChild
          : document.getElementById("dev-submit-btn");
        showDevPointerInPanel(targetEl);
      });
    } else {
      hideDevPointer();
    }
    return box;
  }

  function handleDevelopSubmit(target) {
    if (!devAllSelected()) return;
    var ingredients = {
      soup: devSelection.soup, tare: devSelection.tare,
      noodle: devSelection.noodle, topping: devSelection.topping
    };
    var agg = Scoring.recipeAggregate(ingredients, state);
    var defaultName = defaultDevelopName(ingredients.tare);

    devFlowContinuing = true; // 続けてcloseSheet()するが、速度・チュートリアルの状態はまだ戻さない
    closeSheet();
    hideDevPointer();
    if (tutorialStepVal() === "pressDevelop") setTutorialStep("naming");

    var items = [];
    DEV_CATS.forEach(function (c) {
      var key = c[0], id = ingredients[key];
      if (!id || id === "none") return; // §4: 「なし」は飛ばす絵が無いので演出には含めない
      var def = U.findById(RECIPES[key], id);
      if (def) items.push({ emoji: def.emoji, name: def.name, img: def.img });
    });

    window.DevelopReveal.show(items, defaultName, function (finalName) {
      finalizeDevelop(target, ingredients, agg, finalName);
    });
  }

  function finalizeDevelop(target, ingredients, agg, name) {
    if (target === "recipe") {
      state.recipe = { soup: ingredients.soup, tare: ingredients.tare, noodle: ingredients.noodle, topping: ingredients.topping };
      state.recipeChangeLog.push(U.weekOfRun(state.day)); // 既存のレシピ変更ログと同じ扱いにする
    } else {
      state.extraRamens[target] = { soup: ingredients.soup, tare: ingredients.tare, noodle: ingredients.noodle, topping: ingredients.topping };
    }
    // §5: 生成した瞬間の値を焼き込んだ不変の記録。以後、素材のLv・分岐を変えても書き換えない
    // (設計判断はdocs/設計判断記録.md参照)。
    state.developedRamens.push({
      id: "dev_" + Date.now() + "_" + state.developedRamens.length,
      name: name,
      ingredients: ingredients,
      stats: { taste: Math.round(agg.quality), cost: Math.round(agg.cost), cookTime: Math.round(agg.workload) },
      createdAt: state.day
    });

    restoreDevSpeed();
    setTutorialStep("done");
    window.GameState.save();
    // v22実機フィードバック対応: ここまで(tutorialSalesLocked()がtrueの間)は客数を0に
    // 上書きしていた(stageWeekCustomers()参照)。完成した直後から実際に売れるようにするため、
    // 今週ぶんを客数ロック無しで確定し直す(次の週を待たせない)。
    stageWeekCustomers();

    G.say(DEV_LINES.complete.replace("{name}", name));
    renderFabs();
    if (openSheetKey) refreshSheet(); // 他のパネルが開いていれば(メニュー構成の数字等)反映する
  }

  // ---------- パネルの中身 ----------
  // STEP8(docs/新設計/08_STEP8_複数ラーメンとサイドメニュー_修正版.md §1・§3): 今の構成(ラーメン
  // 品数・サイド品数)と、それによって決まる週の処理可能人数を表示する。「見えないと選択にならない」
  // (§3)ため、メニューを増やすとこの数字が減ることが見える必要がある。
  // STEP13(docs/新設計/13_STEP13_全体統合_バランス是正_UI_修正版.md §4-1): 「今の週に何人捌けるか
  // (上限)と、実際に何人来たか」「上限に当たっている場合、それが分かること」を追加した。
  // 上限自体もSTEP13(§1)で満足度に応じて動くようになったため、既定値(満足度50)での再計算では
  // なく、この週の確定済みの値(lastCustomers.staffCapacity、stageWeekCustomers()で既に計算済み)
  // をそのまま使う(一方向データフロー: 計算済みの値をそのまま映すだけで、ここで計算し直さない)。
  function menuOverviewSection() {
    var dev = Scoring.staffDevelopmentSum(state);
    var activeRamen = Scoring.activeRamenCount(state);
    var activeSide = Scoring.activeSideCount(state);
    var coef = Scoring.menuCoefficient(state);
    var cap = lastCustomers ? Math.round(lastCustomers.staffCapacity) : Math.round(Scoring.staffProcessingCapacity(state));
    var actual = lastFinance ? lastFinance.totalCustomers : 0;
    var hittingCap = !!(lastCustomers && lastCustomers.totalDemand > lastCustomers.staffCapacity + 0.5);
    return h("div", { className: "sheet-section status-card" }, [
      h("h3", { className: "emoji-font", text: "📋 メニュー構成" }),
      h("div", { className: "dim", text: "開発の合計 " + Math.round(dev) + "(厨房にいる従業員全員ぶん。枠の解放に使う)" }),
      h("div", {}, [
        "今の構成：ラーメン" + activeRamen + "品・サイド" + activeSide + "品　→　週の処理可能人数 ",
        h("span", { className: "money", text: cap + "人" }),
        h("span", { className: "dim", text: "（メニュー係数 ×" + coef.toFixed(2) + "・満足度が高いほど伸びる）" })
      ]),
      h("div", {}, [
        "今週の実客数 ",
        h("span", { className: hittingCap ? "bad" : "good", text: actual + "人" }),
        hittingCap
          ? h("span", { className: "bad", text: "　上限に当たっている(従業員を増やすと伸ばせる)" })
          : h("span", { className: "dim", text: "　上限には余裕がある" })
      ])
    ]);
  }

  // STEP8(§1): ラーメン2・3品目。開発の合計が閾値(2品目=8、3品目=16)を超えると解放され、
  // 解放後はslot1と同じ4カテゴリの選択UIを出す(§4: 素材カードの所持状況にも同じく従う)。
  // 未解放の間は必要な数値を隠さず見せる(§1「隠さない」)。
  function extraRamenSection(slotIndex) {
    var slotNumber = slotIndex + 2; // slotIndex 0→2品目, 1→3品目
    var required = slotNumber === 2 ? 8 : 16;
    var dev = Scoring.staffDevelopmentSum(state);
    var unlocked = Scoring.unlockedRamenSlots(state) >= slotNumber;
    if (!unlocked) {
      return h("div", { className: "sheet-section" }, [
        h("h3", { text: "ラーメン" + slotNumber + "品目（未解放）" }),
        h("div", { className: "dim", text: "開発の合計 " + Math.round(dev) + " / 必要 " + required })
      ]);
    }
    if (!state.extraRamens[slotIndex]) state.extraRamens[slotIndex] = { soup: null, tare: null, noodle: null, topping: null };
    var r = state.extraRamens[slotIndex];
    var configured = !!(r.soup && r.tare && r.noodle && r.topping);
    var sec = h("div", { className: "sheet-section" }, [
      h("h3", { text: "ラーメン" + slotNumber + "品目" + (configured ? "" : "（未設定）") })
    ]);
    if (configured) {
      sec.appendChild(h("button", {
        className: "btn small", text: "この品を外す",
        onclick: function () { state.extraRamens[slotIndex] = null; refreshSheet(); }
      }));
    }
    var cats = [["soup", "スープ"], ["tare", "タレ"], ["noodle", "麺"], ["topping", "トッピング"]];
    cats.forEach(function (c) {
      var key = c[0];
      sec.appendChild(h("div", { className: "setup-hint", text: c[1] }));
      var grid = h("div", { className: "choice-grid" });
      RECIPES[key].filter(function (item) {
        if (item.unlock === "start") return true;
        if (item.unlock === "card_menya") return !!state.cardsUnlocked.menya;
        if (item.unlock === "event") return !!state.flags.eventRecipesUnlocked;
        return false;
      }).forEach(function (item) {
        var selected = r[key] === item.id;
        var unowned = item.unlock === "start" && item.id !== "none" && !window.Scoring.isMaterialOwned(state, key, item.id);
        grid.appendChild(h("div", {
          className: "choice-card" + (selected ? " selected" : "") + (unowned ? " disabled" : ""),
          onclick: function () {
            if (unowned) return;
            r[key] = item.id;
            window.UI.toast(c[1] + "を" + item.name + "に変更した");
            refreshSheet();
          }
        }, [
          h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(item)]),
          h("div", { className: "name", text: item.name }),
          unowned ? h("div", { className: "locked", text: "未所持" }) : null
        ]));
      });
      sec.appendChild(grid);
    });
    return sec;
  }

  // STEP8(§1・§2): サイドメニューの選択。開発の合計が閾値(1品目=5、2品目=12)を超えると解放される。
  // §4「サイドの説明文を書かない。数値の表だけ」に従い、単価・原価・提供負荷の数値だけを出す。
  function sideMenuSection() {
    var dev = Scoring.staffDevelopmentSum(state);
    var slots = Scoring.unlockedSideSlots(state);
    var sec = h("div", { className: "sheet-section" }, [h("h3", { text: "サイドメニュー" })]);
    if (slots === 0) {
      sec.appendChild(h("div", { className: "dim", text: "未解放(開発の合計 " + Math.round(dev) + " / 必要 5)" }));
      return sec;
    }
    sec.appendChild(h("div", { className: "dim", text: "最大" + slots + "品まで選べる(開発の合計 " + Math.round(dev) + ")" }));
    var grid = h("div", { className: "choice-grid" });
    SIDES.forEach(function (side) {
      var selected = state.sideMenu.indexOf(side.id) >= 0;
      var full = state.sideMenu.length >= slots && !selected;
      grid.appendChild(h("div", {
        className: "choice-card" + (selected ? " selected" : "") + (full ? " disabled" : ""),
        onclick: function () {
          if (selected) {
            state.sideMenu = state.sideMenu.filter(function (id) { return id !== side.id; });
          } else {
            if (full) return;
            state.sideMenu.push(side.id);
          }
          refreshSheet();
        }
      }, [
        h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(side)]),
        h("div", { className: "name", text: side.name }),
        h("div", { className: "blurb", text: "単価" + side.price + "円 ・ 原価" + side.cost + "円 ・ 提供負荷" + side.workload }),
        full ? h("div", { className: "locked", text: "これ以上は選べません" }) : null
      ]));
    });
    sec.appendChild(grid);
    return sec;
  }

  function panelRecipe() {
    var box = h("div", {});
    box.appendChild(menuOverviewSection());
    // v22 §1「レシピ画面の中にも「＋ 新しく開発する」を置いて導線を二重化する」。
    box.appendChild(h("div", { className: "sheet-section" }, [
      h("button", { className: "btn primary", text: "＋ 新しく開発する", onclick: openDevelopPanel })
    ]));
    if (state.flags.recipeLockWeeksLeft > 0) {
      box.appendChild(h("p", { className: "bad", text: "ゴンゾウとの約束で、あと" + state.flags.recipeLockWeeksLeft + "週はレシピを変更できない。" }));
    }
    box.appendChild(h("div", { className: "sheet-section" }, [h("h3", { text: "ラーメン1品目" })]));
    var cats = [["soup", "スープ"], ["tare", "タレ"], ["noodle", "麺"], ["topping", "トッピング"]];
    cats.forEach(function (c) {
      var key = c[0];
      var sec = h("div", { className: "sheet-section" }, [h("h3", { text: c[1] })]);
      var grid = h("div", { className: "choice-grid" });
      RECIPES[key].filter(function (item) {
        if (item.unlock === "start") return true;
        if (item.unlock === "card_menya") return !!state.cardsUnlocked.menya;
        if (item.unlock === "event") return !!state.flags.eventRecipesUnlocked; // v07:「他店を食べ歩く」で解禁
        return false;
      }).forEach(function (item) {
        var selected = state.recipe[key] === item.id;
        var recipeLocked = state.flags.recipeLockWeeksLeft > 0;
        // STEP2(docs/新設計/02_STEP2_素材カード基本システム_修正版.md §2): unlock:"start"の素材は
        // 所持していないと選べない(「なし」を除く)。unlock:"event"/"card_menya"の素材は既存どおり
        // 解放条件だけで選べる(このSTEPでは所持カードの対象外)。
        var unowned = item.unlock === "start" && item.id !== "none" && !window.Scoring.isMaterialOwned(state, key, item.id);
        var disabled = recipeLocked || unowned;
        grid.appendChild(h("div", {
          className: "choice-card" + (selected ? " selected" : "") + (disabled ? " disabled" : ""),
          onclick: function () {
            if (disabled || selected) return;
            state.recipe[key] = item.id;
            state.recipeChangeLog.push(U.weekOfRun(state.day));
            window.UI.toast(c[1] + "を" + item.name + "に変更した");
            refreshSheet();
          }
        }, [
          h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(item)]),
          h("div", { className: "name", text: item.name }),
          unowned ? h("div", { className: "locked", text: "未所持" }) : h("div", { className: "blurb", text: G.blurb(item.id) })
        ]));
      });
      sec.appendChild(grid);
      box.appendChild(sec);
    });
    box.appendChild(extraRamenSection(0)); // ラーメン2品目
    box.appendChild(extraRamenSection(1)); // ラーメン3品目
    box.appendChild(sideMenuSection());
    box.appendChild(materialCardsSection());
    return box;
  }

  // STEP2(docs/新設計/02_STEP2_素材カード基本システム_修正版.md §5): 手持ちの素材カード一覧。
  // 「新しい画面を作らない」指示どおり、既存のレシピパネルの中に追記する形にした。
  // 表示するのはカテゴリ・名前・絵文字・4軸の数値(品質/濃さ/量/個性)・原価だけ(§5の説明文ルール、
  // STEP1 §3を厳守: 味わい系の文章は書かず、隠し効果も無い)。所持と未所持を分けて出す。
  // STEP3(docs/新設計/03_STEP3_素材カード育成と分岐_修正版.md §5): Lv・分岐を追加表示する。
  // 表示するのは各カードのLv・Lvアップまでの枚数・選んだ分岐・Lv3の頭打ち表示のみ(§4-2、
  // 数値の表だけに留める)。Lv2に上がる瞬間(分岐未選択)は、選ぶ前に両方の中身が見える
  // ピッカーをこの場に出す(§3「選ぶ前に画面で全て見えていること」。新しい画面は作らない)。
  var MATERIAL_STAT_LABEL = { quality: "品質", richness: "濃さ", volume: "量", uniqueness: "個性" };
  function materialCardsSection() {
    var sec = h("div", { className: "sheet-section" }, [h("h3", { className: "emoji-font", text: "🎴 手持ちの素材カード" })]);
    var cats = [["soup", "スープ"], ["tare", "タレ"], ["noodle", "麺"], ["topping", "トッピング"]];
    var stat = function (v) { return (v >= 0 ? "+" : "") + v; };
    cats.forEach(function (c) {
      var key = c[0];
      sec.appendChild(h("div", { className: "setup-hint", text: c[1] }));
      var grid = h("div", { className: "choice-grid" });
      RECIPES[key].filter(function (item) { return item.unlock === "start" && item.id !== "none"; }).forEach(function (item) {
        var owned = window.Scoring.isMaterialOwned(state, key, item.id);
        if (!owned) {
          grid.appendChild(h("div", { className: "choice-card disabled" }, [
            h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(item)]),
            h("div", { className: "name", text: item.name }),
            h("div", { className: "locked", text: "未所持" })
          ]));
          return;
        }
        var cs = Scoring.materialCardState(state, key, item.id);
        if (cs.pendingBranch) {
          // Lv2に上がる方向を選ぶピッカー。選ぶまでLv1のまま(戻せる余地は無い=§3「選んだら戻せない」)。
          var optA = Scoring.branchOptionPreview(key, item.id, "a");
          var optB = Scoring.branchOptionPreview(key, item.id, "b");
          var pickerCard = h("div", { className: "choice-card wide" }, [
            h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(item)]),
            h("div", { className: "name", text: item.name + "：育てる方向を選ぶ（戻せません）" })
          ]);
          [["a", optA], ["b", optB]].forEach(function (pair) {
            var branchKey = pair[0], opt = pair[1];
            pickerCard.appendChild(h("div", {
              className: "choice-card",
              onclick: function () {
                state.materialCards[key][item.id].branch = branchKey;
                window.UI.toast(item.name + "を「" + opt.label + "」の方向で育てることにした");
                window.GameState.save();
                refreshSheet();
              }
            }, [
              h("div", { className: "name", text: opt.label }),
              h("div", { className: "blurb", text: MATERIAL_STAT_LABEL[opt.key] + stat(opt.lv2.statDelta) + " ・ 原価" + stat(opt.lv2.costDelta) + "円（Lv2）" }),
              h("div", { className: "dim", text: "Lv3では" + MATERIAL_STAT_LABEL[opt.key] + stat(opt.lv3.statDelta) + " ・ 原価" + stat(opt.lv3.costDelta) + "円" })
            ]));
          });
          grid.appendChild(pickerCard);
          return;
        }
        var eff = Scoring.effectiveMaterialStats(state, key, item.id) || item;
        var branchDef = cs.branch && window.DATA.materialBranches[key][cs.branch];
        var lvLabel = "Lv" + cs.level + (cs.maxed ? "（最大）" : "");
        var sub = [];
        if (branchDef) sub.push("方向: " + branchDef.label);
        if (!cs.maxed) sub.push("Lvアップまであと" + cs.dupesToNextLevel + "枚");
        else sub.push("これ以上重ねても無駄になる");
        grid.appendChild(h("div", { className: "choice-card" }, [
          h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(item)]),
          h("div", { className: "name", text: item.name + "　" + lvLabel }),
          h("div", { className: "blurb", text: "品質" + stat(eff.quality) + " ・ 濃さ" + stat(eff.richness) + " ・ 量" + stat(eff.volume) + " ・ 個性" + stat(eff.uniqueness) + " ・ 原価" + eff.cost + "円" }),
          h("div", { className: "dim", text: sub.join(" ・ ") })
        ]));
      });
      sec.appendChild(grid);
    });
    return sec;
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
          h("span", { className: "staff-emoji emoji-font" }, [window.AssetImage.node(seg)]),
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
    box.appendChild(h("p", {}, ["所持金: ", h("span", { className: "money", text: U.formatMoney(state.money) })]));
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
        h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(eq)]),
        h("div", { className: "name", text: eq.name + (owned ? "（導入済）" : "") }),
        // STEP7(§4): 購入前に週維持費が見えるようにする。
        h("div", { className: "cost", text: U.formatMoney(eq.cost) + (eq.weekly_upkeep ? " / 週" + U.formatMoney(eq.weekly_upkeep) : " / 週維持費なし") }),
        h("div", { className: "blurb", text: eq.effect }),
        eq.penalty ? h("div", { className: "sub", text: "代償: " + eq.penalty }) : null
      ]));
    });
    box.appendChild(grid);

    // v24(docs/指示書/v24_席の設備化とプレゼント演出_指示書.md §5、
    // docs/指示書/v24_追補_調査への回答と追加指示.md §5): カウンター席を1席ずつ買い足す。
    // 新しいパネル・新しいボタンは作らず、既存の設備購入パネルに1項目足すだけ。
    var seatDef = window.DATA.seats && U.findById(window.DATA.seats, "counter");
    var prop = Scoring.getProperty(state);
    if (seatDef && prop) {
      var slots = prop.counterSlots;
      var owned = state.seats.counter || 0;
      var atSeatCap = owned >= slots;
      var affordSeat = state.money >= seatDef.price;
      box.appendChild(h("h3", { text: "席" }));
      var seatGrid = h("div", { className: "choice-grid wide" });
      seatGrid.appendChild(h("div", {
        className: "choice-card" + (atSeatCap || !affordSeat ? " disabled" : ""),
        onclick: function () {
          if (atSeatCap || !affordSeat) return;
          state.money -= seatDef.price;
          state.seats.counter = (state.seats.counter || 0) + 1;
          window.UI.toast(seatDef.name + "を1つ置いた（" + state.seats.counter + "/" + slots + "）");
          refreshShop(); // §3-3の共通の仕組みで、買った瞬間に断面図へポップして現れる
          renderTopBar();
          refreshSheet();
        }
      }, [
        h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(seatDef)]),
        h("div", { className: "name", text: seatDef.name + "（" + owned + "/" + slots + "）" }),
        h("div", { className: "cost", text: U.formatMoney(seatDef.price) + " / 週" + U.formatMoney(seatDef.weekly_upkeep) }),
        h("div", { className: "blurb", text: "1つ置くと" + seatDef.capacity + "人座れる" }),
        atSeatCap ? h("div", { className: "locked", text: "これ以上は置けません" }) : null
      ]));
      box.appendChild(seatGrid);
    }

    return box;
  }

  function panelPeople() {
    var box = h("div", {});

    // 4-1-2: 案内役はここからいつでも呼べる
    var guideSec = h("div", { className: "sheet-section" }, [
      h("div", { className: "staff-card" }, [
        h("div", { className: "staff-head" }, [
          h("span", { className: "staff-emoji emoji-font" }, [window.AssetImage.node(G.def())]),
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
      // STEP13(docs/新設計/13_STEP13_全体統合_バランス是正_UI_修正版.md §2-1): このセクションには
      // MAX_STAFFの上限チェックが無く、ここから雇うと上限2人を超えて雇えてしまっていた
      // (STEP6のスカウト・js/screens/setup.jsの雇用画面は既にチェック済みだった)。同じ考え方
      // (state.staffHired.length >= window.MAX_STAFF なら選べなくする)をここにも入れた。
      var atStaffCap = state.staffHired.length >= window.MAX_STAFF;
      var grid = h("div", { className: "choice-grid wide" });
      hireable.forEach(function (def) {
        grid.appendChild(h("div", {
          className: "choice-card" + (atStaffCap ? " disabled" : ""),
          onclick: function () {
            if (atStaffCap) return;
            state.staffHired.push(def.id);
            EE.ensureStaffState(state, def.id);
            if (def.id === "yuta") state.flags.yutaHireWeek = U.weekOfRun(state.day);
            window.UI.toast(def.name + "を雇用した");
            refreshShop();
            refreshSheet();
          }
        }, [
          h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(def), " ", window.StatusPanel.rankBadge(Scoring.staffRating(def).rank)]),
          h("div", { className: "name", text: def.name + "（" + def.role + "）" }),
          h("div", { className: "cost", text: U.formatMoney(def.wage) + "/週" }),
          window.StatusPanel.staffStats(def),
          atStaffCap ? h("div", { className: "locked", text: "これ以上は雇えません" }) : h("div", { className: "blurb", text: G.blurb(def.id) })
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
        h("div", { className: "emoji emoji-font" }, [window.AssetImage.node(c)]),
        h("div", { className: "name", text: c.name }),
        h("div", { className: "sub", text: "関係値 " + rel })
      ]));
    });
    cardSec.appendChild(cgrid);
    box.appendChild(cardSec);
    return box;
  }

  // v22 §5: 「開発」で完成させたラーメンの一覧(不変の記録、state.developedRamens)。
  // 実際に店に出ているレシピ(state.recipe/extraRamens、素材のLv・分岐で今も動く値)とは別に、
  // 完成した瞬間の味・原価・調理時間を焼き込んだまま並べる(履歴としての表示専用)。
  function developedRamensSection() {
    var sec = h("div", { className: "sheet-section status-card" }, [h("h3", { className: "emoji-font", text: "🍜✨ 開発したラーメン" })]);
    var list = state.developedRamens || [];
    if (!list.length) {
      sec.appendChild(h("p", { className: "dim", text: "まだ何も開発していない。右下の「開発」から作れる。" }));
      return sec;
    }
    list.slice().reverse().forEach(function (r) {
      sec.appendChild(h("div", { className: "dim" }, [
        h("span", { className: "money", text: r.name }),
        "　味" + r.stats.taste + "・原価" + r.stats.cost + "円・調理時間" + r.stats.cookTime +
        "　(" + U.weekOfRun(r.createdAt) + "週目に開発)"
      ]));
    });
    return sec;
  }

  function panelData() {
    var box = h("div", {});
    box.appendChild(h("div", { className: "sheet-section" }, [window.StatusPanel.renderRamen(state)]));
    box.appendChild(developedRamensSection());

    var last = state.history.length ? state.history[state.history.length - 1] : null;
    var num = h("div", { className: "sheet-section status-card" }, [h("h3", { className: "emoji-font", text: "📊 直近の週" })]);
    if (!last) {
      num.appendChild(h("p", { className: "dim", text: "まだ1週目が終わっていない。" }));
    } else {
      num.appendChild(h("p", {}, ["客数 ", h("span", { text: last.totalCustomers + "人" }),
        "　満足度 ", h("span", { text: String(last.avgSatisfaction) })]));
      num.appendChild(h("p", {}, ["売上 ", h("span", { className: "money", text: U.formatMoney(last.revenue) }),
        "　原価 ", h("span", { text: U.formatMoney(last.foodCost) })]));
      num.appendChild(h("p", {}, ["週の損益 ",
        h("span", { className: last.profit >= 0 ? "good" : "bad", text: U.formatMoney(last.profit) })]));
      var mc = weeklyCostBreakdown();
      num.appendChild(h("p", { className: "dim", text: "毎週の固定費: 家賃 " + U.formatMoney(mc.rent) +
        " / 給与 " + U.formatMoney(mc.wages) }));
    }
    box.appendChild(num);

    var logSec = h("div", { className: "sheet-section" }, [h("h3", { text: "週次ログ" })]);
    var panel = h("div", { className: "week-log-panel" });
    state.history.slice(-12).reverse().forEach(function (rec) {
      panel.appendChild(h("div", {
        text: "第" + rec.week + "週(" + U.monthSeqToCal(rec.month) + "月): 客" + rec.totalCustomers + "人 / 売上" +
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
    var ts = tutorialStepVal();
    var dimOthers = ts === "showButton";

    // v22 §1「ホーム画面右下のボタン列の最上段(レシピの上)に「開発」ボタンを追加」。
    // 手順1(セリフ)が終わるまで(tutorialStep==='intro')は非表示、出現はscale0→1のバウンド
    // (1回だけ。devFabRevealedで使い回しを防ぐ)、出現後(showButton)は淡い脈動グロー。
    if (ts !== "intro") {
      var bounceCls = devFabRevealed ? "" : " fab-develop-in";
      devFabRevealed = true;
      col.appendChild(h("button", {
        className: "fab fab-develop" + (openSheetKey === "develop" ? " active" : "") +
          (dimOthers ? " fab-develop-glow" : "") + bounceCls,
        onclick: openDevelopPanel
      }, [
        h("span", { className: "fab-icon emoji-font", text: "🍜" }),
        h("span", { className: "fab-label", text: "開発" }),
        h("span", { className: "fab-icon-badge emoji-font", text: "✨" })
      ]));
    }

    // v17(docs/新設計/v17_ラーメン屋_修正指示書.md §1-5): 営業時間の選択が無くなったので
    // 「⏰時間」パネルとそのFABを削除した(6個→5個)。
    [
      ["recipe", "🍜", "レシピ", "レシピ", panelRecipe],
      ["price", "💴", "価格", "価格", panelPrice],
      ["people", "👥", "人", "人", panelPeople],
      ["equip", "🛠", "設備", "設備", panelEquipment],
      ["data", "📊", "データ", "データ", panelData]
    ].forEach(function (f) {
      col.appendChild(h("button", {
        className: "fab" + (openSheetKey === f[0] ? " active" : "") + (dimOthers ? " fab-tutorial-dim" : ""),
        onclick: function () { if (dimOthers) return; openSheet(f[0], f[3], f[4]); }
      }, [
        h("span", { className: "fab-icon emoji-font", text: f[1] }),
        h("span", { className: "fab-label", text: f[2] })
      ]));
    });

    syncTutorialDim();
    if (dimOthers) {
      requestAnimationFrame(function () {
        if (tutorialStepVal() !== "showButton") return; // 待っている間に押されて先へ進んでいたら何もしない
        showDevPointerAtHome(col.querySelector(".fab-develop"));
      });
    } else if (!openSheetKey) {
      hideDevPointer();
    }
  }

  // ---------- 組み立て ----------
  function render(gameState, gameOverCb) {
    state = gameState;
    onGameOver = gameOverCb;
    var root = document.getElementById("screen-loop");
    window.UI.clear(root);

    root.appendChild(h("div", { className: "shop-fill", id: "shop-fill" }));
    root.appendChild(h("div", { className: "top-bar", id: "top-bar" }));
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
    lastRenderedWeekCustomerCount = 0; // v26: 前回プレイの表示値を持ち越さない
    weekRevenueSkipCount = 0;
    openSheetKey = null;
    sheetBuilder = null;
    pauseReasons.clear(); // 前回のプレイの一時停止理由を持ち越さない(念のため)

    // v22: 「ラーメン開発」まわりの一時状態も持ち越さない。devPointerEl・完成演出オーバーレイは
    // #app直下(rootの外)に付くため、上のwindow.UI.clear(root)では消えない。念のためここで畳む。
    devSelection = null;
    devPrevSpeed = null;
    devSpeedPaused = false;
    devFlowContinuing = false;
    devFabRevealed = false;
    if (devIntroTimer) { clearTimeout(devIntroTimer); devIntroTimer = null; }
    hideDevPointer();
    if (window.DevelopReveal) window.DevelopReveal.cancel();
    ensureDevelopTutorialResume(); // リロード等でパネル操作の途中だった場合、手順2の状態まで戻す

    // 中断からの再開で万一「週末シーケンス中」のまま保存されていたら、安全側(次の週の頭)に倒す。
    // 今週分の収支(money・historyなど)はrunWeeklyCalcの時点で既に確定・保存済みなので、
    // 同じ週をもう一度計算し直すのではなく、日付だけ次の週の頭へ進める。
    if (state.weekEndActive) {
      state.day++;
      state.weekEndActive = false;
      var bands = activeBandDefs();
      state.clockMin = bands.length ? bands[0].start * 60 : 0;
    }

    window.ShopView.destroy();
    // v26(追補§C-1): onEnterコールバック(weekLiveCountの加算専用だった)は削除済みなので渡さない。
    window.ShopView.mount(document.getElementById("shop-fill"), state, { onServe: onCustomerServed });
    // v12-2: 新規開始・セーブからの再開のどちらでも、この時点で「今この瞬間の状態」を使って
    // 今週ぶんの客数・湧きスケジュールを確定させる(内部でrenderTopBar/refreshShopも行う)。
    // これで1週目から(セーブ再開なら週の途中からでも)絵に客が出るようになる。
    stageWeekCustomers();
    syncBandForNow(); // 今いる帯(セーブからの再開なら帯の途中のこともある)ぶんの客を湧かせ始める

    renderSpeedDock();
    renderFabs();
    onVisibilityChange(); // 開いた時点でタブが非表示なら最初からpauseしておく
    // 保存されていた速度を引き継ぐ(新規ゲームはfreshState()通り×1から。速度自体は「翌週以降も引き継ぐ」)。
    setSpeed([0, 1, 2, 4].indexOf(state.speed) >= 0 ? state.speed : 1);
    startDevelopIntroIfNeeded(); // v22 手順1: 初回だけどんぶりちゃんが話し、手順2(ボタン出現)へ進む
  }

  return { render: render, setSpeed: setSpeed };
})();
