// 満足度・客数・匂い・行列の計算。docs/過去/v01_ラーメン屋_実装指示書.md の式をそのまま実装する。
window.Scoring = (function () {
  var U = window.Utils;
  var SEGMENTS = window.DATA.segments.segments;
  var RECIPES = window.DATA.recipes;
  var PROPERTIES = window.DATA.property.properties;
  var EQUIPMENT = window.DATA.property.equipment; // STEP7: 週維持費(weekly_upkeep)の参照に使う
  var STAFF = window.DATA.characters.staff; // STEP5: 従業員の新4能力(newStats/maxLevel)の参照に使う

  // STEP1: BASE_CUSTOMERS / SEATS_TO_WEEKLY_CAPACITY / EXTRA_BOILER_VOLUME は
  // js/utils.js の window.* へ値そのまま移した(docs/新設計/01_STEP1_新システム用データ基盤_修正版.md §2-5)。
  var BASE_CUSTOMERS = window.BASE_CUSTOMERS;
  var SEATS_TO_WEEKLY_CAPACITY = window.SEATS_TO_WEEKLY_CAPACITY;
  var EXTRA_BOILER_VOLUME = window.EXTRA_BOILER_VOLUME;

  // STEP4(docs/新設計/04_STEP4_ラーメン新パラメータとレシピ計算_修正版.md §4): 品質・濃さ・量・
  // 個性の基礎値。STEP1でstate.ramenStatsに仮置きした既定値と同じ(この4値+cost0+workload0から
  // 素材の値を加算していく、という指示どおりの構成)。
  var RAMEN_BASE = { quality: 20, richness: 10, volume: 20, uniqueness: 10, cost: 0, workload: 0 };

  // STEP2(docs/新設計/02_STEP2_素材カード基本システム_修正版.md): 素材カードの所持判定。
  // 対象は unlock:"start" の素材だけ(§1の初期8枚+試作で増える分)。unlock:"event"/"card_menya"/
  // "recipe_lv3" の素材(野菜・辛味・自家製麺・ダブル)は既存の解放条件(state.flags.eventRecipesUnlocked
  // 等)で今まで通り制御し、このSTEPでは触れていない。トッピングの「なし」は常に選択可能。
  function isMaterialOwned(state, cat, id) {
    if (cat === "topping" && id === "none") return true;
    var owned = state.ownedMaterials && state.ownedMaterials[cat];
    return !!owned && owned.indexOf(id) >= 0;
  }

  // unlock:"start"のうち、まだ持っていない素材の一覧({cat, item})。STEP2時点の抽選対象
  // (STEP3以降はallStartMaterialsForDraw()の方を試作の抽選に使う。この関数自体は他の呼び先が
  // 無くても、意味の分かりやすい単体の関数として残しておく)。
  function unownedStartMaterials(state) {
    var out = [];
    ["soup", "tare", "noodle", "topping"].forEach(function (cat) {
      RECIPES[cat].forEach(function (item) {
        if (item.unlock !== "start" || item.id === "none") return;
        if (!isMaterialOwned(state, cat, item.id)) out.push({ cat: cat, item: item });
      });
    });
    return out;
  }

  // STEP3(docs/新設計/03_STEP3_素材カード育成と分岐_修正版.md §1): 未所持・所持済み(重複)の
  // どちらも試作の抽選対象になる({cat, item, owned}の配列)。実際の重み付けはjs/event-engine.js側
  // (js/meta-state.jsの図鑑補正と掛け合わせる必要があるため)。
  function allStartMaterialsForDraw(state) {
    var out = [];
    ["soup", "tare", "noodle", "topping"].forEach(function (cat) {
      RECIPES[cat].forEach(function (item) {
        if (item.unlock !== "start" || item.id === "none") return;
        out.push({ cat: cat, item: item, owned: isMaterialOwned(state, cat, item.id) });
      });
    });
    return out;
  }

  // ---------- STEP3: 素材カードのLv・分岐 ----------
  // Lv2に必要な累計重複枚数=1枚、Lv3=3枚(Lv2到達後さらに2枚。指示書§2の例と同じ配分)。
  var MATERIAL_LV2_DUPES = 1;
  var MATERIAL_LV3_DUPES = 3;
  // Lvが上がるたびに、選んだ分岐の軸へ加算する量(Lv到達時点の累計値。Lv2で+4、Lv3で+8)。
  var MATERIAL_LEVEL_STAT_BONUS = { 2: 4, 3: 8 };
  // Lvが上がるたびに原価へ掛かる倍率(§2「原価も上がる」必須要件。分岐の種類に関わらず一律)。
  var MATERIAL_LEVEL_COST_MULT = { 1: 1, 2: 1.15, 3: 1.35 };
  // 「増やす」分岐(volume)のときだけ、提供負荷(workload)にも上乗せする(§3の方向性の例の表どおり)。
  // workload自体はSTEP4から一貫してどの計算にも使われていない値のため、表示上の意味づけに留まる。
  var MATERIAL_LEVEL_WORKLOAD_BONUS = { 2: 2, 3: 4 };

  // 素材カード1枚の現在の育成状況。stateにまだ記録が無い(=未所持、または初期化前)場合は
  // Lv1・重複0・分岐未選択として扱う(安全側のデフォルト)。
  function materialCardState(state, cat, id) {
    var rec = state && state.materialCards && state.materialCards[cat] && state.materialCards[cat][id];
    var dupes = rec ? (rec.dupes || 0) : 0;
    var branch = rec ? (rec.branch || null) : null;
    // 分岐を選ぶまではLv2に上がらない(§3「Lv2に上がるとき、2つの方向から1つ選ぶ」)。
    var level = !branch ? 1 : (dupes >= MATERIAL_LV3_DUPES ? 3 : 2);
    var pendingBranch = dupes >= MATERIAL_LV2_DUPES && !branch; // 分岐選択待ち
    var dupesToNextLevel = 0;
    if (level === 1 && !pendingBranch) dupesToNextLevel = Math.max(0, MATERIAL_LV2_DUPES - dupes);
    else if (level === 2) dupesToNextLevel = Math.max(0, MATERIAL_LV3_DUPES - dupes);
    return { level: level, dupes: dupes, branch: branch, pendingBranch: pendingBranch, dupesToNextLevel: dupesToNextLevel, maxed: level >= 3 };
  }

  // STEP3(§3「分岐の内容は、選ぶ前に画面で全て見えていること」): 分岐を選ぶ前に、選んだら
  // Lv2・Lv3でそれぞれ軸と原価がいくつ動くかを見せるためのプレビュー。stateを変更しない。
  function branchOptionPreview(cat, id, branchKey) {
    var base = U.findById(RECIPES[cat], id);
    var branchDef = window.DATA.materialBranches && window.DATA.materialBranches[cat] && window.DATA.materialBranches[cat][branchKey];
    if (!base || !branchDef) return null;
    var costLv2 = Math.round(base.cost * MATERIAL_LEVEL_COST_MULT[2]) - base.cost;
    var costLv3 = Math.round(base.cost * MATERIAL_LEVEL_COST_MULT[3]) - base.cost;
    return {
      key: branchDef.key, label: branchDef.label,
      lv2: { statDelta: MATERIAL_LEVEL_STAT_BONUS[2], costDelta: costLv2 },
      lv3: { statDelta: MATERIAL_LEVEL_STAT_BONUS[3], costDelta: costLv3 }
    };
  }

  // 素材1枚の実効値(Lv・分岐を反映した4軸+原価+提供負荷)。unlock:"start"以外の素材(試作では
  // 出ない=重複が起きない)はLvの対象外なので、常に生の値をそのまま返す。
  function effectiveMaterialStats(state, cat, id) {
    var base = U.findById(RECIPES[cat], id);
    if (!base) return null;
    var out = {
      quality: base.quality, richness: base.richness, volume: base.volume, uniqueness: base.uniqueness,
      cost: base.cost, workload: base.workload, smell: base.smell || 0
    };
    if (base.unlock !== "start") return out;
    var cs = materialCardState(state, cat, id);
    if (cs.level === 1) return out;
    var branchDef = window.DATA.materialBranches && window.DATA.materialBranches[cat];
    var chosen = branchDef && branchDef[cs.branch];
    if (!chosen) return out;
    var bonus = MATERIAL_LEVEL_STAT_BONUS[cs.level] || 0;
    out[chosen.key] = out[chosen.key] + bonus;
    out.cost = Math.round(out.cost * MATERIAL_LEVEL_COST_MULT[cs.level]);
    if (chosen.key === "volume") out.workload = out.workload + (MATERIAL_LEVEL_WORKLOAD_BONUS[cs.level] || 0);
    return out;
  }

  // STEP6(docs/新設計/06_STEP6_従業員スカウト_修正版.md): 既存5人(window.DATA.characters.staff)
  // に加え、スカウトで増えた従業員(state.scoutedStaff、プレイごとに生成されるためstate側に持つ)も
  // 同じ形で引けるようにした検索関数。これまで各画面に散らばっていた U.findById(STAFF, id) を
  // 全てこちらへ置き換えてある(既存5人だけを見ていたコードがスカウト勢を見落とさないようにするため)。
  function findStaffDef(state, id) {
    var def = U.findById(STAFF, id);
    if (def) return def;
    return (state && state.scoutedStaff && state.scoutedStaff[id]) || null;
  }

  // ---------- STEP5(docs/新設計/05_STEP5_従業員能力と育成_修正版.md): 従業員の新4能力 ----------
  // 効果は「調理・接客・速度」の3つだけ配線する。開発は器を持つだけで今回はどこからも参照しない(§2-4)。
  // 現在Lvで伸びた分の上乗せ(newStatBonus)は state.staffState[id] 側にあり、静的データ
  // (js/data/characters.jsのnewStats)は書き換えない(既存のstatBonusと同じ考え方)。
  function effectiveNewStat(id, key, state) {
    var def = findStaffDef(state, id);
    if (!def || !def.newStats) return null;
    var sstate = state.staffState && state.staffState[id];
    var bonus = (sstate && sstate.newStatBonus && sstate.newStatBonus[key]) || 0;
    return U.clamp(def.newStats[key] + bonus, 1, 10);
  }
  // 厨房にいる(=雇っている)従業員の調理の平均。誰もいなければ「増減なし」の基準である5を返す。
  function staffCookingAvg(state) {
    var vals = (state.staffHired || []).map(function (id) { return effectiveNewStat(id, "cooking", state); })
      .filter(function (v) { return v != null; });
    if (!vals.length) return 5;
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }
  // 接客の平均。誰もいなければ加点なし(0)。
  function staffServiceAvg(state) {
    var vals = (state.staffHired || []).map(function (id) { return effectiveNewStat(id, "service", state); })
      .filter(function (v) { return v != null; });
    if (!vals.length) return 0;
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }
  // 速度の合計(平均ではない。§2-2の式どおり全員分を足す)。誰もいなければ0。
  function staffSpeedSum(state) {
    var vals = (state.staffHired || []).map(function (id) { return effectiveNewStat(id, "speed", state); })
      .filter(function (v) { return v != null; });
    return vals.reduce(function (a, b) { return a + b; }, 0);
  }
  // STEP8(docs/新設計/08_STEP8_複数ラーメンとサイドメニュー_修正版.md §1): 開発の合計
  // (厨房にいる=雇っている従業員全員ぶん)。メニュー枠の解放判定に使う。誰もいなければ0。
  function staffDevelopmentSum(state) {
    var vals = (state.staffHired || []).map(function (id) { return effectiveNewStat(id, "development", state); })
      .filter(function (v) { return v != null; });
    return vals.reduce(function (a, b) { return a + b; }, 0);
  }
  // §2-1: 最終品質 = レシピの品質 + (調理の平均-5)×3 + 設備補正。設備補正に該当する設備はまだ
  // 無いため(STEP7で追加予定)、現時点は常に0。新しいペナルティ機構は作らず、既存のagg.qualityに
  // 加算するだけ(素材品質と同じ0〜100前後のスケールにそのまま足し込む)。
  function cookingQualityBonus(state) {
    return (staffCookingAvg(state) - 5) * 3;
  }
  // STEP7(docs/新設計/07_STEP7_設備_修正版.md §3): 高性能茹で麺器・大型寸胴・券売機の効果を
  // ここへ読み替えた(旧: 茹で麺器と券売機は店の"speed"スタット、茹で麺器と大型寸胴は座席キャパの
  // 倍率だった)。加算量は実装側で決めた値(コストと旧効果の大きさに応じて配分。詳細はdocs/
  // 設計判断記録.md参照): 茹で麺器+80(旧効果が2つ分あり最大)、券売機+60(最も高価、デメリットは
  // 維持)、大型寸胴+50(最も安価)。券売機の家族連れ・観光客ペナルティ(computeSatisfaction内)は
  // 変更していない。
  function equipmentProcessingBonus(state) {
    var bonus = 0;
    if (state.equipment.indexOf("noodle_boiler") >= 0) bonus += 80;
    if (state.equipment.indexOf("ticket_machine") >= 0) bonus += 60;
    if (state.equipment.indexOf("big_pot") >= 0) bonus += 50;
    return bonus;
  }
  // ---------- STEP8(docs/新設計/08_STEP8_複数ラーメンとサイドメニュー_修正版.md): メニュー枠 ----------
  // §1: 枠は開発の合計(厨房にいる従業員全員ぶん)で解放する。閾値は累積(ラーメン3品目の16は
  // 2品目の8を自動的に満たす)ので、各枠を独立に判定するだけでよい。
  var UNLOCK = { ramen2: 8, side1: 5, side2: 12, ramen3: 16 };
  function unlockedRamenSlots(state) {
    var dev = staffDevelopmentSum(state);
    var n = 1;
    if (dev >= UNLOCK.ramen2) n++;
    if (dev >= UNLOCK.ramen3) n++;
    return n;
  }
  function unlockedSideSlots(state) {
    var dev = staffDevelopmentSum(state);
    var n = 0;
    if (dev >= UNLOCK.side1) n++;
    if (dev >= UNLOCK.side2) n++;
    return n;
  }
  // STEP9(docs/新設計/09_STEP9_客層相性_注文_満足度_修正版.md §1): 実際に置いてあるラーメンの
  // 一覧(recipeオブジェクトの配列)。先頭は必ずラーメン1品目(state.recipe)。「品」として数える
  // 条件はactiveRamenCountと同じ(枠が解放済み、かつ4カテゴリ全部が埋まっている)。
  function availableRamens(state) {
    var slots = unlockedRamenSlots(state);
    var list = [state.recipe];
    (state.extraRamens || []).slice(0, slots - 1).forEach(function (r) {
      if (r && r.soup && r.tare && r.noodle && r.topping) list.push(r);
    });
    return list;
  }
  // 「品」として数えるのは、枠が解放されていて、かつ実際にsoup/tare/noodle/toppingが
  // 全部埋まっているラーメンだけ(未設定の解放枠はメニュー係数に影響しない)。
  function activeRamenCount(state) {
    return availableRamens(state).length;
  }
  function activeSideCount(state) {
    var slots = unlockedSideSlots(state);
    return U.clamp((state.sideMenu || []).length, 0, slots);
  }
  // §3: メニュー係数 = 1 − (ラーメンの品数−1)×0.12 − サイドの品数×0.06
  function menuCoefficient(state) {
    return 1 - (activeRamenCount(state) - 1) * 0.12 - activeSideCount(state) * 0.06;
  }

  // STEP13(docs/新設計/13_STEP13_全体統合_バランス是正_UI_修正版.md §1): 「満足度が高いと、
  // 上限そのものが伸びる」係数。満足度50を基準(×1.0)に、そこから1点動くごとに約3%
  // (1/33)動く。下限0.4・上限2.5でクランプ(満足度0でも上限が消えてなくならないよう下限を、
  // 青天井になって「上限が全く効かなくなる」ことが無いよう上限を、それぞれ設けた)。
  // 数値の選定過程(なぜ単純な満足度/50ではなくこの傾きにしたか)はdocs/設計判断記録.md参照。
  var SATISFACTION_CAP_MULT_MIN = 0.4;
  var SATISFACTION_CAP_MULT_MAX = 2.5;
  var SATISFACTION_CAP_MULT_SLOPE = 33;
  function satisfactionCapMultiplier(satisfaction) {
    var s = satisfaction == null ? 50 : satisfaction;
    return U.clamp(1 + (s - 50) / SATISFACTION_CAP_MULT_SLOPE, SATISFACTION_CAP_MULT_MIN, SATISFACTION_CAP_MULT_MAX);
  }

  // v49-1(docs/指示書/v49-1_プレイヤー作業_試作指示書.md §3): **プレイヤー(店主)が先週こなした杯数。**
  // 単位の換算は要らない——この関数群の単位はもともと「人/週」で、**客1人=1杯**
  // (computeWeeklyFinance の revenue += c × price、1人が1杯だけ買う)、かつ絵の上の1杯は
  // 週客数をそのまま曜日×帯へ配分したもの(weeklyBandSchedule)なので、**絵の上で1杯届けた=週の
  // 処理能力1人ぶん**がそのまま成り立つ。新しい係数・定数は1つも作らない(指示書§3)。
  // **今週の回数(weekCount)ではなく先週(lastWeekCount)を読む。** 週の客数は週の開始時に1回だけ
  // 確定する(loop.js の stageWeekCustomers)ので、今週の途中で増える値を入れると同じ週の計算が
  // 途中で変わってしまう。逆流は「週境界をまたぐ一方向」に留める(v49 調査 付記2)。
  // 旧セーブに state.playerWork は無い(SAVE_VERSION は 25 のまま。propCell と同じ「読む側が
  // 既定で補う」作法。§65・§72)。ここでは state を書き換えない(読むだけ)。
  function playerWeeklyCups(state) {
    var pw = state && state.playerWork;
    var n = pw && pw.lastWeekCount;
    return (typeof n === "number" && isFinite(n) && n > 0) ? n : 0;
  }

  // §2-2(STEP5): 週の処理可能人数(客数の上限キャップ)。120 + 速度の合計×30 + 設備補正、に
  // STEP8(§3)のメニュー係数を掛ける。
  // STEP13(§1): さらに満足度係数を1つ掛けるだけ(「新しい仕組みを足さないこと」に対応、既存の
  // 式はそのまま)。satisfactionは省略可(呼び出し元がまだ客数を計算していない場面向けの保険。
  // 省略時は基準の50=×1.0として扱う。既存の呼び出し元(UI表示等)の挙動を壊さないため)。
  // v49-1: 式を1か所(capacityBase)にまとめ、**プレイヤーぶんを含む/含まない**の2つの入口を出した。
  //   staffProcessingCapacity()     … プレイヤーぶん込み。**週の客数の上限**(computeWeeklyCustomers)と
  //                                   パネルの「週の処理可能人数」表示(loop.js)が使う。名前は既存の
  //                                   呼び出し元を壊さないためそのまま(意味は「店の処理可能人数」に広がった)。
  //   staffOnlyProcessingCapacity() … 従業員と設備だけ。**絵の目標間隔 T**(shop-view.js の update)専用。
  // 分けた理由(指示書§0-①): プレイヤーが手伝うと W が増え、T = min(W,S) が縮んで**従業員の絵まで
  // 速くなる**。それは「計算→絵」の向きとしては正しいが、見え方として意図と違う(v49 調査 付記1)。
  // 絵の側は従業員ぶんだけを見る。
  function capacityBase(state, includePlayer) {
    return 120 + staffSpeedSum(state) * 30 + equipmentProcessingBonus(state)
      + (includePlayer ? playerWeeklyCups(state) : 0);
  }
  function staffProcessingCapacity(state, satisfaction) {
    return capacityBase(state, true) * menuCoefficient(state) * satisfactionCapMultiplier(satisfaction);
  }
  function staffOnlyProcessingCapacity(state, satisfaction) {
    return capacityBase(state, false) * menuCoefficient(state) * satisfactionCapMultiplier(satisfaction);
  }

  // STEP8(§2): サイドメニューの週間販売。客がどのラーメンを選ぶかの判定(STEP9)とは独立に、
  // 「よく頼む客層は高い確率、それ以外は低い確率」で単純に注文する(指示書§2「今回は単純でよい」)。
  // 確率は実装側で決めた値(PRIMARY_PROB/OTHER_PROB。根拠はdocs/設計判断記録.md参照)。
  // customersResultはcomputeWeeklyCustomers()の返り値(客層別の週客数)をそのまま渡す。
  var SIDE_PRIMARY_PROB = 0.35; // 「よく頼む客層」が1人あたり注文する確率(期待値としてそのまま掛ける)
  var SIDE_OTHER_PROB = 0.08;   // それ以外の客層
  function computeSideSales(state, customersResult) {
    var SIDES = window.DATA.sides.items;
    var revenue = 0, cost = 0;
    var bySide = {};
    (state.sideMenu || []).forEach(function (sideId) {
      var side = U.findById(SIDES, sideId);
      if (!side) return;
      var orders = 0;
      Object.keys(customersResult.results || {}).forEach(function (segId) {
        var count = customersResult.results[segId].count || 0;
        var prob = side.segments.indexOf(segId) >= 0 ? SIDE_PRIMARY_PROB : SIDE_OTHER_PROB;
        orders += count * prob;
      });
      orders = Math.round(orders);
      bySide[sideId] = orders;
      revenue += orders * side.price;
      cost += orders * side.cost;
    });
    return { revenue: revenue, cost: cost, bySide: bySide };
  }

  function recipeAggregate(recipe, state) {
    var soupDef = U.findById(RECIPES.soup, recipe.soup);
    var tareDef = U.findById(RECIPES.tare, recipe.tare);
    var noodleDef = U.findById(RECIPES.noodle, recipe.noodle);
    var toppingDef = U.findById(RECIPES.topping, recipe.topping);
    if (!soupDef || !tareDef || !noodleDef || !toppingDef) {
      return {
        quality: RAMEN_BASE.quality, richness: RAMEN_BASE.richness, volume: RAMEN_BASE.volume,
        uniqueness: RAMEN_BASE.uniqueness, cost: RAMEN_BASE.cost, workload: RAMEN_BASE.workload, smell: 0
      };
    }
    // STEP3(docs/新設計/03_STEP3_素材カード育成と分岐_修正版.md §2): Lv・分岐で伸びた実効値を
    // 使う(生の素材データそのまま足すのではない)。stateが無い・Lv1のまま等の場合は生の値と
    // 一致するので、STEP3より前の呼び出し元(recipeOverrideでのプレビュー等)の挙動は変わらない。
    var soup = effectiveMaterialStats(state, "soup", recipe.soup) || soupDef;
    var tare = effectiveMaterialStats(state, "tare", recipe.tare) || tareDef;
    var noodle = effectiveMaterialStats(state, "noodle", recipe.noodle) || noodleDef;
    var topping = effectiveMaterialStats(state, "topping", recipe.topping) || toppingDef;
    var volumeBonus = (state && state.equipment && state.equipment.indexOf("extra_boiler") >= 0)
      ? EXTRA_BOILER_VOLUME : 0;
    var rawCost = soup.cost + tare.cost + noodle.cost + topping.cost;
    // v07: 「仕入れ先を回る」で積み上げた割引(%)。既存の「原価」という数字に効かせる(新しい数値は作らない)。
    var discountPct = (state && state.flags && state.flags.costDiscountPct) || 0;
    var cost = rawCost * (1 - discountPct / 100);
    return {
      quality: RAMEN_BASE.quality + soup.quality + tare.quality + noodle.quality + topping.quality,
      // STEP4 §2: 旧richness・旧oilinessは素材データ側で(richness+oiliness)/2に統合済み(js/data/recipes.js)。
      // ここでは統合済みのrichnessを合計するだけでよい(「合計してから平均」と数学的に同じ結果になる)。
      richness: RAMEN_BASE.richness + soup.richness + tare.richness + noodle.richness + topping.richness,
      volume: RAMEN_BASE.volume + soup.volume + tare.volume + noodle.volume + topping.volume + volumeBonus,
      uniqueness: RAMEN_BASE.uniqueness + soup.uniqueness + tare.uniqueness + noodle.uniqueness + topping.uniqueness,
      cost: Math.round(RAMEN_BASE.cost + cost),
      // STEP4 §5: 器に入れるだけ。どの計算からも参照しない(処理できる人数の仕組みができるSTEP5以降で使う)。
      workload: RAMEN_BASE.workload + soup.workload + tare.workload + noodle.workload + topping.workload,
      smell: soup.smell + tare.smell
    };
  }

  function getProperty(state) { return U.findById(PROPERTIES, state.property); }

  // v24(docs/指示書/v24_席の設備化とプレゼント演出_指示書.md §2-4、
  // docs/指示書/v24_追補_調査への回答と追加指示.md §3): 席は物件の固定値から state.seats
  // (持ち物)へ移った。この関数は新設ではなく既存関数(STEP7由来)の中身の書き換え——
  // シグネチャ・返り値の意味は変えていない。変えたのは「カウンター席の数をどこから読むか」だけ
  // (p.seats_counter → state.seats.counter)。
  // v32(docs/指示書/v32_斜め上視点_指示書.md §1・§3-2): table_seats設備の+4が、この関数と
  // js/screens/shop-view.js側の描画とで別々に書かれている二重管理だったため(懸念11)、
  // tableSeats()へ1箇所に寄せた。shop-view.jsはtotalSeats()ではなくtableSeats()を読む
  // (totalSeats()はカウンター込みの合計で、描画側はカウンター・テーブルを別々の絵で
  // 描き分ける必要があるため、テーブルだけの数が要る)。加算量そのものは変えていない。
  function tableSeats(state) {
    var p = getProperty(state);
    if (!p) return 0;
    var bonus = state.equipment.indexOf("table_seats") >= 0 ? 4 : 0;
    return p.seats_table + bonus;
  }
  function totalSeats(state) {
    var p = getProperty(state);
    if (!p) return 0;
    var counter = (state.seats && state.seats.counter) || 0;
    return counter + tableSeats(state);
  }

  // STEP7(docs/新設計/07_STEP7_設備_修正版.md §1〜2): 所持している設備の週維持費の合計。
  // weekly_upkeepを持たない設備(麺量アップ)は0として扱う(指示書の対象8種に含まれないため)。
  // 週ごとにこの額を引く(月初にまとめない)。
  function weeklyEquipUpkeep(state) {
    var total = 0;
    (state.equipment || []).forEach(function (id) {
      var eq = U.findById(EQUIPMENT, id);
      if (eq && eq.weekly_upkeep) total += eq.weekly_upkeep;
    });
    // v24(指示書§5-2): カウンター席の週維持費も、既存の設備週維持費と同じ枠でまとめて引く
    // (新しい行は作らない。週次収支表示の「設備維持費」にそのまま合算される)。
    var seatDef = window.DATA.seats && U.findById(window.DATA.seats, "counter");
    if (seatDef && seatDef.weekly_upkeep && state.seats) {
      total += (state.seats.counter || 0) * seatDef.weekly_upkeep;
    }
    return total;
  }

  function computeShopStats(state) {
    var speed = 40, cleanliness = 55, brightness = 35;
    // STEP7(docs/新設計/07_STEP7_設備_修正版.md §3): ticket_machine/noodle_boilerの速度加算は
    // ここから撤去し、staffProcessingCapacity()(週の処理可能人数)へ読み替えた。ticket_machineの
    // デメリット(家族連れ・観光客-10、下のcomputeSatisfaction内)はそのまま残す。
    if (state.equipment.indexOf("bright_light") >= 0) brightness += 30;
    if (state.staffHired.indexOf("misaki") >= 0) { cleanliness += 15; brightness += 5; }
    if (state.staffHired.indexOf("tetsu") >= 0) { cleanliness += 5; }
    return {
      speed: U.clamp(speed, 0, 100),
      cleanliness: U.clamp(cleanliness, 0, 100),
      brightness: U.clamp(brightness, 0, 100)
    };
  }

  function smellEffective(state) {
    var agg = recipeAggregate(state.recipe, state);
    var smell = agg.smell;
    if (state.equipment.indexOf("exhaust") >= 0) smell *= 0.3; // 強力ダクトで70%軽減
    return smell;
  }

  function meetsRequires(seg, state) {
    if (!seg.requires) return true;
    for (var i = 0; i < seg.requires.length; i++) {
      if (state.equipment.indexOf(seg.requires[i]) < 0) return false;
    }
    return true;
  }

  // STEP4(§4): 品質は客層ごとの理想値を持たない。「高いほど素直に加点される」係数。
  // taste_scoreのうち20%を品質、残り80%を(濃さ・量・個性の)相性が占める配分にした。
  // 満足度全体(taste_score*0.6)の中では品質の寄与は0.6*0.2=12%相当になり、既存の匂い
  // ペナルティ・価格ペナルティ(どちらも重み次第で仕上がり数%〜十数%)と釣り合う大きさに
  // 収めた。新しいペナルティは作らず、常に0以上のボーナスとしてのみ効かせる(§1)。
  var QUALITY_WEIGHT = 0.2;

  // STEP9(docs/新設計/09_STEP9_客層相性_注文_満足度_修正版.md §3): 「客層が好むサイドが
  // 置いてあれば+3〜5点程度」。指示書の目安の中央値である+4点にした(サイドを置くだけで満足度が
  // 跳ね上がるとSTEP8の歯止めが無意味になるため、上げすぎない)。「好む」の判定は
  // js/data/sides.js の各サイドが持つ「よく頼む客層」(segments)をそのまま使う(新しいデータを
  // 増やさない)。どのラーメンを選んだかとは無関係に、店に置いてあるかどうかだけで決まる。
  var SIDE_SATISFACTION_BONUS = 4;
  function sideSatisfactionBonus(seg, state) {
    var sides = window.DATA.sides.items;
    var hasLikedSide = (state.sideMenu || []).some(function (sideId) {
      var side = U.findById(sides, sideId);
      return side && side.segments.indexOf(seg.id) >= 0;
    });
    return hasLikedSide ? SIDE_SATISFACTION_BONUS : 0;
  }

  // satisfaction = taste_score*0.6 + shop_score*0.4 - price_penalty + サイド補正
  // STEP9(§1): recipeOverrideを渡すと、そのラーメン(2・3品目候補を含む)で評価する。省略時は
  // 従来どおりstate.recipe(1品目)で評価する(既存の呼び出し元は挙動を変えていない)。
  function computeSatisfaction(seg, state, recipeOverride) {
    var agg = recipeAggregate(recipeOverride || state.recipe, state);
    // STEP4(§2〜3): 「コク・脂・量」だった3軸を「濃さ(統合済み)・量・個性」に差し替えた。
    // 個性(uniqueness)にも客層ごとの理想値があるため、diffの数式自体は3項のまま維持できる。
    var diff = Math.abs(agg.richness - seg.taste.richness) +
      Math.abs(agg.volume - seg.taste.volume) +
      Math.abs(agg.uniqueness - seg.taste.uniqueness);
    var fitScore = 100 - (diff / 3) * (30 / seg.tolerance);
    // STEP5(§2-1): 最終品質 = レシピの品質 + (調理の平均-5)×3 + 設備補正(現状0)。
    var qualityScore = U.clamp(agg.quality + cookingQualityBonus(state), 0, 100);
    var taste_score = fitScore * (1 - QUALITY_WEIGHT) + qualityScore * QUALITY_WEIGHT;

    var shop = computeShopStats(state);
    var w = seg.weights;
    var wsum = w.speed + w.cleanliness + w.brightness;
    var shop_score = (shop.speed * w.speed + shop.cleanliness * w.cleanliness + shop.brightness * w.brightness) / wsum;
    // STEP5(§2-3): 接客の平均値を既存の枠にそのまま足す(新しい計算式は作らない)。
    shop_score += staffServiceAvg(state);
    shop_score -= smellEffective(state) * w.smell_penalty;
    if (state.equipment.indexOf("ticket_machine") >= 0 && (seg.id === "family" || seg.id === "tourist")) shop_score -= 10;
    if (state.equipment.indexOf("bright_light") >= 0 && seg.id === "regular") shop_score -= 5;
    if (state.equipment.indexOf("multilingual") >= 0 && seg.id === "tourist") shop_score += 15;
    // v07: 疲労が高いと店の見え方(shop_score)が落ちる。「休む」がただの回復ボタンで終わらないようにするための唯一の新規パラメータ。
    if (state.flags && state.flags.fatigue) shop_score -= state.flags.fatigue * 0.15;

    var price_penalty = Math.max(0, (state.price - seg.budget) / seg.budget * 100 * w.price_sensitivity);
    var sideBonus = sideSatisfactionBonus(seg, state);
    var satisfaction = taste_score * 0.6 + shop_score * 0.4 - price_penalty + sideBonus;
    return { value: satisfaction, taste_score: taste_score, shop_score: shop_score, price_penalty: price_penalty, sideBonus: sideBonus };
  }

  // v09-3: 季節の判定は「表示上の月」(実カレンダー月)で行う。以前は週→月の近似(4.333週/月)から
  // 逆算した「月」を使っていたが、開業日を4/1固定にしたことで実際の暦月と直接比較できるようになった。
  function seasonalFactor(property, seg, day) {
    var month = U.calMonth(day);
    var mult = 1;
    if (property.id === "campus" && (month === 2 || month === 8)) mult *= 0.3; // 長期休暇で街ごと静まる
    if ((month === 7 || month === 8) && seg.id !== "tourist") mult *= 0.9; // 夏はやや客足減
    if (property.id === "office" && seg.id === "family") mult *= 0.5; // オフィス街は週末死ぬ
    if (property.id === "roadside" && (seg.id === "salaryman" || seg.id === "ol")) mult *= 0.85;
    return mult;
  }

  // v17(docs/新設計/v17_ラーメン屋_修正指示書.md §1-3): 営業時間の選択自体が無くなった
  // (常に11:00〜23:00の通し営業)ため、開けている帯による客数・コストの倍率は撤去し、
  // どちらも常に1.0を返すだけにした。STEP11・STEP13で調整済みの客数・収支の数値を
  // そのまま維持するための措置(「昼+夜の2帯を選んだ状態」と同じ数字が出る)。
  // 呼び出し側の引数(seg/activeBands/state)は使わないが、既存の呼び出し箇所を変えずに
  // 済むよう関数自体は残してある。
  function hourCoverageMultiplier() { return 1; }
  function hoursCostMultiplier() { return 1; }

  // STEP9(docs/新設計/09_STEP9_客層相性_注文_満足度_修正版.md §1): 客はメニューを確率で選ぶ。
  // 一番満足するものを必ず選ぶ形にはしない(それだと3品置く意味が消える、指示書§1)。
  // ソフトマックス(温度T)を使う: 確率_i ∝ exp(満足度_i / T)。満足度差20点でおよそ何倍選ばれ
  // やすくなるかはTで決まる。T=15を選んだ根拠: exp(20/15)≈3.79倍。指示書の要件「差20点で
  // およそ3:1以上」を余裕を持って満たす(詳細と実測値はdocs/設計判断記録.md参照)。
  // 満足度が同じなら確率も同じ(ソフトマックスの性質上、自動的に成り立つ)。
  var RAMEN_CHOICE_TEMPERATURE = 15;
  function ramenChoiceProbabilities(seg, state, ramens) {
    var scores = ramens.map(function (r) { return U.clamp(computeSatisfaction(seg, state, r).value, 0, 100); });
    var maxScore = Math.max.apply(null, scores); // 数値安定化のため最大値を引いてからexp(確率自体は変わらない)
    var weights = scores.map(function (s) { return Math.exp((s - maxScore) / RAMEN_CHOICE_TEMPERATURE); });
    var sum = weights.reduce(function (a, b) { return a + b; }, 0);
    return { probs: weights.map(function (w) { return w / sum; }), scores: scores };
  }

  // 週の客数(客層別) = segment_flow × 基礎客数 × 評判係数 × リピート率 × 季節係数 × 営業時間係数、行列で常連系を排除
  function computeWeeklyCustomers(state) {
    var property = getProperty(state);
    var results = {};
    var totalDemand = 0;
    // STEP9(§1): 置いてある全ラーメンを1回だけ確定する(客層に依存しない一覧なのでループの外)。
    var ramens = availableRamens(state);

    // v05: 向かいにライバル店ができた後は客足が落ちる。挨拶に行っていれば落ち方が軽い。
    var rivalMult = 1;
    if (state.flags && state.flags.rivalOpen) rivalMult = state.flags.rivalCordial ? 0.94 : 0.85;

    SEGMENTS.forEach(function (seg) {
      if (!meetsRequires(seg, state)) {
        results[seg.id] = { count: 0, satisfaction: null, blocked: true, potential: 0 };
        return;
      }
      // STEP9(§1): 客層ごとに、置いてある全ラーメンの満足度から選択確率を求め、期待値
      // (確率で重み付けた平均)を「この客層の満足度」として使う(リピート率などは今まで通り
      // この1つの値から決まる)。
      var choice = ramenChoiceProbabilities(seg, state, ramens);
      var expectedSat = 0;
      for (var i = 0; i < ramens.length; i++) expectedSat += choice.probs[i] * choice.scores[i];
      var flow = property.segment_flow[seg.id] != null ? property.segment_flow[seg.id] : 0.1;
      var repMult = U.clamp(state.reputation / 50, 0.4, 2.2);
      var seasonMult = seasonalFactor(property, seg, state.day);
      var repeatMult = U.clamp(expectedSat / 65, 0.15, 1.7);
      var boost = state.tempBoosts && state.tempBoosts[seg.id] ? state.tempBoosts[seg.id].mult : 1;
      var hoursMult = hourCoverageMultiplier();
      // STEP10(docs/新設計/10_STEP10_広告_認知度_評判_修正版.md §2): 「週の来店者数 = 立地の
      // 潜在客数(flow) × 認知度の係数 × 来店魅力度(repMult等、既存のまま)」。認知度0でも
      // 0人にはならないよう下限0.3は維持。
      // STEP11(docs/新設計/11_STEP11_経済バランス統合_修正版.md §3「認知度の係数」): 上限を
      // 1.2倍→2.0倍に引き上げた。認知度の器自体はSTEP10で作ったばかりで、育て切っても
      // 損益分岐点に届かなかったため(詳細はdocs/設計判断記録.md参照)。下限0.3は変えていない。
      var awarenessMult = 0.3 + U.clamp(state.awareness || 0, 0, 100) / 100 * 1.7;
      var potential = Math.max(0, flow * BASE_CUSTOMERS * repMult * seasonMult * repeatMult * boost * rivalMult * hoursMult * awarenessMult);
      // ramenProbsは「今週の客数がどれだけ増減したか」の影響を受けない比率のまま持つ(§で人数の
      // 変動と選択比率は独立)。computeWeeklyFinance側でcount×確率として使う。
      // v25(§F): potentialは天井を一切通す前の客層ごとの生の潜在需要。表示・演出専用
      // (js/screens/shop-view.jsの湧き人数、週次画面の「逃した客」の内訳)にだけ使い、
      // countの計算経路(収支・満足度)には一切混ぜない。
      results[seg.id] = { count: potential, satisfaction: expectedSat, blocked: false, ramenProbs: choice.probs, potential: potential };
      totalDemand += potential;
    });

    // STEP13(docs/新設計/13_STEP13_全体統合_バランス是正_UI_修正版.md §1): 満足度が高いほど
    // 処理可能人数の上限が伸びるようにする(下のstaffCapacityで使う)。ここで使う満足度は、
    // 行列・座席・スタッフの上限で客数が絞られる「前」の、客層ごとの期待満足度を件数で加重平均
    // したもの(既存のweightedAvgSatisfaction()を再利用。キャップで絞ったあとの値を使うと、
    // キャップ自体が満足度の重みに影響してしまうため、絞る前の値を使う)。
    var avgSatForCapacity = weightedAvgSatisfaction({ results: results });

    var seats = totalSeats(state);
    // STEP7(§3): big_pot/noodle_boilerの座席キャパ倍率(capMult)はここから撤去し、
    // staffProcessingCapacity()(週の処理可能人数)へ読み替えた。座席キャパ自体は設備の影響を
    // 受けなくなった(物理的な席数×回転数のみで決まる、という素直な形に戻った)。
    var weeklyCapacity = seats * SEATS_TO_WEEKLY_CAPACITY;
    var queueRatio = weeklyCapacity > 0 ? totalDemand / weeklyCapacity : 0;
    var queueLevel = Math.max(0, queueRatio - 1); // 0=行列なし、値が大きいほど行列が伸びる
    if (state.flags && state.flags.forceQueueSpike) queueLevel = Math.max(queueLevel, 1.5);

    // 行列が閾値を超えると queue_tolerance が低い客層(常連・家族連れ・OL)の来店数が減る
    if (queueLevel > 0) {
      SEGMENTS.forEach(function (seg) {
        if (results[seg.id].blocked) return;
        var tol = seg.weights.queue_tolerance;
        var pushOutFactor = U.clamp(queueLevel * (1 - tol) * 0.8, 0, 0.95);
        results[seg.id].count *= (1 - pushOutFactor);
      });
    }

    // 物理的な席数キャップ(それでも溢れる分は演出上の行列として扱い、客数はキャパで頭打ち)
    var finalTotal = 0;
    Object.keys(results).forEach(function (id) { finalTotal += results[id].count; });
    // v25(§A/§F): D'(②のqueue_tolerance足切りを通した後の合計)。この時点の値をそのまま
    // 通過点として持ち出す(新しい計算はしない。finalTotalは既存のまま)。
    var demandAfterQueuePushout = finalTotal;
    if (finalTotal > weeklyCapacity && weeklyCapacity > 0) {
      var scale = weeklyCapacity / finalTotal;
      Object.keys(results).forEach(function (id) { results[id].count *= scale; });
    }

    // STEP5(§2-2): 従業員の速度による処理能力の上限。席数キャップとは別枠の追加キャップで、
    // 現状の客数(週120人前後)ではまだ届かない可能性が高い(§0)。座席キャップ適用後の合計に
    // さらにこれを掛けるので、両方のうちより厳しい方が効く。
    var staffCapacity = staffProcessingCapacity(state, avgSatForCapacity);
    // v49-1: 絵の目標間隔 T 専用の、**プレイヤーぶんを含まない**同じ式の値。満足度は上と同じ
    // avgSatForCapacity を渡す(2つの値の差がプレイヤーぶんだけになるように)。
    var staffOnlyCapacity = staffOnlyProcessingCapacity(state, avgSatForCapacity);
    var afterSeatTotal = 0;
    Object.keys(results).forEach(function (id) { afterSeatTotal += results[id].count; });
    // v25(§A/§F): T1(③の座席キャパ適用後の合計)。同じく既存の値をそのまま持ち出すだけ。
    var demandAfterSeatCap = afterSeatTotal;
    if (afterSeatTotal > staffCapacity && staffCapacity > 0) {
      var staffScale = staffCapacity / afterSeatTotal;
      Object.keys(results).forEach(function (id) { results[id].count *= staffScale; });
    }

    // v25(§A/§F): A(④の処理可能人数キャパ適用後の合計=実客数)。D'・T1と同じく、丸める前の
    // 値をそのまま持ち出す(客層ごとにMath.roundした後の合計を使うと、客層数ぶんの端数が
    // 積み上がってD'/T1よりわずかに大きくなることがあり、D≧D'≧T1≧Aが崩れるため)。
    var actualCustomers = 0;
    Object.keys(results).forEach(function (id) { actualCustomers += results[id].count; });

    Object.keys(results).forEach(function (id) { results[id].count = Math.max(0, Math.round(results[id].count)); });

    // STEP9: ramensをそのまま返す。computeWeeklyFinance側がresults[id].ramenProbsと組み合わせて
    // 「客層ごとにどのラーメンが何人ぶん売れたか」を復元する(availableRamens()を呼び直さない
    // ことで、万一この間にstateが変わっても計算に使った一覧とズレない)。
    return {
      results: results, totalDemand: totalDemand, weeklyCapacity: weeklyCapacity, queueLevel: queueLevel,
      staffCapacity: staffCapacity,
      staffOnlyCapacity: staffOnlyCapacity, // v49-1: 絵の目標間隔専用(プレイヤーぶんを含まない)
      ramens: ramens,
      // v25(§A/§F): 逃した客の内訳表示・絵の湧き人数専用の通過点(D/D'/T1/A)。
      // D=totalDemand(既存)。ここでは新規に増えた3つだけを持ち出す。
      demandAfterQueuePushout: demandAfterQueuePushout, demandAfterSeatCap: demandAfterSeatCap,
      actualCustomers: actualCustomers
    };
  }

  // v25(指示書§3・追補§A): 逃した客の内訳。computeWeeklyCustomers()が返したD/D'/T1/Aの
  // 4つの通過点を、指示された順序で引き算するだけ(新しい計算式を足さない)。
  //   席が足りず逃した = D  − T1   (②queue_tolerance足切り + ③座席キャパの合計)
  //   手が足りず逃した = T1 − A    (④処理可能人数キャパの分)
  // (D − T1) + (T1 − A) = D − A は恒等式なので、二重計上・取りこぼしは構造上あり得ない。
  function missedCustomersBreakdown(customersResult) {
    var D = customersResult.totalDemand;
    var T1 = customersResult.demandAfterSeatCap;
    var A = customersResult.actualCustomers;
    // 先に合計(total)を丸めてから、席側だけ丸めて求め、手側は「合計−席側」で残りとして出す。
    // 内訳を別々に丸めて足すと(半端な値が両方切り上がる等で)合計とズレる場合があるため、
    // 「足すと必ずtotalに一致する」ことを丸め方の時点で保証する。
    var total = Math.max(0, Math.round(D - A));
    var seatShort = U.clamp(Math.round(D - T1), 0, total);
    var staffShort = total - seatShort;
    return { total: total, seatShort: seatShort, staffShort: staffShort };
  }

  // STEP9(§1): 原価は「客がどのラーメンを選んだか」で決まる(値段は今もラーメンによらず
  // state.price 1つだけなので、売上側の計算は変えていない)。ramensとramenProbsが無い
  // (STEP9より前のcustomersResultなど)場合はstate.recipe1本のときと同じ結果になるよう保険をかける。
  function computeWeeklyFinance(state, customersResult) {
    var ramens = customersResult.ramens || [state.recipe];
    var ramenCosts = ramens.map(function (r) { return recipeAggregate(r, state).cost; });
    var property = getProperty(state);
    var revenue = 0, foodCost = 0, totalCustomers = 0;
    var bySegment = {};
    var byRamen = ramens.map(function () { return 0; }); // STEP9: ラーメンごとの週間杯数(索引はramensと対応)
    var revenueMult = state.flags.weekRevenueMult != null ? state.flags.weekRevenueMult : 1;
    // v10-2-4: 開けている帯が多いほど、仕込み・仕入れの効率が落ちる分を原価に乗せる(2帯基準=1.0)。
    // 客数自体は既にcomputeWeeklyCustomers側の営業時間係数で増減しているので、これは客数とは別枠の上乗せ。
    var costMult = hoursCostMultiplier(state);
    Object.keys(customersResult.results).forEach(function (id) {
      var r = customersResult.results[id];
      var c = r.count;
      var probs = r.ramenProbs || [1]; // 未解放時などramenProbsが無ければ全量を1品目に割り振る
      revenue += c * state.price * revenueMult;
      for (var i = 0; i < ramens.length; i++) {
        var portion = c * (probs[i] || 0);
        foodCost += portion * ramenCosts[i] * costMult;
        byRamen[i] += portion;
      }
      totalCustomers += c;
      bySegment[id] = c;
    });
    return { revenue: revenue, foodCost: foodCost, totalCustomers: totalCustomers, bySegment: bySegment, byRamen: byRamen, property: property };
  }

  // v10-3: 週の客数(客層別、計算済みのcustomersResult)を、実際に絵の上へ湧かせるための
  // 「曜日×帯」のマス目へ配分する。計算(売上・満足度)はcomputeWeeklyCustomers/Financeのままで、
  // ここはその結果を可視化のためだけに割り振る(このスケジュール自体は売上に一切影響しない)。
  // 端数は累積丸め(cumulative rounding)で吸収し、マス目の合計が客層ごとの週客数と一致するようにする
  // (週の終わりの表示客数と、絵の上で入店した客の合計を±10%以内に収める、という指示に対応)。
  //
  // v17(docs/新設計/v17_ラーメン屋_修正指示書.md §1-4): 営業時間の選択が無くなり、常に4帯
  // (昼/昼下がり/夕/夜)全てが開いている。この関数だけを「重み付き配分」に変更した(表示専用、
  // 総客数には一切影響しない)。客層のpeak_hoursに該当する帯は重み3、該当しない帯は重み1で
  // 配分し、11:00〜23:00のあいだ切れ目なく客が湧くように見せる。深夜帯(latenight)はBANDSから
  // 無くなったので、該当する客層(学生)の重みは自動的に他の3帯へ回る。weekend_lunch/
  // weekend_dinner(土日だけ計上)の扱いは変更していない。
  function weeklyBandSchedule(state, customersResult) {
    var activeBands = window.BANDS; // 常に4帯全て開いている
    var schedule = {};
    for (var d = 0; d < 7; d++) {
      schedule[d] = {};
      activeBands.forEach(function (b) { schedule[d][b.key] = {}; });
    }
    SEGMENTS.forEach(function (seg) {
      var r = customersResult.results[seg.id];
      var total = r ? r.count : 0;
      if (!total) return;

      // この客層のpeak_hoursから「該当する帯の集合」と「週末のみ計上か」を求める(既存の
      // weekend_lunch/weekend_dinnerの読み替えロジックをそのまま踏襲)。
      var matchBands = {};
      var weekendOnly = false;
      (seg.peak_hours || []).forEach(function (ph) {
        if (ph === "weekend_lunch") { matchBands.lunch = true; weekendOnly = true; }
        else if (ph === "weekend_dinner") { matchBands.dinner = true; weekendOnly = true; }
        else { matchBands[ph] = true; } // "latenight"はBANDSに存在しないので自然と参照されず消える
      });

      var cells = [];
      for (var dow = 0; dow < 7; dow++) {
        var weekend = (dow === 5 || dow === 6);
        if (weekendOnly && !weekend) continue;
        activeBands.forEach(function (b) {
          cells.push({ dow: dow, band: b.key, weight: matchBands[b.key] ? 3 : 1 });
        });
      }
      if (!cells.length) return;
      var weightSum = cells.reduce(function (s, c) { return s + c.weight; }, 0);
      var cumWeight = 0, prevCum = 0;
      cells.forEach(function (c) {
        cumWeight += c.weight;
        var cum = Math.round(total * cumWeight / weightSum);
        var v = cum - prevCum;
        prevCum = cum;
        schedule[c.dow][c.band][seg.id] = Math.max(0, v);
      });
    });
    return schedule;
  }

  function weightedAvgSatisfaction(customersResult) {
    var totalW = 0, sum = 0;
    Object.keys(customersResult.results).forEach(function (id) {
      var r = customersResult.results[id];
      if (r.satisfaction == null) return;
      sum += r.satisfaction * Math.max(1, r.count);
      totalW += Math.max(1, r.count);
    });
    return totalW > 0 ? sum / totalW : 50;
  }

  // ---------- v02: 表示用の総合指標 ----------
  // 素材のグレード。味の3軸(好みとの相性)とは別に「そもそも良いものを使っているか」を測る。
  var GRADE = {
    soup: { chicken: 62, pork: 76, seafood: 72, veggie: 48, double: 92 },
    tare: { shoyu: 60, shio: 58, miso: 66, spicy: 64 },
    noodle: { thin: 52, medium: 58, thick: 62, premium: 92 },
    // 大盛りは「量が増える」だけで素材そのものが良くなるわけではないので中庸
    topping: { none: 15, nori: 45, egg: 62, chashu_thin: 72, veggie_pile: 58, chashu_thick: 88, large: 50 }
  };

  function rankOf(v) {
    if (v >= 85) return "S";
    if (v >= 70) return "A";
    if (v >= 55) return "B";
    if (v >= 40) return "C";
    return "D";
  }

  // この立地に来うる客層の「味の相性」を客足の重みで平均する。
  // 来られない客層(設備不足)は除外する — 実際に来ない相手に合わせても意味がないため。
  function tasteFit(state) {
    var property = getProperty(state);
    var sum = 0, wsum = 0;
    SEGMENTS.forEach(function (seg) {
      if (!meetsRequires(seg, state)) return;
      var flow = property && property.segment_flow[seg.id] != null ? property.segment_flow[seg.id] : 0.3;
      if (flow <= 0) return;
      sum += U.clamp(computeSatisfaction(seg, state).taste_score, 0, 100) * flow;
      wsum += flow;
    });
    return wsum > 0 ? sum / wsum : 50;
  }

  function materialScore(state) {
    var r = state.recipe;
    var v = (GRADE.noodle[r.noodle] != null ? GRADE.noodle[r.noodle] : 50) * 0.35 +
      (GRADE.topping[r.topping] != null ? GRADE.topping[r.topping] : 50) * 0.35 +
      (GRADE.soup[r.soup] != null ? GRADE.soup[r.soup] : 50) * 0.22 +
      (GRADE.tare[r.tare] != null ? GRADE.tare[r.tare] : 50) * 0.08;
    if (state.flags && state.flags.noodleQualityBonus) v += 5;
    // v07: 「スープの試作」で積み上げた完成度の上乗せ(0〜20)。既存の「素材の質」に効かせる。
    if (state.flags && state.flags.tasteBonus) v += state.flags.tasteBonus;
    return U.clamp(v, 0, 100);
  }

  function ramenScore(state) {
    var agg = recipeAggregate(state.recipe, state);
    var fit = tasteFit(state);
    var material = materialScore(state);
    var score = U.clamp(fit * 0.6 + material * 0.4, 0, 100);
    return {
      // STEP5: 品質バーは実際に満足度計算へ流れる値(調理補正込み)を表示する。一方向データフロー
      // (計算値→絵)を保つため、絵側は常に最新の計算結果をそのまま映すだけにしている。
      axes: { quality: agg.quality + cookingQualityBonus(state), richness: agg.richness, volume: agg.volume, uniqueness: agg.uniqueness },
      cost: agg.cost,
      fit: Math.round(fit),
      material: Math.round(material),
      score: Math.round(score),
      rank: rankOf(score)
    };
  }

  // 従業員の総合ランク。5能力の単純平均だと全員BかDに潰れるので閾値を寄せてある。
  function staffRank(v) {
    if (v >= 60) return "S";
    if (v >= 50) return "A";
    if (v >= 40) return "B";
    if (v >= 28) return "C";
    return "D";
  }
  // bonus: v07「従業員に教える」で伸びた分の上乗せ({noodle,prep,service,numbers,teach})。
  // 雇用前(まだ state.staffState が無い)の表示では省略してよい。
  function effectiveStat(def, bonus, key) {
    return U.clamp(def.stats[key] + ((bonus && bonus[key]) || 0), 0, 100);
  }
  function staffRating(def, bonus) {
    var s = def.stats;
    var avg = bonus
      ? (effectiveStat(def, bonus, "noodle") + effectiveStat(def, bonus, "prep") + effectiveStat(def, bonus, "service") +
         effectiveStat(def, bonus, "numbers") + effectiveStat(def, bonus, "teach")) / 5
      : (s.noodle + s.prep + s.service + s.numbers + s.teach) / 5;
    return { avg: Math.round(avg), rank: staffRank(avg) };
  }

  return {
    recipeAggregate: recipeAggregate,
    isMaterialOwned: isMaterialOwned,
    unownedStartMaterials: unownedStartMaterials,
    getProperty: getProperty,
    totalSeats: totalSeats,
    tableSeats: tableSeats,
    computeShopStats: computeShopStats,
    smellEffective: smellEffective,
    meetsRequires: meetsRequires,
    computeSatisfaction: computeSatisfaction,
    computeWeeklyCustomers: computeWeeklyCustomers,
    computeWeeklyFinance: computeWeeklyFinance,
    missedCustomersBreakdown: missedCustomersBreakdown,
    hourCoverageMultiplier: hourCoverageMultiplier,
    hoursCostMultiplier: hoursCostMultiplier,
    weeklyBandSchedule: weeklyBandSchedule,
    weightedAvgSatisfaction: weightedAvgSatisfaction,
    ramenScore: ramenScore,
    tasteFit: tasteFit,
    materialScore: materialScore,
    rankOf: rankOf,
    staffRating: staffRating,
    effectiveStat: effectiveStat,
    findStaffDef: findStaffDef,
    effectiveNewStat: effectiveNewStat,
    staffCookingAvg: staffCookingAvg,
    staffServiceAvg: staffServiceAvg,
    staffSpeedSum: staffSpeedSum,
    staffDevelopmentSum: staffDevelopmentSum,
    cookingQualityBonus: cookingQualityBonus,
    staffProcessingCapacity: staffProcessingCapacity,
    staffOnlyProcessingCapacity: staffOnlyProcessingCapacity, // v49-1: 絵の目標間隔専用
    playerWeeklyCups: playerWeeklyCups,                       // v49-1: 先週プレイヤーが捌いた杯数(表示用)
    equipmentProcessingBonus: equipmentProcessingBonus,
    weeklyEquipUpkeep: weeklyEquipUpkeep,
    unlockedRamenSlots: unlockedRamenSlots,
    unlockedSideSlots: unlockedSideSlots,
    activeRamenCount: activeRamenCount,
    activeSideCount: activeSideCount,
    menuCoefficient: menuCoefficient,
    computeSideSales: computeSideSales,
    availableRamens: availableRamens,
    ramenChoiceProbabilities: ramenChoiceProbabilities,
    sideSatisfactionBonus: sideSatisfactionBonus,
    BASE_CUSTOMERS: BASE_CUSTOMERS,
    allStartMaterialsForDraw: allStartMaterialsForDraw,
    materialCardState: materialCardState,
    effectiveMaterialStats: effectiveMaterialStats,
    branchOptionPreview: branchOptionPreview
  };
})();
