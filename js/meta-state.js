// STEP12(docs/新設計/12_STEP12_周回引き継ぎ_修正版.md): 周回をまたいで残すデータ(図鑑・記録・
// 既存キャラとの関係)。通常のセーブ(js/state.js、キー"ramen_v10_save")とは完全に別のキーに
// 持つ(§4「リセットしても消えない場所」「通常のセーブが壊れても、図鑑は残ること」)。
// window.GameState.clearSave()/reset()はこのファイルの中身に一切触れない。
// SAVE_VERSIONが上がっても、この器(META_VERSION)は別物なので巻き込まれて消えない。
window.MetaState = (function () {
  var META_KEY = "ramen_meta";
  var META_VERSION = 1;

  // 引き継ぐのは「履歴」と「関係」だけ(§2)。所持カード・お金・従業員の育成状態・設備・物件・
  // 評判・認知度は引き継がない(freshState()側で毎回作り直す。ここには持たない)。
  function freshMeta() {
    return {
      version: META_VERSION,
      runCount: 0, // 完了させた周回数(今プレイ中の周回はrunCount+1周目)
      // 図鑑: 一度でも入手した素材カード(カテゴリごとのid配列)。「見たことがある」状態だけを持つ。
      compendium: { soup: [], tare: [], noodle: [], topping: [] },
      // 既存キャラ5人(js/data/characters.js の cards: 麺屋の親父・記者・大家・常連・金貸し)との関係値。
      relationships: { menya: 0, reporter: 0, landlord: 0, oldman: 0, lender: 0 },
      // 既存の従業員5人(js/data/characters.js の staff: ユウタ・ミサキ・ゴンゾウ・リン・テツ)との
      // 関係値。「雇った人はリセット。既存5人は関係値だけ引き継ぐ」(§1)。育成状態(士気・能力の
      // 上乗せ・Lv)は引き継がない。
      staffRel: { yuta: 0, misaki: 0, gonzo: 0, rin: 0, tetsu: 0 },
      // 記録: 過去の周回の成績。新しい周回が終わるたびに1件追加する(上限は設けていない=
      // 52週×何十周も遊ぶことは現実的に考えにくいため、削除処理は作っていない)。
      records: []
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(META_KEY);
      if (!raw) return null;
      var m = JSON.parse(raw);
      if (!m || m.version !== META_VERSION) return null;
      return m;
    } catch (e) {
      return null;
    }
  }

  var meta = load() || freshMeta();

  function save() {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch (e) {
      console.warn("meta save failed", e);
    }
  }

  // 今プレイ中(またはこれから始める)の周回が何周目か。1始まり。
  function currentRunNumber() { return meta.runCount + 1; }
  // 直近に終わった周回が何周目だったか(result画面用)。recordRunEnd()より後に呼ぶ想定。
  // 一度もrecordRunEndが呼ばれていない場合は1を返す(通常は起こらない。result画面は
  // 52週を終えた後にしか出ないため)。
  function lastRunNumber() {
    return meta.records.length ? meta.records[meta.records.length - 1].runNumber : 1;
  }

  function isCollected(cat, id) {
    return !!(meta.compendium[cat] && meta.compendium[cat].indexOf(id) >= 0);
  }

  // 新しい周回の開始時、freshState()から呼ばれる。既存キャラとの関係値のコピーを返す
  // (参照を直接渡すとfreshState側の書き換えでmeta本体まで変わってしまうため複製する)。
  function startingRelationships() {
    var r = meta.relationships;
    return { menya: r.menya || 0, reporter: r.reporter || 0, landlord: r.landlord || 0, oldman: r.oldman || 0, lender: r.lender || 0 };
  }
  function startingStaffRel(id) { return meta.staffRel[id] || 0; }

  // §1「図鑑に載っているカードは、次の周回で試作から出やすくなる」の倍率。
  // 図鑑に載っている素材はそうでない素材の3倍出やすい(js/event-engine.jsのsoup_trialで使う)。
  // 「最初から持っている状態にはしない」「2周目が自動で勝てるようにはしない」の指示に沿い、
  // 出る「順番」が早まる程度に留め、入手自体を保証したり効果量を変えたりはしない。
  var COLLECTED_WEIGHT = 3;
  var UNCOLLECTED_WEIGHT = 1;
  function weightFor(cat, id) { return isCollected(cat, id) ? COLLECTED_WEIGHT : UNCOLLECTED_WEIGHT; }

  // 周回終了時(52週が終わってresult画面に入る直前)に1回だけ呼ぶ。
  // 今回の周回で得た素材・関係値を反映し、記録を1件積み、runCountを+1する。
  // 返り値: 今回の周回で新しく図鑑に載った素材({cat,id}の配列)。result画面の表示に使う。
  function recordRunEnd(state) {
    var newlyAdded = [];
    ["soup", "tare", "noodle", "topping"].forEach(function (cat) {
      (state.ownedMaterials[cat] || []).forEach(function (id) {
        if (id === "none") return;
        if (meta.compendium[cat].indexOf(id) < 0) {
          meta.compendium[cat].push(id);
          newlyAdded.push({ cat: cat, id: id });
        }
      });
    });
    // 関係値は「今回終わった時点の値」で置き換える(積み増しではなく上書き。前回より疎遠に
    // なった場合はそのまま反映される=良くも悪くも直近の関係が次の周回の出発点になる)。
    meta.relationships = {
      menya: state.relationships.menya || 0, reporter: state.relationships.reporter || 0,
      landlord: state.relationships.landlord || 0, oldman: state.relationships.oldman || 0,
      lender: state.relationships.lender || 0
    };
    ["yuta", "misaki", "gonzo", "rin", "tetsu"].forEach(function (id) {
      var s = state.staffState && state.staffState[id];
      // 一度も関わらなかった(staffStateが無い)場合は前回までの値をそのまま残す。
      if (s) meta.staffRel[id] = s.rel || 0;
    });
    meta.records.push({
      runNumber: currentRunNumber(), day: state.day, money: Math.round(state.money),
      reputation: Math.round(state.reputation), awareness: Math.round(state.awareness),
      property: state.property, staffHired: (state.staffHired || []).slice()
    });
    meta.runCount++;
    save();
    return newlyAdded;
  }

  // result画面の「図鑑の収集状況」用。対象はsoup_trialの抽選対象と同じ「unlock:start」の素材のみ
  // (event/card_menya/recipe_lv3で解禁される素材は試作では出ないため、図鑑の分母に含めない)。
  function compendiumStats() {
    var RECIPES = window.DATA.recipes;
    var total = 0, collected = 0;
    ["soup", "tare", "noodle", "topping"].forEach(function (cat) {
      RECIPES[cat].forEach(function (item) {
        if (item.unlock !== "start" || item.id === "none") return;
        total++;
        if (isCollected(cat, item.id)) collected++;
      });
    });
    return { total: total, collected: collected };
  }

  return {
    currentRunNumber: currentRunNumber,
    lastRunNumber: lastRunNumber,
    isCollected: isCollected,
    weightFor: weightFor,
    startingRelationships: startingRelationships,
    startingStaffRel: startingStaffRel,
    recordRunEnd: recordRunEnd,
    compendiumStats: compendiumStats
  };
})();
