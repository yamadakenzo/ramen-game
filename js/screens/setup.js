// 開業フェーズ(v20): v19の「セリフ+次へ」の素っ気ない画面を、どんぶりちゃんが喋っている
// 会話イベントに見せ替える(docs/指示書/v20_ラーメン屋_修正指示書.md)。
// 数値・計算式・state の形・commitTutorialAndStart()の副作用5点は一切変えていない。
// 変えたのは見せ方だけ(文字送り・どんぶりちゃんの大写し・素材/リンのカード演出・静止した店の断面図)。
window.ScreenSetup = (function () {
  var h = window.UI.h;
  var U = window.Utils;
  var PROPERTY_DATA = window.DATA.property;
  var RECIPE_DATA = window.DATA.recipes;
  var CHAR_DATA = window.DATA.characters;
  var DONBURI = CHAR_DATA.guide;

  // v19 §4: 開業直後の状態は固定。物件はこの1つだけ、レシピもこの3+1つだけ、従業員はリン1人。
  var FIXED_PROPERTY_ID = "shotengai";
  var FIXED_RECIPE = { soup: "chicken", tare: "shoyu", noodle: "thin", topping: "none" }; // toppingは必ず文字列"none"。null/undefinedにしない(§2-1: recipeAggregate()がsoup/tare/noodleごと壊れるフォールバックに落ちるため)。
  var FIXED_STAFF_ID = "rin";

  var TYPE_MS = 30; // §3-3: 1文字ずつ、30ms/文字

  // v24(docs/指示書/v24_席の設備化とプレゼント演出_指示書.md §3-1): チュートリアルでプレゼント
  // するカウンター席の数。セリフの{seatCount}にも、実際にstate.seats.counterへ書き込む数にも
  // この1つの定数だけを使う(数値をセリフへ直書きしない指示への対応)。
  var TUTORIAL_SEAT_GIFT = 6;
  var SEAT_POP_STAGGER_MS = 150; // js/screens/shop-view.jsのSTOOL_POP_STAGGER_MSと揃える
  var SEAT_POP_SETTLE_MS = 500;  // 最後の1席が跳ね(0.45s)+✨(0.5s)を出し終えるまでの尺

  var state, onDone;

  // 画面のDOM要素。build()で1回だけ作り、以後はセリフが変わるたびに中身だけ書き換える
  // (§2-1調査どおりShopViewは動かないので、毎回作り直す必要がない)。
  var els = null;
  var typeTimer = null;
  var typedText = "";
  var typedLen = 0;
  var lineReady = false; // 全文表示済みか(true でタップすると次のセリフへ進む)
  // v24 §3-2: 席プレゼント演出の進行中状態。nullなら演出していない。
  var seatReveal = null; // { layerEl, tapEl, done, next, promptTimer }

  // ---------- セリフ ----------
  // §3-4: 2周目以降はrepeatOk:falseの行を飛ばした短縮版にする(自己紹介・説明は初回だけ)。
  function isRepeatRun() {
    return !!(window.MetaState && window.MetaState.currentRunNumber() > 1);
  }

  function tutorialLines() {
    var prop = U.findById(PROPERTY_DATA.properties, FIXED_PROPERTY_ID);
    var all = window.DATA.guide.tutorial.map(function (line) {
      // §3-3: セリフ中の金額は文字列に直接書かず、js/data/property.jsの実際の値を差し込む。
      var text = line.text
        .replace("{cost}", U.formatMoney(prop.initial_cost))
        .replace("{rent}", U.formatMoney(prop.rent))
        .replace("{seatCount}", TUTORIAL_SEAT_GIFT);
      return { id: line.id, text: text };
    });
    if (!isRepeatRun()) return all;
    var repeatIds = {};
    window.DATA.guide.tutorial.forEach(function (line) { if (line.repeatOk) repeatIds[line.id] = true; });
    return all.filter(function (line) { return repeatIds[line.id]; });
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  // ---------- 開業直後の状態を確定させる ----------
  // §2-2: 旧commitAndStart()が担っていた副作用5点(お金/従業員初期化/イベントスケジュール初期化/
  // 時計/セーブ)を1つも漏らさず移植する。物件・レシピ・従業員はここで固定値を書き込む
  // (以前はプレイヤーの選択をそのまま使っていた箇所)。スキップされても最後まで読まれても、
  // 呼ばれるのはこの関数1回だけ(呼んだ直後にonDone()でこの画面自体を離れるため)。
  //
  // v20注記: 背景描画のためにmountShopBackground()がstate.propertyを先出しすることがあるが
  // (下記)、ここでの代入は消さない。二重代入のままにする(スキップ経路や将来の変更で
  // 「先出しがあるからもう要らない」と誤って穴を空けないため。ユーザー承認済み)。
  function commitTutorialAndStart() {
    state.property = FIXED_PROPERTY_ID;
    state.equipment = []; // §4-1: 設備なし
    state.recipe = { soup: FIXED_RECIPE.soup, tare: FIXED_RECIPE.tare, noodle: FIXED_RECIPE.noodle, topping: FIXED_RECIPE.topping };
    // v24 §3-4: runSeatReveal()側で既に書き込んでいるが、v20で state.property に対して行った
    // のと同じ判断(先出しがあっても、ここでの代入は消さず二重代入のままにする)に揃える。
    // スキップされて演出自体が走らなかった場合でも、ここで必ず1回書き込まれる。
    state.seats = { counter: TUTORIAL_SEAT_GIFT };
    if (state.staffHired.indexOf(FIXED_STAFF_ID) < 0) state.staffHired.push(FIXED_STAFF_ID);

    // §2-3: 雇用時にお金は引かれていない(元のcommitAndStart()も物件初期費用と設備購入費だけを
    // 引いていた)。開業資金からこの物件の初期費用だけを引く。
    var prop = U.findById(PROPERTY_DATA.properties, FIXED_PROPERTY_ID);
    state.money = PROPERTY_DATA.startingCapital - (prop ? prop.initial_cost : 0);

    // ①money(上で計算済み) ②ensureStaffState ③initRun ④clockMin ⑤save の5点を移植。
    state.staffHired.forEach(function (id) { window.EventEngine.ensureStaffState(state, id); });
    window.EventEngine.initRun(state);
    state.clockMin = window.BANDS[0].start * 60;
    window.GameState.save();
    onDone();
  }

  // ---------- v20 §2-1: 背景に店の断面図を静止画として置く ----------
  // ShopView.mount()自体はタイマー・客の湧きループ・店員の往復を一切起動しない(調査済み。
  // openBand()/update()を呼ばない限り何も動かない)。念のためsetPaused(true)も掛けておき、
  // 将来shop-view.js側にタイマーが増えてもこの画面が動き出さない保険にする(ユーザー指示)。
  function mountShopBackground() {
    if (!window.ShopView || !els) return;
    // 描画目的でだけ商店街を先に入れる。commitTutorialAndStart()側の代入は上記のとおり消さない。
    // ここで先出ししても安全: チュートリアル中は他に自動保存が走らない(セーブされるのは
    // commitTutorialAndStart()の⑤save1箇所だけ)ので、この先出しが保存されて中途半端な
    // state(お金は引かれていない等)が残ることはない。
    state.property = FIXED_PROPERTY_ID;
    window.ShopView.destroy();
    window.ShopView.mount(els.bg, state, {});
    window.ShopView.setPaused(true);
  }

  // ---------- v21 §3-4: カード演出中だけ上段を不透明にする ----------
  // §2-3の調査どおりCardRevealは#app直下のフルスクリーンオーバーレイ(暗幕付き、z-index:15)
  // であり、.setup-panel(z-index:10)の透過状態とは無関係に背面が確保される。そのためこの節は
  // 実施しない(ユーザー承認済み)。

  // ---------- §4-4: カード演出に出す中身。文字列に直接書かず、必ずデータから読む ----------
  function materialCardItems() {
    // v31 §3-2: imgもそのまま引き継ぐ(window.AssetImage.nodeが読むため)。
    function pick(list, id, sub) {
      var d = U.findById(list, id);
      return { emoji: d ? d.emoji : "", name: d ? d.name : "", img: d ? d.img : null, sub: sub };
    }
    return [
      pick(RECIPE_DATA.soup, FIXED_RECIPE.soup, "スープ"),
      pick(RECIPE_DATA.tare, FIXED_RECIPE.tare, "タレ"),
      pick(RECIPE_DATA.noodle, FIXED_RECIPE.noodle, "麺")
    ];
  }

  function staffCardItems() {
    var d = U.findById(CHAR_DATA.staff, FIXED_STAFF_ID);
    return [{ emoji: d ? d.emoji : "", name: d ? d.name : "", img: d ? d.img : null }];
  }

  // ---------- v24 §3-2: 席プレゼント演出 ----------
  // 1. 会話パネルを消す(半透明は使わない。hiddenクラスでdisplay:noneにする)。
  // 2. state.seats.counterを書き込み、断面図を再描画する(ポップ演出自体はjs/screens/
  //    shop-view.jsの共通の仕組み<§3-3>がbuildScenery()の中で担う。ここでは呼ぶだけでよい)。
  // 3. 6席すべて出終わるまでの尺だけ待ってから「▼ タップして続ける」を出す。
  // 4. タップされるまで待つ。演出中のタップは残りを即座に配置するだけ(閉じない)。
  function startSeatReveal(next) {
    els.panel.classList.add("hidden");
    var prevCount = state.seats.counter || 0;
    state.seats.counter = TUTORIAL_SEAT_GIFT;
    if (window.ShopView) window.ShopView.update(state, null, null, null);
    var addedCount = TUTORIAL_SEAT_GIFT - prevCount;

    var tapEl = h("div", { className: "tap-continue emoji-font", text: "▼ タップして続ける" });
    var layerEl = h("div", { className: "seat-reveal-layer", onclick: onSeatRevealTap }, [tapEl]);
    document.getElementById("screen-setup").appendChild(layerEl);
    seatReveal = { layerEl: layerEl, tapEl: tapEl, done: false, next: next, promptTimer: null };

    if (reducedMotion() || addedCount <= 0) {
      showSeatPrompt();
    } else {
      var totalMs = (addedCount - 1) * SEAT_POP_STAGGER_MS + SEAT_POP_SETTLE_MS;
      seatReveal.promptTimer = setTimeout(showSeatPrompt, totalMs);
    }
  }

  function showSeatPrompt() {
    if (!seatReveal) return;
    seatReveal.done = true;
    seatReveal.tapEl.classList.add("show");
  }

  function onSeatRevealTap() {
    if (!seatReveal) return;
    if (seatReveal.done) { finishSeatReveal(); return; }
    // §3-2「演出中にタップされた場合」: 残りの席を即座に全部配置して4の状態にする(閉じない)。
    if (seatReveal.promptTimer) clearTimeout(seatReveal.promptTimer);
    if (window.ShopView && window.ShopView.skipSeatPop) window.ShopView.skipSeatPop();
    showSeatPrompt();
  }

  function finishSeatReveal() {
    if (!seatReveal) return;
    if (seatReveal.promptTimer) clearTimeout(seatReveal.promptTimer);
    if (seatReveal.layerEl.parentNode) seatReveal.layerEl.parentNode.removeChild(seatReveal.layerEl);
    els.panel.classList.remove("hidden");
    var next = seatReveal.next;
    seatReveal = null;
    next();
  }

  // §3-2スキップボタン: 演出用の要素・.setup-panelのhiddenが残らないよう後片付けしてから
  // commitTutorialAndStart()へ直行する(呼び出し側でnext()は呼ばない)。
  function cleanupSeatReveal() {
    if (!seatReveal) return;
    if (seatReveal.promptTimer) clearTimeout(seatReveal.promptTimer);
    if (seatReveal.layerEl.parentNode) seatReveal.layerEl.parentNode.removeChild(seatReveal.layerEl);
    if (window.ShopView && window.ShopView.skipSeatPop) window.ShopView.skipSeatPop();
    els.panel.classList.remove("hidden");
    seatReveal = null;
  }

  // ---------- 文字送り(§3-3) ----------
  function stopTyping() {
    if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
  }

  function finishTyping() {
    stopTyping();
    typedLen = typedText.length;
    els.body.textContent = typedText;
    lineReady = true;
    els.char.classList.remove("talking");
    els.next.classList.add("show");
  }

  function startTyping(text) {
    stopTyping();
    typedText = text;
    typedLen = 0;
    lineReady = false;
    els.body.textContent = "";
    els.next.classList.remove("show");
    if (reducedMotion()) { finishTyping(); return; } // reduced-motion: 文字送りをせず最初から全文
    els.char.classList.add("talking"); // §3-4: 送っている間だけ揺れる
    typeTimer = setInterval(function () {
      typedLen++;
      els.body.textContent = typedText.slice(0, typedLen);
      if (typedLen >= typedText.length) finishTyping();
    }, TYPE_MS);
  }

  // ---------- 進行 ----------
  function showLine() {
    var lines = tutorialLines();
    if (state.setupStep >= lines.length) state.setupStep = lines.length - 1;
    if (state.setupStep < 0) state.setupStep = 0;
    startTyping(lines[state.setupStep].text);
  }

  // §4-4: 「素材をプレゼントするよ」「リンさんを紹介するね」の直後にだけカードを出す。
  // カード演出が終わってから次のセリフへ進む(doneCbで繋ぐ)。
  function afterLine(lineId, next) {
    if (lineId === "material" && window.CardReveal) {
      window.CardReveal.show(materialCardItems(), next);
    } else if (lineId === "staff" && window.CardReveal) {
      window.CardReveal.show(staffCardItems(), next);
    } else if (lineId === "seat") {
      startSeatReveal(next);
    } else {
      next();
    }
  }

  function advance() {
    var lines = tutorialLines();
    var line = lines[state.setupStep];
    var isLast = state.setupStep >= lines.length - 1;
    afterLine(line.id, function () {
      if (isLast) { commitTutorialAndStart(); return; }
      state.setupStep++;
      showLine();
    });
  }

  // §3-3: どこをタップしても、全文表示済みでなければ即座に全文表示。表示済みなら次へ進む。
  function onTapWindow() {
    if (!lineReady) { finishTyping(); return; }
    advance();
  }

  // §4-4: スキップ時はカード演出も飛ばす。副作用5点はcommitTutorialAndStart()側に必ず1回だけ通す。
  function onSkip() {
    stopTyping();
    if (window.CardReveal) window.CardReveal.cancel();
    cleanupSeatReveal();
    commitTutorialAndStart();
  }

  // ---------- 画面構築(render()につき1回) ----------
  // v21 §3-1: どんぶりちゃんの絵と会話ウインドウを1枚の外枠(.setup-panel)にまとめる。
  // .setup-panel-top(透過・絵)と.setup-panel-body(不透明・セリフ)はその内側の2区画。
  function build() {
    var root = document.getElementById("screen-setup");
    window.UI.clear(root);

    var bg = h("div", { className: "setup-bg" });
    root.appendChild(bg);

    root.appendChild(h("button", {
      className: "btn small setup-skip", text: "スキップ", onclick: onSkip
    }));

    var charEl = h("span", { className: "setup-char emoji-font" }, [window.AssetImage.node(DONBURI)]);
    var topEl = h("div", { className: "setup-panel-top" }, [charEl]);

    var nameEl = h("div", { className: "setup-window-name", text: DONBURI.name });
    var bodyEl = h("div", { className: "setup-window-body" });
    var nextEl = h("div", { className: "setup-window-next emoji-font", text: "▶" });
    var bottomEl = h("div", { className: "setup-panel-body" }, [nameEl, bodyEl, nextEl]);

    // v21 追加指示: 透過した上段をタップしてもセリフが進むよう、onclickは外枠全体(.setup-panel)に
    // 付ける(モバイルでのタップ範囲を広げる意図的な変更)。.setup-skipはpanelの外なので影響を受けない。
    var panelEl = h("div", { className: "setup-panel", onclick: onTapWindow }, [topEl, bottomEl]);
    root.appendChild(panelEl);

    els = { bg: bg, char: charEl, body: bodyEl, next: nextEl, panel: panelEl };
    mountShopBackground();
  }

  function render(gameState, doneCb) {
    state = gameState;
    onDone = doneCb;
    if (state.setupStep == null || state.setupStep < 0) state.setupStep = 0;
    build();
    showLine();
  }

  return { render: render };
})();
