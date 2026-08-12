// 開業フェーズ(v19): 選択を1つも挟まない案内画面。
// docs/完了/旧文書/v19_ラーメン屋_修正指示書.md §1・§3: 「物件→スープ→タレ→麺→トッピング→
// 設備→従業員」の7ステップ選択式を廃止し、どんぶりちゃんが話すだけの画面に置き換えた。
// プレイヤーは「次へ」を押すだけで、選ぶものは1つもない。スキップボタンで最後まで飛ばせる。
window.ScreenSetup = (function () {
  var h = window.UI.h;
  var U = window.Utils;
  var PROPERTY_DATA = window.DATA.property;
  var G = window.Guide;

  // v19 §4: 開業直後の状態は固定。物件はこの1つだけ、レシピもこの3+1つだけ、従業員はリン1人。
  var FIXED_PROPERTY_ID = "shotengai";
  var FIXED_RECIPE = { soup: "chicken", tare: "shoyu", noodle: "thin", topping: "none" }; // toppingは必ず文字列"none"。null/undefinedにしない(§2-1: recipeAggregate()がsoup/tare/noodleごと壊れるフォールバックに落ちるため)。
  var FIXED_STAFF_ID = "rin";

  var state, onDone;

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
        .replace("{rent}", U.formatMoney(prop.rent));
      return { id: line.id, text: text };
    });
    if (!isRepeatRun()) return all;
    var repeatIds = {};
    window.DATA.guide.tutorial.forEach(function (line) { if (line.repeatOk) repeatIds[line.id] = true; });
    return all.filter(function (line) { return repeatIds[line.id]; });
  }

  // ---------- 開業直後の状態を確定させる ----------
  // §2-2: 旧commitAndStart()が担っていた副作用5点(お金/従業員初期化/イベントスケジュール初期化/
  // 時計/セーブ)を1つも漏らさず移植する。物件・レシピ・従業員はここで固定値を書き込む
  // (以前はプレイヤーの選択をそのまま使っていた箇所)。スキップされても最後まで読まれても、
  // 呼ばれるのはこの関数1回だけ(呼んだ直後にonDone()でこの画面自体を離れるため)。
  function commitTutorialAndStart() {
    state.property = FIXED_PROPERTY_ID;
    state.equipment = []; // §4-1: 設備なし
    state.recipe = { soup: FIXED_RECIPE.soup, tare: FIXED_RECIPE.tare, noodle: FIXED_RECIPE.noodle, topping: FIXED_RECIPE.topping };
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

  // ---------- 進行 ----------
  function stepDots(lines) {
    var bar = h("div", { className: "step-dots" });
    lines.forEach(function (l, i) {
      bar.appendChild(h("div", {
        className: "dot" + (i === state.setupStep ? " active" : (i < state.setupStep ? " done" : ""))
      }));
    });
    return bar;
  }

  function draw() {
    var root = document.getElementById("screen-setup");
    window.UI.clear(root);
    var lines = tutorialLines();
    if (state.setupStep >= lines.length) state.setupStep = lines.length - 1;
    if (state.setupStep < 0) state.setupStep = 0;
    var last = state.setupStep === lines.length - 1;
    var line = lines[state.setupStep];

    root.appendChild(h("button", {
      className: "btn small setup-skip", text: "スキップ",
      onclick: commitTutorialAndStart
    }));

    root.appendChild(G.bar(line.text, false));
    if (window.MetaState) {
      root.appendChild(h("div", { className: "dim", style: { textAlign: "center", fontSize: "12px" }, text: window.MetaState.currentRunNumber() + "周目" }));
    }
    root.appendChild(stepDots(lines));

    // 固定ビューポートを守るため中身は置かない(セリフと「次へ」だけ、§3-2)。
    root.appendChild(h("div", { className: "scroll-area setup-body" }));

    root.appendChild(h("div", { className: "setup-footer", style: { justifyContent: "center" } }, [
      last
        ? h("button", { className: "btn primary", text: "開店する！", onclick: commitTutorialAndStart })
        : h("button", {
          className: "btn primary", text: "次へ",
          onclick: function () { state.setupStep++; draw(); }
        })
    ]));
  }

  function render(gameState, doneCb) {
    state = gameState;
    onDone = doneCb;
    if (state.setupStep == null || state.setupStep < 0) state.setupStep = 0;
    draw();
  }

  return { render: render };
})();
