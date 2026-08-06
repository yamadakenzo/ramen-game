// 満足度・客数・匂い・行列の計算。v01_ラーメン屋_実装指示書.md の式をそのまま実装する。
window.Scoring = (function () {
  var U = window.Utils;
  var SEGMENTS = window.DATA.segments.segments;
  var RECIPES = window.DATA.recipes;
  var PROPERTIES = window.DATA.property.properties;

  // 週あたりの理論最大客数の目安(1客層1週間の潜在客数)。噛み合えば繁盛、外せば閑古鳥になるよう調整。
  var BASE_CUSTOMERS = 24;
  // 席1つが1週間に捌ける杯数の目安(1日6〜7杯転回 x 7日)
  var SEATS_TO_WEEKLY_CAPACITY = 45;

  // 麺量アップ(茹で麺器の増設)はレシピではなく設備なので、state を渡された時だけ上乗せする
  var EXTRA_BOILER_VOLUME = 15;

  function recipeAggregate(recipe, state) {
    var soup = U.findById(RECIPES.soup, recipe.soup);
    var tare = U.findById(RECIPES.tare, recipe.tare);
    var noodle = U.findById(RECIPES.noodle, recipe.noodle);
    var topping = U.findById(RECIPES.topping, recipe.topping);
    if (!soup || !tare || !noodle || !topping) {
      return { richness: 0, oiliness: 0, volume: 0, cost: 0, smell: 0 };
    }
    var volumeBonus = (state && state.equipment && state.equipment.indexOf("extra_boiler") >= 0)
      ? EXTRA_BOILER_VOLUME : 0;
    var rawCost = soup.cost + tare.cost + noodle.cost + topping.cost;
    // v07: 「仕入れ先を回る」で積み上げた割引(%)。既存の「原価」という数字に効かせる(新しい数値は作らない)。
    var discountPct = (state && state.flags && state.flags.costDiscountPct) || 0;
    var cost = rawCost * (1 - discountPct / 100);
    return {
      richness: soup.richness + tare.richness + noodle.richness + topping.richness,
      oiliness: soup.oiliness + tare.oiliness + noodle.oiliness + topping.oiliness,
      volume: soup.volume + tare.volume + noodle.volume + topping.volume + volumeBonus,
      cost: Math.round(cost),
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

  function computeShopStats(state) {
    var speed = 40, cleanliness = 55, brightness = 35;
    if (state.equipment.indexOf("ticket_machine") >= 0) speed += 15;
    if (state.equipment.indexOf("noodle_boiler") >= 0) speed += 20;
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

  // satisfaction = taste_score*0.6 + shop_score*0.4 - price_penalty
  function computeSatisfaction(seg, state) {
    var agg = recipeAggregate(state.recipe, state);
    var diff = Math.abs(agg.richness - seg.taste.richness) +
      Math.abs(agg.oiliness - seg.taste.oiliness) +
      Math.abs(agg.volume - seg.taste.volume);
    var taste_score = 100 - (diff / 3) * (30 / seg.tolerance);

    var shop = computeShopStats(state);
    var w = seg.weights;
    var wsum = w.speed + w.cleanliness + w.brightness;
    var shop_score = (shop.speed * w.speed + shop.cleanliness * w.cleanliness + shop.brightness * w.brightness) / wsum;
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

  // 週の客数(客層別) = segment_flow × 基礎客数 × 評判係数 × リピート率 × 季節係数、行列で常連系を排除
  function computeWeeklyCustomers(state) {
    var property = getProperty(state);
    var results = {};
    var totalDemand = 0;

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
      var potential = Math.max(0, flow * BASE_CUSTOMERS * repMult * seasonMult * repeatMult * boost * rivalMult);
      results[seg.id] = { count: potential, satisfaction: sat.value, blocked: false };
      totalDemand += potential;
    });

    var seats = totalSeats(state);
    var capMult = 1;
    if (state.equipment.indexOf("big_pot") >= 0) capMult += 0.15;
    if (state.equipment.indexOf("noodle_boiler") >= 0) capMult += 0.10;
    var weeklyCapacity = seats * SEATS_TO_WEEKLY_CAPACITY * capMult;
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
    Object.keys(results).forEach(function (id) { results[id].count = Math.max(0, Math.round(results[id].count)); });

    return { results: results, totalDemand: totalDemand, weeklyCapacity: weeklyCapacity, queueLevel: queueLevel };
  }

  function computeWeeklyFinance(state, customersResult) {
    var agg = recipeAggregate(state.recipe, state);
    var property = getProperty(state);
    var revenue = 0, foodCost = 0, totalCustomers = 0;
    var bySegment = {};
    var revenueMult = state.flags.weekRevenueMult != null ? state.flags.weekRevenueMult : 1;
    Object.keys(customersResult.results).forEach(function (id) {
      var c = customersResult.results[id].count;
      revenue += c * state.price * revenueMult;
      foodCost += c * agg.cost;
      totalCustomers += c;
      bySegment[id] = c;
    });
    return { revenue: revenue, foodCost: foodCost, totalCustomers: totalCustomers, bySegment: bySegment, property: property };
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
      axes: { richness: agg.richness, oiliness: agg.oiliness, volume: agg.volume },
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
    getProperty: getProperty,
    totalSeats: totalSeats,
    computeShopStats: computeShopStats,
    smellEffective: smellEffective,
    meetsRequires: meetsRequires,
    computeSatisfaction: computeSatisfaction,
    computeWeeklyCustomers: computeWeeklyCustomers,
    computeWeeklyFinance: computeWeeklyFinance,
    weightedAvgSatisfaction: weightedAvgSatisfaction,
    ramenScore: ramenScore,
    tasteFit: tasteFit,
    materialScore: materialScore,
    rankOf: rankOf,
    staffRating: staffRating,
    effectiveStat: effectiveStat,
    BASE_CUSTOMERS: BASE_CUSTOMERS
  };
})();
