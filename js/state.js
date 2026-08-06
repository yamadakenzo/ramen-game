// ゲーム状態の定義とlocalStorage永続化
window.GameState = (function () {
  // v09 で時間の持ち方が「週+週内の日」から「開業からの通算日数(state.day)」1本に変わり、
  // 停止の仕組みも state.running を廃して pauseReasons(js/screens/loop.js)へ一本化したため、
  // 旧セーブは読ませない。キーごと変えているので、旧キーのデータが残っていても「続きから」に出てこない。
  var SAVE_KEY = "ramen_v09_save";
  var SAVE_VERSION = 4;

  function freshState() {
    return {
      version: SAVE_VERSION,
      phase: "opening", // opening -> setup -> loop -> result
      openingStep: 0,
      setupStep: 0, // 0 資金,1 物件,2 スープ,3 タレ,4 麺,5 具,6 設備,7 従業員
      funding: null,
      property: null,
      recipe: { soup: null, tare: null, noodle: null, topping: null },
      equipment: [],
      staffHired: [], // staff id 配列
      price: 850,
      money: 0,
      loan: { monthlyRepay: 0, monthsLeft: 0 },
      day: 1, // v09-3: 開業からの通算日数(1始まり)。時間はこれ1本だけで持つ。月日は表示時にUtilsで逆算する
      reputation: 50,
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
    clearSave: clearSave,
    reset: reset
  };
})();
