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

  // unlock:"start"のうち、まだ持っていない素材の一覧({cat, item})。試作(soup_trial)の抽選対象。
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
  // 「品」として数えるのは、枠が解放されていて、かつ実際にsoup/tare/noodle/toppingが
  // 全部埋まっているラーメンだけ(未設定の解放枠はメニュー係数に影響しない)。
  function activeRamenCount(state) {
    var slots = unlockedRamenSlots(state);
    var extra = (state.extraRamens || []).slice(0, slots - 1).filter(function (r) {
      return r && r.soup && r.tare && r.noodle && r.topping;
    }).length;
    return 1 + extra;
  }
  function activeSideCount(state) {
    var slots = unlockedSideSlots(state);
    return U.clamp((state.sideMenu || []).length, 0, slots);
  }
  // §3: メニュー係数 = 1 − (ラーメンの品数−1)×0.12 − サイドの品数×0.06
  function menuCoefficient(state) {
    return 1 - (activeRamenCount(state) - 1) * 0.12 - activeSideCount(state) * 0.06;
  }

  // §2-2: 週の処理可能人数(客数の上限キャップ)。120 + 速度の合計×30 + 設備補正、に
  // STEP8(§3)のメニュー係数を掛ける。
  function staffProcessingCapacity(state) {
    return (120 + staffSpeedSum(state) * 30 + equipmentProcessingBonus(state)) * menuCoefficient(state);
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
    var soup = U.findById(RECIPES.soup, recipe.soup);
    var tare = U.findById(RECIPES.tare, recipe.tare);
    var noodle = U.findById(RECIPES.noodle, recipe.noodle);
    var topping = U.findById(RECIPES.topping, recipe.topping);
    if (!soup || !tare || !noodle || !topping) {
      return {
        quality: RAMEN_BASE.quality, richness: RAMEN_BASE.richness, volume: RAMEN_BASE.volume,
        uniqueness: RAMEN_BASE.uniqueness, cost: RAMEN_BASE.cost, workload: RAMEN_BASE.workload, smell: 0
      };
    }
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

  function totalSeats(state) {
    var p = getProperty(state);
    if (!p) return 0;
    var tableBonus = state.equipment.indexOf("table_seats") >= 0 ? 4 : 0;
    return p.seats_counter + p.seats_table + tableBonus;
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

  // satisfaction = taste_score*0.6 + shop_score*0.4 - price_penalty
  function computeSatisfaction(seg, state) {
    var agg = recipeAggregate(state.recipe, state);
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
    var satisfaction = taste_score * 0.6 + shop_score * 0.4 - price_penalty;
    return { value: satisfaction, taste_score: taste_score, shop_score: shop_score, price_penalty: price_penalty };
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

  // v10-2/3: 客層のpeak_hoursと、いま開けている帯を突き合わせて倍率を作る。
  // 「昼+夜の2帯」を基準(=1.0)とし、開けている帯がそこから増えれば増え、減れば減る。
  // OL(peak_hours=[lunch])は昼を閉めると0倍、学生(peak_hours=[lunch,night,latenight])は
  // 深夜を追加で開けると1.5倍、という指示の具体例をどちらも満たす式になっている。
  function segmentPhysicalBands(seg) {
    var set = {};
    (seg.peak_hours || []).forEach(function (ph) {
      var band = ph === "weekend_lunch" ? "lunch" : (ph === "weekend_dinner" ? "dinner" : ph);
      set[band] = true;
    });
    return Object.keys(set);
  }
  function hourCoverageMultiplier(seg, activeBands) {
    var bands = segmentPhysicalBands(seg);
    if (!bands.length) return 1; // peak_hours未設定の客層は影響を受けない(保険)
    var base = window.BASE_HOUR_BANDS || ["lunch", "night"];
    var baseCount = bands.filter(function (b) { return base.indexOf(b) >= 0; }).length;
    var openCount = bands.filter(function (b) { return activeBands.indexOf(b) >= 0; }).length;
    if (baseCount === 0) return bands.length ? openCount / bands.length : 0; // 現在のデータでは発生しない保険
    return openCount / baseCount;
  }
  // v10-2-4: 開けた帯の数に比例するコスト倍率。基準は2帯(昼+夜)=1.0。
  function hoursCostMultiplier(state) {
    var bands = (state.businessHoursActive && state.businessHoursActive.length) ? state.businessHoursActive : (window.BASE_HOUR_BANDS || ["lunch", "night"]);
    return bands.length / 2;
  }

  // 週の客数(客層別) = segment_flow × 基礎客数 × 評判係数 × リピート率 × 季節係数 × 営業時間係数、行列で常連系を排除
  function computeWeeklyCustomers(state) {
    var property = getProperty(state);
    var results = {};
    var totalDemand = 0;
    var activeBands = (state.businessHoursActive && state.businessHoursActive.length) ? state.businessHoursActive : (window.BASE_HOUR_BANDS || ["lunch", "night"]);

    // v05: 向かいにライバル店ができた後は客足が落ちる。挨拶に行っていれば落ち方が軽い。
    var rivalMult = 1;
    if (state.flags && state.flags.rivalOpen) rivalMult = state.flags.rivalCordial ? 0.94 : 0.85;

    SEGMENTS.forEach(function (seg) {
      if (!meetsRequires(seg, state)) {
        results[seg.id] = { count: 0, satisfaction: null, blocked: true };
        return;
      }
      var sat = computeSatisfaction(seg, state);
      var flow = property.segment_flow[seg.id] != null ? property.segment_flow[seg.id] : 0.1;
      var repMult = U.clamp(state.reputation / 50, 0.4, 2.2);
      var seasonMult = seasonalFactor(property, seg, state.day);
      var repeatMult = U.clamp(sat.value / 65, 0.15, 1.7);
      var boost = state.tempBoosts && state.tempBoosts[seg.id] ? state.tempBoosts[seg.id].mult : 1;
      var hoursMult = hourCoverageMultiplier(seg, activeBands);
      var potential = Math.max(0, flow * BASE_CUSTOMERS * repMult * seasonMult * repeatMult * boost * rivalMult * hoursMult);
      results[seg.id] = { count: potential, satisfaction: sat.value, blocked: false };
      totalDemand += potential;
    });

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
    if (finalTotal > weeklyCapacity && weeklyCapacity > 0) {
      var scale = weeklyCapacity / finalTotal;
      Object.keys(results).forEach(function (id) { results[id].count *= scale; });
    }

    // STEP5(§2-2): 従業員の速度による処理能力の上限。席数キャップとは別枠の追加キャップで、
    // 現状の客数(週120人前後)ではまだ届かない可能性が高い(§0)。座席キャップ適用後の合計に
    // さらにこれを掛けるので、両方のうちより厳しい方が効く。
    var staffCapacity = staffProcessingCapacity(state);
    var afterSeatTotal = 0;
    Object.keys(results).forEach(function (id) { afterSeatTotal += results[id].count; });
    if (afterSeatTotal > staffCapacity && staffCapacity > 0) {
      var staffScale = staffCapacity / afterSeatTotal;
      Object.keys(results).forEach(function (id) { results[id].count *= staffScale; });
    }

    Object.keys(results).forEach(function (id) { results[id].count = Math.max(0, Math.round(results[id].count)); });

    return { results: results, totalDemand: totalDemand, weeklyCapacity: weeklyCapacity, queueLevel: queueLevel, staffCapacity: staffCapacity };
  }

  function computeWeeklyFinance(state, customersResult) {
    var agg = recipeAggregate(state.recipe, state);
    var property = getProperty(state);
    var revenue = 0, foodCost = 0, totalCustomers = 0;
    var bySegment = {};
    var revenueMult = state.flags.weekRevenueMult != null ? state.flags.weekRevenueMult : 1;
    // v10-2-4: 開けている帯が多いほど、仕込み・仕入れの効率が落ちる分を原価に乗せる(2帯基準=1.0)。
    // 客数自体は既にcomputeWeeklyCustomers側の営業時間係数で増減しているので、これは客数とは別枠の上乗せ。
    var costMult = hoursCostMultiplier(state);
    Object.keys(customersResult.results).forEach(function (id) {
      var c = customersResult.results[id].count;
      revenue += c * state.price * revenueMult;
      foodCost += c * agg.cost * costMult;
      totalCustomers += c;
      bySegment[id] = c;
    });
    return { revenue: revenue, foodCost: foodCost, totalCustomers: totalCustomers, bySegment: bySegment, property: property };
  }

  // v10-3: 週の客数(客層別、計算済みのcustomersResult)を、実際に絵の上へ湧かせるための
  // 「曜日×帯」のマス目へ配分する。計算(売上・満足度)はcomputeWeeklyCustomers/Financeのままで、
  // ここはその結果を可視化のためだけに割り振る(このスケジュール自体は売上に一切影響しない)。
  // 端数は累積丸め(cumulative rounding)で吸収し、マス目の合計が客層ごとの週客数と一致するようにする
  // (週の終わりの表示客数と、絵の上で入店した客の合計を±10%以内に収める、という指示に対応)。
  function weeklyBandSchedule(state, customersResult) {
    var activeBands = (state.businessHoursActive && state.businessHoursActive.length) ? state.businessHoursActive : (window.BASE_HOUR_BANDS || ["lunch", "night"]);
    var schedule = {};
    for (var d = 0; d < 7; d++) {
      schedule[d] = {};
      activeBands.forEach(function (b) { schedule[d][b] = {}; });
    }
    SEGMENTS.forEach(function (seg) {
      var r = customersResult.results[seg.id];
      var total = r ? r.count : 0;
      if (!total) return;
      var cells = [];
      for (var dow = 0; dow < 7; dow++) {
        var weekend = (dow === 5 || dow === 6);
        (seg.peak_hours || []).forEach(function (ph) {
          var band, weekendOnly;
          if (ph === "weekend_lunch") { band = "lunch"; weekendOnly = true; }
          else if (ph === "weekend_dinner") { band = "dinner"; weekendOnly = true; }
          else { band = ph; weekendOnly = false; }
          if (weekendOnly && !weekend) return;
          if (activeBands.indexOf(band) < 0) return;
          cells.push({ dow: dow, band: band });
        });
      }
      if (!cells.length) return;
      var per = total / cells.length;
      var prevCum = 0;
      cells.forEach(function (c, i) {
        var cum = Math.round(per * (i + 1));
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
    computeShopStats: computeShopStats,
    smellEffective: smellEffective,
    meetsRequires: meetsRequires,
    computeSatisfaction: computeSatisfaction,
    computeWeeklyCustomers: computeWeeklyCustomers,
    computeWeeklyFinance: computeWeeklyFinance,
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
    equipmentProcessingBonus: equipmentProcessingBonus,
    weeklyEquipUpkeep: weeklyEquipUpkeep,
    unlockedRamenSlots: unlockedRamenSlots,
    unlockedSideSlots: unlockedSideSlots,
    activeRamenCount: activeRamenCount,
    activeSideCount: activeSideCount,
    menuCoefficient: menuCoefficient,
    computeSideSales: computeSideSales,
    BASE_CUSTOMERS: BASE_CUSTOMERS
  };
})();
