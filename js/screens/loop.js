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
  // v12-3:「今週の客」= 実際に入店した人数を1人ずつ数えるカウンタ。週の開始でリセットする。
  var weekLiveCount = 0;

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
  // 今週アクティブな帯(businessHoursActive。パネルでの変更は次週から)を開始時刻順で返す。
  function activeBandDefs() {
    var keys = (state.businessHoursActive && state.businessHoursActive.length) ? state.businessHoursActive : window.BASE_HOUR_BANDS;
    return window.BANDS.filter(function (b) { return keys.indexOf(b.key) >= 0; }).sort(function (a, b) { return a.start - b.start; });
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
      // 営業中: 時計を進める。ちょうど帯の終わりを超えたらShopViewへ伝える(既存の客は自然に帰る)
      state.clockMin += TICK_MIN;
      if (!bandAt(state.clockMin, bands)) window.ShopView.closeBand(cur.key);
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

  function monthlyCostBreakdown() {
    var property = Scoring.getProperty(state);
    var rent = Math.round(property.rent * (state.rentMultiplier || 1)); // v10-2-4: 家賃は営業時間に関係しない固定費
    var costMult = Scoring.hoursCostMultiplier(state); // 開けている帯の数(÷2基準)。人件費はここに比例する
    var wages = 0;
    state.staffHired.forEach(function (id) {
      var s = EE.ensureStaffState(state, id);
      var def = findStaffDef(id);
      wages += Math.round(def.wage * (s.wageMult || 1) * costMult);
    });
    var loanPay = state.loan.monthsLeft > 0 ? state.loan.monthlyRepay : 0; // 返済も固定費
    return { rent: rent, wages: wages, loanPay: loanPay, total: rent + wages + loanPay };
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
    var finance = Scoring.computeWeeklyFinance(state, customers);
    lastCustomers = customers;
    lastFinance = finance;
    // v10-3: この週、実際に絵の上へ湧かせる「曜日×帯」の内訳。計算(売上・満足度)には一切使わない、
    // 可視化専用のデータ。ShopView.openBand()がここから今日・今の帯ぶんを取り出して湧かせる。
    lastSchedule = Scoring.weeklyBandSchedule(state, customers);
    weekLiveCount = 0; // v12-3:「今週の客」は来店ごとに数える。週替わりで0に戻す
    refreshShop();
    renderTopBar();
  }

  // v12-3: 客が実際に入店した瞬間(暖簾をくぐって席へ向かう瞬間)にShopViewから呼ばれる。
  function onCustomerEnter() {
    weekLiveCount++;
    renderTopBar(true); // trueで数字が変わった合図(軽い強調)を出す
  }

  // v13-3/v16-1: 丼が客の席に届いた瞬間にShopViewから呼ばれる(以前は食べ終わって退店した瞬間
  // だった。「丼が届いた瞬間にだけ増える」という指示への対応)。その1杯の売価(price)を所持金へ
  // 加算する。週末(runWeeklyCalc)側は費用だけを引く形に変えてあるので、ここが売上を反映する唯一の
  // 場所になる(二重計上防止)。待ちきれず帰った客はここへ来ないので、自動的に売上に乗らない。
  function onCustomerServed(segId, price) {
    if (!price) return;
    state.money += price;
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
    var moneyBefore = state.money;

    // v12-2: この週の客数・売上はstageWeekCustomers()で週の開始時に確定済み。ここで計算し直すと
    // 「週の途中の変更が今週の数字に混ざる」上に、絵の湧きと収支の数字がズレてしまうため、
    // 確定済みの値をそのまま使う。
    var customers = lastCustomers;
    var finance = lastFinance;
    var avgSat = Scoring.weightedAvgSatisfaction(customers);
    state.lastAvgSatisfaction = avgSat;

    var monthlyCosts = 0;
    var chargedBreakdown = { rent: 0, wages: 0, loanPay: 0 }; // 月次まとめ用に、実際に引き落とされた内訳を週次ログへ残す
    // v09-3: 「月初」の判定を、週→月の近似(4.333週/月)から、表示上の月が実際に変わったかへ変更。
    // 週が月をまたいでよくなったため、月の請求は「その週で月が変わったこと」で判定する。
    var monthCharged = U.monthJustChanged(state.day);
    if (monthCharged) {
      chargedBreakdown = monthlyCostBreakdown();
      monthlyCosts = chargedBreakdown.total;
      state.money -= monthlyCosts;
      if (state.loan.monthsLeft > 0) state.loan.monthsLeft--;
    }

    // v13-3/v16-1: 売上(finance.revenue)は丼が客の席に届くごとにonCustomerServed()で既に所持金へ
    // 加算済み。ここで再び足すと二重計上になるため、週末は費用(仕入)だけを引く。表示用のprofit
    // (週の損益)はこれまで通り売上込みの式のまま——週末の収支画面の「残り」の表示内容は変えない指示のため。
    state.money -= finance.foodCost;
    // STEP7(docs/新設計/07_STEP7_設備_修正版.md §2): 設備の週維持費。月次のまとめ(monthlyCosts、
    // 上のmonthChargedブロック)とは完全に別枠で、月をまたぐかどうかに関係なく毎週必ず引く
    // (月初にまとめない)。家賃・給料と二重に引かれないよう、monthlyCostBreakdown()側には
    // 一切触れていない。
    var equipUpkeep = Scoring.weeklyEquipUpkeep(state);
    state.money -= equipUpkeep;
    // STEP8(docs/新設計/08_STEP8_複数ラーメンとサイドメニュー_修正版.md §2): サイドメニューの
    // 売上・原価。ラーメンと違って丼を席へ運ぶ絵の演出が無いため、onCustomerServed()を経由せず
    // ここで直接まとめて加減する(既存の「丼が届いた瞬間に加算」とは別枠。二重計上にはならない)。
    var sideSales = Scoring.computeSideSales(state, customers);
    state.money += sideSales.revenue;
    state.money -= sideSales.cost;
    var profit = finance.revenue - finance.foodCost - monthlyCosts - equipUpkeep + sideSales.revenue - sideSales.cost;

    state.reputation = U.clamp(state.reputation + (avgSat - 50) * 0.04, 0, 100);
    EE.tickTempBoosts(state);
    if (state.flags.recipeLockWeeksLeft > 0) state.flags.recipeLockWeeksLeft--;
    // v07-3-3: 通常営業でも疲労が少しずつ溜まる(混んだ週ほど少し多く)。
    // v10-2-4: 開けている帯が多いほど疲れも増える(2帯基準=1.0倍)。「長く開ければ儲かるが疲れる」の本体。
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
      monthlyCosts: monthlyCosts, rentCost: chargedBreakdown.rent, wageCost: chargedBreakdown.wages, loanCost: chargedBreakdown.loanPay,
      equipUpkeep: equipUpkeep, // STEP7: 設備の週維持費(月次まとめとは別枠)
      sideRevenue: sideSales.revenue, sideCost: sideSales.cost, // STEP8: サイドメニューの売上・原価
      profit: Math.round(profit), money: Math.round(state.money),
      avgSatisfaction: Math.round(avgSat), queueLevel: customers.queueLevel
    });

    // 一週限りの効果をリセット
    state.flags.weekRevenueMult = null;
    state.flags.weekSatisfactionHit = null;
    state.flags.forceQueueSpike = false;

    EE.checkCardUnlocks(state).forEach(function (u) { window.UI.toast(u.text, 3200); });

    renderAll(finance, customers);
    emitFloats(prev, finance, state.reputation - repBefore, state.money - moneyBefore);

    var guideLine = G.checkAuto(state, { profit: profit, queueLevel: customers.queueLevel });
    if (guideLine) G.say(guideLine);

    var finishedWeek = U.weekOfRun(state.day);
    window.GameState.save();

    // 1. 今週の収支 → 2. イベント(あれば) → 3. 月次まとめ(あれば) → 4. 定休日のアクション、の順で必ず止めて見せる。
    // どの段階も「次へ」を押すまで進まない。state.dayはこの間ずっと今週の最終日のまま動かさない
    // (advanceWeekで初めて次の週の頭に進める)。
    showWeeklyBalance(finance, customers, chargedBreakdown, monthCharged, equipUpkeep, sideSales, function () {
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
    // v10-2-2: 営業時間の変更は「次の週から」反映。ここで選択中(businessHours)を確定させる。
    state.businessHoursActive = state.businessHours.slice();
    var bands = activeBandDefs();
    state.clockMin = bands.length ? bands[0].start * 60 : 0;
    if (state.day > window.DAYS_PER_RUN) { window.GameState.save(); finishGame(); return; }
    window.GameState.save();
    // v12-2: 新しい週の客数・湧きスケジュールをここで確定する(内部でrenderTopBar/refreshShopも行う)。
    stageWeekCustomers();
    renderSpeedDock();
    if (bands.length) window.ShopView.openBand(bands[0].key);
    resume("weekend"); // pauseReasonsが空になれば(パネル等も閉じていれば)ここで自動的にtickが再開する
  }

  // ---------- 2-2: 月末にまとめを出す ----------
  function monthAggregate(monthNum) {
    var agg = { revenue: 0, foodCost: 0, rent: 0, wages: 0, loan: 0, equipUpkeep: 0, sideRevenue: 0, sideCost: 0, profit: 0, customers: 0 };
    state.history.forEach(function (rec) {
      if (rec.month !== monthNum) return;
      agg.revenue += rec.revenue; agg.foodCost += rec.foodCost;
      agg.rent += rec.rentCost || 0; agg.wages += rec.wageCost || 0; agg.loan += rec.loanCost || 0;
      agg.equipUpkeep += rec.equipUpkeep || 0; // STEP7: 週次で引かれた設備維持費を月内ぶん合算(内訳表示用)
      agg.sideRevenue += rec.sideRevenue || 0; agg.sideCost += rec.sideCost || 0; // STEP8: サイドの月内合算
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

  // seq: 開業から何ヶ月目か(1〜12・巻き戻りなし)。見出しの月名だけ実カレンダー月に変換して出す。
  function showMonthlyRecap(seq, onDone) {
    var cur = monthAggregate(seq);
    var prev = seq > 1 ? monthAggregate(seq - 1) : null;
    var fmtCount = function (v) { return Math.round(v) + "人"; };

    var overlay = document.getElementById("event-modal-overlay");
    var box = document.getElementById("event-modal-box");
    box.className = "modal-box month-recap";
    window.UI.clear(box);
    box.appendChild(h("h2", { text: U.monthSeqToCal(seq) + "月のまとめ" }));

    var table = h("div", { className: "recap-table" }, [
      recapRow("客数", fmtCount(cur.customers), prev ? cur.customers - prev.customers : null, fmtCount),
      recapRow("売上", U.formatMoney(cur.revenue), prev ? cur.revenue - prev.revenue : null, U.formatMoney),
      recapRow("仕入", "−" + U.formatMoney(cur.foodCost), prev ? -(cur.foodCost - prev.foodCost) : null, U.formatMoney),
      recapRow("サイド売上", U.formatMoney(cur.sideRevenue), prev ? cur.sideRevenue - prev.sideRevenue : null, U.formatMoney),
      recapRow("サイド原価", "−" + U.formatMoney(cur.sideCost), prev ? -(cur.sideCost - prev.sideCost) : null, U.formatMoney),
      recapRow("設備維持費", "−" + U.formatMoney(cur.equipUpkeep), prev ? -(cur.equipUpkeep - prev.equipUpkeep) : null, U.formatMoney),
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

  // 「今週：客52人/満足38・不満14/売上¥46,800」のようなデータをまとめておく。トグル切替の再描画にも使う。
  // v14-3: 月額費用(家賃・人件費・返済)は「週割りの概算」ではなく、runWeeklyCalcが実際に
  // 所持金から引いた額(chargedBreakdown)をそのまま使う。月初でない週はここが全て0になるので、
  // その週は表示側でも「発生しない」として出す(推測で埋め直さない=逆算しない)。
  function buildFlashData(finance, customers, chargedBreakdown, monthCharged, equipUpkeep, sideSales) {
    var s = satSplit(finance, customers);
    var cb = chargedBreakdown || { rent: 0, wages: 0, loanPay: 0 };
    var revenue = finance.revenue;
    var upkeep = equipUpkeep || 0;
    var side = sideSales || { revenue: 0, cost: 0 };
    return {
      week: U.weekOfRun(state.day),
      totalCustomers: finance.totalCustomers,
      satGood: s.good, satBad: s.bad,
      revenue: revenue, foodCost: finance.foodCost,
      foodCostPct: revenue > 0 ? Math.round((finance.foodCost / revenue) * 100) : 0,
      monthCharged: !!monthCharged,
      wages: cb.wages, rent: cb.rent, loanPay: cb.loanPay,
      // STEP7(§2): 設備維持費は月初かどうかに関係なく毎週発生するので、月次費用とは別の行として持つ。
      equipUpkeep: upkeep,
      // STEP8(§2): サイドメニューの売上・原価。ラーメンの売上とは別の行として持つ。
      sideRevenue: side.revenue, sideCost: side.cost,
      net: revenue - finance.foodCost - cb.rent - cb.wages - cb.loanPay - upkeep + side.revenue - side.cost
    };
  }

  // 週末停止の第1段階。読んでいる間に裏で時間が進むことは絶対にない(タイマーを一切使わない)。
  // 「次へ」を押すまでここで止まる。
  function showWeeklyBalance(finance, customers, chargedBreakdown, monthCharged, equipUpkeep, sideSales, onDone) {
    lastFlashData = buildFlashData(finance, customers, chargedBreakdown, monthCharged, equipUpkeep, sideSales);
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
      // STEP7(§2): 設備維持費は月初かどうかに関係なく毎週発生する固定費。家賃・人件費・返済の
      // 判定(d.monthCharged)とは別に、毎週この行を出す(0円の週は出さない)。
      if (d.equipUpkeep) rows.push(moneyRow("設備維持費", -d.equipUpkeep, { tone: "bad" }));
      // v14-3: 家賃・人件費・返済は月初の週にしか引き落とされない固定費。実際に引かれた週だけ、
      // 実際に引かれた額をそのまま出す(それ以外の週は行ごと出さない=無かったことにする)。
      if (d.monthCharged) {
        if (d.wages) rows.push(moneyRow("人件費", -d.wages, { tone: "bad" }));
        if (d.rent) rows.push(moneyRow("家賃", -d.rent, { tone: "bad" }));
        if (d.loanPay) rows.push(moneyRow("返済", -d.loanPay, { tone: "bad" }));
      }
      rows.push(h("div", { className: "wf-divider" }));
      rows.push(moneyRow("残り", d.net, { sign: true }));
      var table = h("div", { className: "wf-table" }, rows);
      table.lastChild.className = "wf-row wf-net";
      table.lastChild.querySelector(".wf-val").classList.add(d.net >= 0 ? "good" : "bad");
      box.appendChild(table);
      box.appendChild(h("div", {
        className: "wf-note",
        text: d.monthCharged
          ? "人件費・家賃・返済は月初のこの週にまとめて引き落とし済み。"
          : "人件費・家賃・返済は月初の週にまとめて引き落とし。今週の引き落としはなし。"
      }));
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
  function renderTopBar(pulse) {
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
      item("所持金", U.formatMoneyShort(state.money), "money")
    ]);
    // v12-3:「今週の客」は週の初めからの合計ではなく、実際に入店した人数を1人ずつ数えるカウンタ。
    var custCls = pulse ? "tv-pulse" : null;
    var subRow = h("div", { className: "tb-row tb-row-sub" }, [
      item("今週の客", weekLiveCount + "人", custCls),
      item("評判", String(Math.round(state.reputation))),
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

  // ---------- パネルの中身 ----------
  // STEP8(docs/新設計/08_STEP8_複数ラーメンとサイドメニュー_修正版.md §1・§3): 今の構成(ラーメン
  // 品数・サイド品数)と、それによって決まる週の処理可能人数を表示する。「見えないと選択にならない」
  // (§3)ため、メニューを増やすとこの数字が減ることが見える必要がある。
  function menuOverviewSection() {
    var dev = Scoring.staffDevelopmentSum(state);
    var activeRamen = Scoring.activeRamenCount(state);
    var activeSide = Scoring.activeSideCount(state);
    var coef = Scoring.menuCoefficient(state);
    var cap = Math.round(Scoring.staffProcessingCapacity(state));
    return h("div", { className: "sheet-section status-card" }, [
      h("h3", { className: "emoji-font", text: "📋 メニュー構成" }),
      h("div", { className: "dim", text: "開発の合計 " + Math.round(dev) + "(厨房にいる従業員全員ぶん。枠の解放に使う)" }),
      h("div", {}, [
        "今の構成：ラーメン" + activeRamen + "品・サイド" + activeSide + "品　→　週の処理可能人数 ",
        h("span", { className: "money", text: cap + "人" }),
        h("span", { className: "dim", text: "（メニュー係数 ×" + coef.toFixed(2) + "）" })
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
          h("div", { className: "emoji emoji-font", text: item.emoji }),
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
        h("div", { className: "emoji emoji-font", text: side.emoji }),
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
          h("div", { className: "emoji emoji-font", text: item.emoji }),
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
  function materialCardsSection() {
    var sec = h("div", { className: "sheet-section" }, [h("h3", { className: "emoji-font", text: "🎴 手持ちの素材カード" })]);
    var cats = [["soup", "スープ"], ["tare", "タレ"], ["noodle", "麺"], ["topping", "トッピング"]];
    cats.forEach(function (c) {
      var key = c[0];
      sec.appendChild(h("div", { className: "setup-hint", text: c[1] }));
      var grid = h("div", { className: "choice-grid" });
      RECIPES[key].filter(function (item) { return item.unlock === "start" && item.id !== "none"; }).forEach(function (item) {
        var owned = window.Scoring.isMaterialOwned(state, key, item.id);
        var stat = function (v) { return (v >= 0 ? "+" : "") + v; };
        grid.appendChild(h("div", { className: "choice-card" + (owned ? "" : " disabled") }, [
          h("div", { className: "emoji emoji-font", text: item.emoji }),
          h("div", { className: "name", text: item.name }),
          owned
            ? h("div", { className: "blurb", text: "品質" + stat(item.quality) + " ・ 濃さ" + stat(item.richness) + " ・ 量" + stat(item.volume) + " ・ 個性" + stat(item.uniqueness) + " ・ 原価" + item.cost + "円" })
            : h("div", { className: "locked", text: "未所持" })
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
          h("span", { className: "staff-emoji emoji-font", text: seg.emoji }),
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
        h("div", { className: "emoji emoji-font", text: eq.emoji }),
        h("div", { className: "name", text: eq.name + (owned ? "（導入済）" : "") }),
        // STEP7(§4): 購入前に週維持費が見えるようにする。
        h("div", { className: "cost", text: U.formatMoney(eq.cost) + (eq.weekly_upkeep ? " / 週" + U.formatMoney(eq.weekly_upkeep) : " / 週維持費なし") }),
        h("div", { className: "blurb", text: eq.effect }),
        eq.penalty ? h("div", { className: "sub", text: "代償: " + eq.penalty }) : null
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
          h("span", { className: "staff-emoji emoji-font", text: G.def().emoji }),
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
            if (def.id === "yuta") state.flags.yutaHireWeek = U.weekOfRun(state.day);
            window.UI.toast(def.name + "を雇用した");
            refreshShop();
            refreshSheet();
          }
        }, [
          h("div", { className: "emoji emoji-font" }, [def.emoji, " ", window.StatusPanel.rankBadge(Scoring.staffRating(def).rank)]),
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
        h("div", { className: "emoji emoji-font", text: c.emoji }),
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
      var mc = monthlyCostBreakdown();
      num.appendChild(h("p", { className: "dim", text: "毎月の固定費: 家賃 " + U.formatMoney(mc.rent) +
        " / 給与 " + U.formatMoney(mc.wages) + " / 返済 " + U.formatMoney(mc.loanPay) }));
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

  // v10-2-2: 営業時間帯パネル。営業ループ中はいつでも変更できるが、反映は次の週から
  // (今週アクティブなbusinessHoursActiveはここでは書き換えない)。
  function panelHours() {
    var box = h("div", {});
    var changed = state.businessHours.slice().sort().join(",") !== state.businessHoursActive.slice().sort().join(",");
    box.appendChild(h("div", { className: "setup-hint", text: "変更は次の週から反映される。最低1つは開けておく。" }));
    if (changed) box.appendChild(h("p", { className: "dim", text: "今週はまだ今の設定のまま営業中。" }));
    var grid = h("div", { className: "choice-grid" });
    window.BANDS.forEach(function (b) {
      var selected = state.businessHours.indexOf(b.key) >= 0;
      var onlyOne = selected && state.businessHours.length === 1;
      grid.appendChild(h("div", {
        className: "choice-card" + (selected ? " selected" : "") + (onlyOne ? " disabled" : ""),
        onclick: function () {
          if (onlyOne) return;
          if (selected) {
            state.businessHours = state.businessHours.filter(function (k) { return k !== b.key; });
            window.UI.toast("次の週から" + b.label + "を閉める");
          } else {
            state.businessHours.push(b.key);
            window.UI.toast("次の週から" + b.label + "を開ける");
          }
          window.GameState.save();
          refreshSheet();
        }
      }, [
        h("div", { className: "emoji emoji-font", text: U.bandEmoji(b.key) }),
        h("div", { className: "name", text: b.label + "（" + U.bandTimeLabel(b) + "）" }),
        onlyOne ? h("div", { className: "locked", text: "最低1つは開けておく" }) : null
      ]));
    });
    box.appendChild(grid);
    return box;
  }

  function renderFabs() {
    var col = document.getElementById("fab-col");
    if (!col) return;
    window.UI.clear(col);
    [
      ["recipe", "🍜", "レシピ", "レシピ", panelRecipe],
      ["price", "💴", "価格", "価格", panelPrice],
      ["hours", "⏰", "時間", "営業時間", panelHours],
      ["people", "👥", "人", "人", panelPeople],
      ["equip", "🛠", "設備", "設備", panelEquipment],
      ["data", "📊", "データ", "データ", panelData]
    ].forEach(function (f) {
      col.appendChild(h("button", {
        className: "fab" + (openSheetKey === f[0] ? " active" : ""),
        onclick: function () { openSheet(f[0], f[3], f[4]); }
      }, [
        h("span", { className: "fab-icon emoji-font", text: f[1] }),
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
    pauseReasons.clear(); // 前回のプレイの一時停止理由を持ち越さない(念のため)

    // 中断からの再開で万一「週末シーケンス中」のまま保存されていたら、安全側(次の週の頭)に倒す。
    // 今週分の収支(money・historyなど)はrunWeeklyCalcの時点で既に確定・保存済みなので、
    // 同じ週をもう一度計算し直すのではなく、日付だけ次の週の頭へ進める。
    if (state.weekEndActive) {
      state.day++;
      state.weekEndActive = false;
      state.businessHoursActive = state.businessHours.slice();
      var bands = activeBandDefs();
      state.clockMin = bands.length ? bands[0].start * 60 : 0;
    }

    window.ShopView.destroy();
    window.ShopView.mount(document.getElementById("shop-fill"), state, { onEnter: onCustomerEnter, onServe: onCustomerServed });
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
  }

  return { render: render, setSpeed: setSpeed };
})();
