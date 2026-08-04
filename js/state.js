// ゲーム状態の定義とlocalStorage永続化
window.GameState = (function () {
  var SAVE_KEY = "ramen_v01_save";

  function freshState() {
    return {
      version: 1,
      phase: "opening", // opening -> setup -> loop -> result
      openingStep: 0,
      setupStep: 0, // 0 funding,1 property,2 recipe,3 equipment,4 staff
      funding: null,
      property: null,
      recipe: { soup: null, tare: null, noodle: null, topping: null },
      equipment: [],
      staffHired: [], // staff id 配列
      price: 850,
      money: 0,
      loan: { monthlyRepay: 0, monthsLeft: 0 },
      week: 1,
      reputation: 50,
      relationships: { menya: 0, reporter: 0, landlord: 0, oldman: 0, lender: 0 },
      staffState: {}, // id -> {morale, rel, lowMoraleWeeks}
      cardsUnlocked: {}, // card id -> true (関係値要求を満たしイベント発生済み)
      cardsMet: {}, // card id -> true (関係値要求を満たした瞬間、イベント待ち)
      comboFired: {},
      firedEventIds: {}, // 一度きりイベントの発生済みフラグ
      recipeChangeLog: [], // 変更があった週番号のログ(直近1ヶ月分の判定用)
      flags: {
        regularLowWeeks: 0,
        recipeLockWeeksLeft: 0
      },
      history: [], // {week, month, customers, revenue, foodCost, rent, wage, loanRepay, profit, money, satisfaction, queueLevel}
      eventLog: [], // {week, id, title}
      pendingEvents: [], // このtickで表示すべきイベントのキュー
      currentEvent: null,
      speed: 1, // 0=停止,1,2,4
      running: false,
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
      if (!loaded || loaded.version !== 1) return false;
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
