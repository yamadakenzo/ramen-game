// ゲーム状態の定義とlocalStorage永続化
window.GameState = (function () {
  // v10 で時間の刻みが「1日単位」から「1時間単位+営業時間帯の選択」に変わり、
  // 営業時間の設定(businessHours)がstateに増えたため、旧セーブは読ませない。
  // キーごと変えているので、旧キーのデータが残っていても「続きから」に出てこない。
  var SAVE_KEY = "ramen_v10_save";
  // STEP1(docs/新設計/01_STEP1_新システム用データ基盤_修正版.md §1-2): 新システム用の器を
  // stateに追加したためバージョンを上げ、旧セーブは読ませない(移行処理は作らない・開発中のため)。
  // ただし今回から「バージョン不一致は無言で破棄しない」。main.jsのinit()がhasIncompatibleSave()で
  // 検出し、画面上で一言知らせてから始まる(このファイルのload()自体は今まで通り黙って失敗を返す)。
  // STEP4(docs/新設計/04_STEP4_ラーメン新パラメータとレシピ計算_修正版.md §9): レシピ素材の
  // 持ち方(oiliness廃止、quality/uniqueness/workload追加)が変わったため6→7に上げた。
  // 警告の仕組み自体はSTEP1で作り切っているので、ここでは変更しない。
  var SAVE_VERSION = 7;

  function freshState() {
    return {
      version: SAVE_VERSION,
      phase: "opening", // opening -> setup -> loop -> result
      openingStep: 0,
      setupStep: 0, // 0 資金,1 物件,2 スープ,3 タレ,4 麺,5 具,6 設備,7 従業員
      funding: null,
      property: null,
      recipe: { soup: null, tare: null, noodle: null, topping: null },
      // STEP1で新設した器(品質/濃さ/量/個性/原価/提供負荷)。STEP4(docs/新設計/
      // 04_STEP4_ラーメン新パラメータとレシピ計算_修正版.md)で計算式(js/scoring.jsの
      // recipeAggregate)側がこれと同じ基礎値(20/10/20/10/0/0)から実際に計算するようになった。
      // ただしこのフィールド自体(state.ramenStats)へ計算結果を書き戻す配線はまだ無く、
      // 今も値は既定値のまま動かない(recipeAggregate()はstateを介さず毎回その場で計算して返す)。
      ramenStats: { quality: 20, richness: 10, volume: 20, uniqueness: 10, cost: 0, workload: 0 },
      equipment: [],
      staffHired: [], // staff id 配列
      price: 850,
      money: 0,
      loan: { monthlyRepay: 0, monthsLeft: 0 },
      day: 1, // v09-3: 開業からの通算日数(1始まり)。月日・曜日は表示時にUtilsで逆算する
      clockMin: 11 * 60, // v10-2: 「今日」の中の時計(分、0始まり)。開店前は無く、開いている帯の頭から始まる
      businessHours: ["lunch", "night"], // v10-2: 選んでいる営業時間帯(次の週から反映)。初期値は昼+夜
      businessHoursActive: ["lunch", "night"], // 今週すでに反映されている帯(週の頭でbusinessHoursから複製)
      reputation: 50,
      // STEP1: 認知度の器(新規)。評判(reputation、上の行)とは別物として持つが、今回は値が動かず
      // どこからも参照されない(docs/新設計/01_STEP1_新システム用データ基盤_修正版.md §2-3)。
      awareness: 30,
      relationships: { menya: 0, reporter: 0, landlord: 0, oldman: 0, lender: 0 },
      staffState: {}, // id -> {morale, rel, lowMoraleWeeks, statBonus}
      cardsUnlocked: {}, // card id -> true (関係値要求を満たしイベント発生済み)
      cardsMet: {}, // card id -> true (関係値要求を満たした瞬間、イベント待ち)
      comboFired: {},
      firedEventIds: {}, // 一度きりイベントの発生済みフラグ
      recipeChangeLog: [], // 変更があった週番号のログ(直近1ヶ月分の判定用)
      flags: {
        regularLowWeeks: 0,
        recipeLockWeeksLeft: 0,
        weekFlashDetailed: true, // v06-2-1: 週の収支表示は詳細版が初期状態
        fatigue: 0,              // v07-3-3: 唯一の新規パラメータ。0〜100
        tasteBonus: 0,           // v07: 「スープの試作」の積み上げ(素材の質に加算)
        costDiscountPct: 0,      // v07: 「仕入れ先を回る」の積み上げ(原価に掛ける割引%)
        eventRecipesUnlocked: false, // v07: 「他店を食べ歩く」で野菜スープ・辛味タレが解禁
        meetingAttendCount: 0    // v07: 「商店街の寄合に出る」を選んだ回数(成功率が積み上がる)
      },
      history: [], // {week, month, customers, revenue, foodCost, rent, wage, loanRepay, profit, money, satisfaction, queueLevel}
      eventLog: [], // {week, id, title}
      pendingEvents: [], // このtickで表示すべきイベントのキュー
      currentEvent: null,
      speed: 1, // 0=停止,1,2,4。v09: 「進んでいるか」はこの値とpauseReasons(loop.js)から決まるので、
      // 別に running フラグは持たない(以前はweekEndActive中にspeedを0へ強制的に書き換えて流用していたが、
      // それだと「選んでいた速度」を覚えていられなかった。v09で廃止)。
      weekEndActive: false, // 週末シーケンス中(「次の週へ」を押すまでtrue)。UIの表示・安全な再開判定に使う
      gameOverReason: null
    };
  }

  var state = freshState();

  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("save failed", e);
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      var loaded = JSON.parse(raw);
      if (!loaded || loaded.version !== SAVE_VERSION) return false;
      state = loaded;
      return true;
    } catch (e) {
      console.warn("load failed", e);
      return false;
    }
  }

  function hasSave() {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch (e) {
      return false;
    }
  }

  // STEP1: 「セーブはあるがバージョンが合わない(=読めば破棄される)」ことを、実際にload()して
  // stateを壊す前に判定するための関数。main.jsのinit()がこれで判定し、無言で消す前に
  // 画面上で一言警告を出す(docs/新設計/01_STEP1_新システム用データ基盤_修正版.md §1-2)。
  function hasIncompatibleSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      var loaded = JSON.parse(raw);
      return !loaded || loaded.version !== SAVE_VERSION;
    } catch (e) {
      return true; // 壊れているデータも「今の形式と互換ではない」扱いにする
    }
  }

  function clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (e) { /* noop */ }
  }

  function reset() {
    state = freshState();
  }

  return {
    get: function () { return state; },
    save: save,
    load: load,
    hasSave: hasSave,
    hasIncompatibleSave: hasIncompatibleSave,
    clearSave: clearSave,
    reset: reset
  };
})();
