// イベント判定・効果適用エンジン
window.EventEngine = (function () {
  var U = window.Utils;
  var EVENTS = window.DATA.events.events;
  var STAFF = window.DATA.characters.staff;
  var CARDS = window.DATA.characters.cards;
  var SEGMENTS = window.DATA.segments.segments;

  function getEvent(id) { return U.findById(EVENTS, id); }

  function initRun(state) {
    // 開業時に一度だけ、カードの登場ウィンドウを決めておく(密度が偏らないよう分散させる)
    state.flags.menyaTargetWeek = U.randInt(U.monthStartWeek(2), U.monthEndWeek(4));
    state.flags.reporterWindowStart = U.monthStartWeek(5);
    state.flags.reporterWindowEnd = U.monthEndWeek(9);
    state.tempBoosts = {};
  }

  function ensureStaffState(state, id) {
    if (!state.staffState[id]) {
      state.staffState[id] = { morale: 70, rel: 0, lowMoraleWeeks: 0 };
    }
    return state.staffState[id];
  }

  function adjustRel(state, cardId, v) {
    state.relationships[cardId] = U.clamp((state.relationships[cardId] || 0) + v, 0, 100);
  }
  function adjustStaffRel(state, staffId, v) {
    var s = ensureStaffState(state, staffId);
    s.rel = U.clamp(s.rel + v, 0, 100);
  }
  function adjustStaffMorale(state, staffId, v) {
    var s = ensureStaffState(state, staffId);
    s.morale = U.clamp(s.morale + v, 0, 100);
  }
  function adjustAllStaffMorale(state, v) {
    state.staffHired.forEach(function (id) { adjustStaffMorale(state, id, v); });
  }
  function addTempBoost(state, segId, pct, weeks) {
    state.tempBoosts = state.tempBoosts || {};
    var existing = state.tempBoosts[segId];
    var mult = 1 + pct / 100;
    if (existing) {
      existing.mult *= mult;
      existing.weeksLeft = Math.max(existing.weeksLeft, weeks);
    } else {
      state.tempBoosts[segId] = { mult: mult, weeksLeft: weeks };
    }
  }
  function removeStaff(state, staffId) {
    var idx = state.staffHired.indexOf(staffId);
    if (idx >= 0) state.staffHired.splice(idx, 1);
  }
  function adjustWage(state, staffId, pct) {
    var s = ensureStaffState(state, staffId);
    s.wageMult = (s.wageMult || 1) * (1 + pct / 100);
  }

  function resolveReporterVisit(state) {
    var avg = state.lastAvgSatisfaction != null ? state.lastAvgSatisfaction : 50;
    if (avg >= 60) state.reputation = U.clamp(state.reputation + 25, 0, 100);
    else state.reputation = U.clamp(state.reputation - 25, 0, 100);
  }

  function resolveTax(state) {
    var profitSoFar = 0;
    state.history.forEach(function (h) { profitSoFar += h.profit; });
    var tax = Math.max(0, Math.round(profitSoFar * 0.2));
    state.money -= tax;
    state.flags.lastTax = tax;
  }

  function applyEffect(state, effect, ctx) {
    ctx = ctx || {};
    Object.keys(effect).forEach(function (key) {
      var v = effect[key];
      switch (key) {
        case "money": state.money += v; break;
        case "reputation": state.reputation = U.clamp(state.reputation + v, 0, 100); break;
        case "regular_flow": addTempBoost(state, "regular", v, 6); break;
        case "regular_rel": addTempBoost(state, "regular", v * 1.5, 6); break;
        case "student_flow": addTempBoost(state, "student", v, 5); break;
        case "summer_flow":
          ["ol", "salaryman", "student", "family", "tourist", "regular"].forEach(function (seg) {
            addTempBoost(state, seg, v, 6);
          });
          break;
        case "staff_morale": adjustAllStaffMorale(state, v); break;
        case "staff_fatigue": adjustAllStaffMorale(state, -Math.round(v / 5)); break;
        case "menya_rel": adjustRel(state, "menya", v); break;
        case "reporter_rel": adjustRel(state, "reporter", v); break;
        case "landlord_rel": adjustRel(state, "landlord", v); break;
        case "oldman_rel": adjustRel(state, "oldman", v); break;
        case "lender_rel": adjustRel(state, "lender", v); break;
        case "yuta_rel": adjustStaffRel(state, "yuta", v); break;
        case "yuta_morale": adjustStaffMorale(state, "yuta", v); break;
        case "gonzo_rel": adjustStaffRel(state, "gonzo", v); break;
        case "gonzo_morale": adjustStaffMorale(state, "gonzo", v); break;
        case "recipe_lock": state.flags.recipeLockWeeksLeft = v; break;
        case "queue_spike": state.flags.forceQueueSpike = true; break;
        case "price_delta": state.price = Math.max(300, state.price + v); break;
        case "rent_pct": state.rentMultiplier = (state.rentMultiplier || 1) + v / 100; break;
        case "rent_pct_negotiate":
          if ((state.relationships.landlord || 0) >= 50) { /* 交渉成功: 上昇なし */ }
          else { state.rentMultiplier = (state.rentMultiplier || 1) + 0.10; }
          break;
        case "wage_pct": if (ctx.staffId) adjustWage(state, ctx.staffId, v); break;
        case "morale": if (ctx.staffId) adjustStaffMorale(state, ctx.staffId, v); break;
        case "rel": if (ctx.staffId) adjustStaffRel(state, ctx.staffId, v); break;
        case "staff_leave": if (ctx.staffId) removeStaff(state, ctx.staffId); break;
        case "revenue_mult": state.flags.weekRevenueMult = v; break;
        case "satisfaction_hit": state.flags.weekSatisfactionHit = v; break;
        case "noodle_hint": state.flags.noodleHint = true; break;
        case "noodle_quality_bonus": state.flags.noodleQualityBonus = true; break;
        case "reporter_visit": resolveReporterVisit(state); break;
        case "rival_open": state.flags.rivalOpen = true; break;
        case "rival_cordial": state.flags.rivalCordial = true; break;
        case "tax": resolveTax(state); break;
        default: break;
      }
    });
  }

  // ---------- 効果の差分検出（結果モーダル用） ----------
  // applyEffect は state を直接書き換える作りなので、適用前後のスナップショットを比較して
  // 「何が変わったか」を復元する。効果キーを増やしてもここが自動で拾えるのが狙い。
  function snapshotForDiff(state) {
    var snap = {
      money: state.money,
      reputation: state.reputation,
      price: state.price,
      rentMultiplier: state.rentMultiplier || 1,
      recipeLock: state.flags.recipeLockWeeksLeft || 0,
      staffHired: state.staffHired.slice(),
      rel: {}, staff: {}, boosts: {}, flags: {}
    };
    CARDS.forEach(function (c) { snap.rel[c.id] = state.relationships[c.id] || 0; });
    Object.keys(state.staffState).forEach(function (id) {
      var s = state.staffState[id];
      snap.staff[id] = { morale: s.morale, rel: s.rel, wageMult: s.wageMult || 1 };
    });
    Object.keys(state.tempBoosts || {}).forEach(function (seg) {
      snap.boosts[seg] = state.tempBoosts[seg].mult;
    });
    ["noodleHint", "noodleQualityBonus", "rivalOpen", "rivalCordial", "forceQueueSpike"].forEach(function (k) {
      snap.flags[k] = !!state.flags[k];
    });
    snap.flags.weekRevenueMult = state.flags.weekRevenueMult;
    snap.flags.weekSatisfactionHit = state.flags.weekSatisfactionHit;
    return snap;
  }

  // dir: 正なら増加。inverted は「増えると痛い」項目(家賃・給与・ロック)で色を反転させる。
  function diffEntry(text, dir, inverted) {
    var tone = dir === 0 ? "flat" : ((dir > 0) !== !!inverted ? "good" : "bad");
    return { text: text, tone: tone };
  }
  function signed(v) { return (v > 0 ? "+" : "") + Math.round(v).toLocaleString("ja-JP"); }

  function diffSnapshots(before, state) {
    var after = snapshotForDiff(state);
    var out = [];
    var d;

    d = after.money - before.money;
    if (Math.round(after.money) !== Math.round(before.money)) out.push(diffEntry("所持金 " + signed(d) + "円", d));

    d = after.reputation - before.reputation;
    if (Math.round(after.reputation) !== Math.round(before.reputation)) out.push(diffEntry("評判 " + signed(d), d));

    d = after.price - before.price;
    if (d !== 0) out.push(diffEntry("価格 " + signed(d) + "円", d));

    d = (after.rentMultiplier - before.rentMultiplier) * 100;
    if (Math.abs(d) > 0.1) out.push(diffEntry("家賃 " + signed(d) + "%", d, true));

    d = after.recipeLock - before.recipeLock;
    if (d !== 0) out.push(diffEntry(d > 0 ? ("レシピ変更が" + after.recipeLock + "週間できなくなった") : "レシピ変更の制限が解けた", d, true));

    CARDS.forEach(function (c) {
      var v = after.rel[c.id] - before.rel[c.id];
      if (v !== 0) out.push(diffEntry(c.name + "との関係 " + signed(v), v));
    });

    Object.keys(after.staff).forEach(function (id) {
      // 適用中に ensureStaffState で作られた場合、初期値と同じ既定を before として扱う
      var b = before.staff[id] || { morale: 70, rel: 0, wageMult: 1 };
      var a = after.staff[id];
      var def = U.findById(STAFF, id);
      if (!def) return;
      if (a.rel !== b.rel) out.push(diffEntry(def.name + "との関係 " + signed(a.rel - b.rel), a.rel - b.rel));
      if (a.morale !== b.morale) out.push(diffEntry(def.name + "の士気 " + signed(a.morale - b.morale), a.morale - b.morale));
      if (Math.abs(a.wageMult - b.wageMult) > 0.001) {
        var wp = (a.wageMult / b.wageMult - 1) * 100;
        out.push(diffEntry(def.name + "の給与 " + signed(wp) + "%", wp, true));
      }
    });

    before.staffHired.forEach(function (id) {
      if (after.staffHired.indexOf(id) >= 0) return;
      var def = U.findById(STAFF, id);
      out.push(diffEntry((def ? def.name : id) + "が店を離れた", -1));
    });

    var segIds = {};
    Object.keys(before.boosts).forEach(function (k) { segIds[k] = 1; });
    Object.keys(after.boosts).forEach(function (k) { segIds[k] = 1; });
    Object.keys(segIds).forEach(function (id) {
      var b = before.boosts[id] || 1, a = after.boosts[id] || 1;
      if (Math.abs(a - b) < 0.001) return;
      var pct = (a / b - 1) * 100;
      var seg = U.findById(SEGMENTS, id);
      var weeks = state.tempBoosts && state.tempBoosts[id] ? state.tempBoosts[id].weeksLeft : 0;
      out.push(diffEntry((seg ? seg.name : id) + "の客足 " + signed(pct) + "%" + (weeks ? "（" + weeks + "週間）" : ""), pct));
    });

    if (!before.flags.noodleHint && after.flags.noodleHint) out.push(diffEntry("麺の見方が分かるようになった", 1));
    if (!before.flags.noodleQualityBonus && after.flags.noodleQualityBonus) out.push(diffEntry("麺の質にボーナスがついた", 1));
    if (!before.flags.rivalOpen && after.flags.rivalOpen) {
      // 友好かどうかで減り方が変わる。両方出すと同じ話を2回言うことになるので1行にまとめる
      out.push(diffEntry("向かいにライバル店ができた（客足 " +
        (after.flags.rivalCordial ? "-6%・挨拶したぶん軽い" : "-15%") + "）", -1));
    } else if (!before.flags.rivalCordial && after.flags.rivalCordial) {
      out.push(diffEntry("向かいの店と友好関係になった", 1));
    }
    if (!before.flags.forceQueueSpike && after.flags.forceQueueSpike) out.push(diffEntry("来週、行列ができる", 0));
    if (after.flags.weekRevenueMult !== before.flags.weekRevenueMult && after.flags.weekRevenueMult != null) {
      out.push(diffEntry(after.flags.weekRevenueMult === 0 ? "今週は休業（売上ゼロ）" : ("今週の売上 ×" + after.flags.weekRevenueMult), -1));
    }
    if (after.flags.weekSatisfactionHit !== before.flags.weekSatisfactionHit && after.flags.weekSatisfactionHit != null) {
      out.push(diffEntry("今週の満足度 " + signed(after.flags.weekSatisfactionHit), after.flags.weekSatisfactionHit));
    }

    return out;
  }

  function tickTempBoosts(state) {
    if (!state.tempBoosts) return;
    Object.keys(state.tempBoosts).forEach(function (seg) {
      var b = state.tempBoosts[seg];
      b.weeksLeft -= 1;
      if (b.weeksLeft <= 0) delete state.tempBoosts[seg];
    });
  }

  // カード解放(自家製麺など)を毎週サイレントにチェックする
  function checkCardUnlocks(state) {
    var unlocked = [];
    if (!state.cardsUnlocked.menya && (state.relationships.menya || 0) >= 60) {
      state.cardsUnlocked.menya = true;
      unlocked.push({ card: "menya", text: "麺屋の親父との関係が深まった。自家製麺が使えるようになった。" });
    }
    if (!state.cardsUnlocked.oldman && (state.relationships.oldman || 0) >= 30) {
      state.cardsUnlocked.oldman = true;
      unlocked.push({ card: "oldman", text: "うるさい常連が味を正確に評してくれるようになった。" });
    }
    return unlocked;
  }

  // v05: 全イベントが「1周で1回」になったのでクールダウン機構は使っていない。
  // 季節ものを複数回出したくなったときのために枠だけ残してある(entry.cooldownKey)。
  function setCooldown(state, key) {
    state.flags["cooldown_" + key] = state.week;
  }

  // v05 密度制御: 月2〜3回 / 年25〜35回。1週に出すのは最大1件。
  // fixed(開店初日・夏・向かいの店・家賃・決算)だけはクォータを無視して必ず出す。
  var MONTHLY_EVENT_CAP = 3;
  function eventsThisMonth(state) {
    var m = U.weekToMonth(state.week);
    var n = 0;
    state.eventLog.forEach(function (e) { if (U.weekToMonth(e.week) === m) n++; });
    return n;
  }

  // 週次でどのイベントが発生するかを判定する。density検証のため呼び出し側でログを残す。
  function checkWeeklyEvents(state, weekStats) {
    var candidates = []; // {ev, ctx, kind}

    // --- fixed ---
    if (state.week === 1 && !state.firedEventIds.ev_open_day) {
      candidates.push({ ev: getEvent("ev_open_day"), ctx: {}, kind: "fixed" });
    }
    if (U.weekToMonth(state.week) === 7 && U.isFirstWeekOfMonth(state.week) && !state.firedEventIds.ev_summer) {
      candidates.push({ ev: getEvent("ev_summer"), ctx: {}, kind: "fixed" });
    }
    if (U.weekToMonth(state.week) === 8 && U.isFirstWeekOfMonth(state.week) && !state.firedEventIds.ev_rival_arrive) {
      candidates.push({ ev: getEvent("ev_rival_arrive"), ctx: {}, kind: "fixed" });
    }
    if (U.weekToMonth(state.week) === 10 && U.isFirstWeekOfMonth(state.week) && !state.firedEventIds.ev_rent_up) {
      candidates.push({ ev: getEvent("ev_rent_up"), ctx: {}, kind: "fixed" });
    }
    if (state.week === 52 && !state.firedEventIds.ev_tax) {
      candidates.push({ ev: getEvent("ev_tax"), ctx: {}, kind: "fixed" });
    }

    // --- conditional ---
    if (!state.firedEventIds.firstComplaintFired && state.week >= 2 && weekStats.avgSatisfaction < 50) {
      candidates.push({ ev: getEvent("ev_first_complaint"), ctx: {}, kind: "conditional_once", once: "firstComplaintFired" });
    }
    if (state.staffHired.indexOf("gonzo") >= 0 && !state.firedEventIds.ev_gonzo_angry) {
      var recentChanges = state.recipeChangeLog.filter(function (w) { return state.week - w <= 4; }).length;
      if (recentChanges >= 2) {
        candidates.push({ ev: getEvent("ev_gonzo_angry"), ctx: {}, kind: "once", once: "ev_gonzo_angry" });
      }
    }
    if (state.staffHired.indexOf("rin") >= 0 && weekStats.satisfactionBySeg.student != null &&
      weekStats.satisfactionBySeg.student > 75 && !state.firedEventIds.ev_sns_viral) {
      candidates.push({ ev: getEvent("ev_sns_viral"), ctx: {}, kind: "once", once: "ev_sns_viral" });
    }
    if (state.staffHired.indexOf("yuta") >= 0 && state.week >= (state.flags.yutaHireWeek || 1) + 13 && !state.firedEventIds.ev_yuta_ask) {
      candidates.push({ ev: getEvent("ev_yuta_ask"), ctx: {}, kind: "once", once: "ev_yuta_ask" });
    }
    // 従業員の士気低下 -> 辞めたい
    state.staffHired.forEach(function (id) {
      var s = ensureStaffState(state, id);
      if (s.morale < 30) s.lowMoraleWeeks = (s.lowMoraleWeeks || 0) + 1;
      else s.lowMoraleWeeks = 0;
      if (s.lowMoraleWeeks >= 2 && !state.firedEventIds["ev_staff_quit_" + id]) {
        candidates.push({ ev: getEvent("ev_staff_quit"), ctx: { staffId: id }, kind: "once", once: "ev_staff_quit_" + id });
      }
    });
    // 常連満足度低下 -> 空いた席
    var regularSat = weekStats.satisfactionBySeg.regular;
    if (regularSat != null) {
      if (regularSat < 40) state.flags.regularLowWeeks = (state.flags.regularLowWeeks || 0) + 1;
      else state.flags.regularLowWeeks = 0;
      // 3-2: 「空いた席」は1周で1回だけ（前回のプレイで6回出て単調になった）
      if (state.flags.regularLowWeeks >= 3 && !state.firedEventIds.ev_regular_gone) {
        candidates.push({ ev: getEvent("ev_regular_gone"), ctx: {}, kind: "once", once: "ev_regular_gone" });
      }
    }

    // --- card / combo (同一週に2つ以上出さない。1週最大1件) ---
    var cardCandidates = [];
    if (state.week === state.flags.menyaTargetWeek && !state.firedEventIds.ev_menya_appear) {
      cardCandidates.push({ ev: getEvent("ev_menya_appear"), ctx: {}, kind: "once", once: "ev_menya_appear" });
    }
    if (state.week >= state.flags.reporterWindowStart && state.week <= state.flags.reporterWindowEnd &&
      (state.relationships.reporter || 0) >= 40 && !state.firedEventIds.ev_reporter_visit) {
      cardCandidates.push({ ev: getEvent("ev_reporter_visit"), ctx: {}, kind: "once", once: "ev_reporter_visit" });
    }
    var menyaRel = state.relationships.menya || 0;
    if (menyaRel >= 50 && state.staffHired.indexOf("gonzo") >= 0 &&
      ensureStaffState(state, "gonzo").rel >= 50 && !state.comboFired.menya_gonzo) {
      cardCandidates.push({ ev: getEvent("ev_menya_gonzo_combo"), ctx: {}, kind: "combo", combo: "menya_gonzo" });
    }
    if (menyaRel >= 50 && (state.relationships.oldman || 0) >= 50 && !state.comboFired.menya_oldman) {
      cardCandidates.push({ ev: getEvent("ev_menya_oldman_combo"), ctx: {}, kind: "combo", combo: "menya_oldman" });
    }
    if (cardCandidates.length > 0 && state.week - (state.flags.lastCardEventWeek || -99) >= 2) {
      candidates.push(cardCandidates[0]); // 1週間に1件だけ
    }

    // --- random ---
    // 3-2: 「スープが違う」も1周で1回だけ
    if (state.week >= 4 && !state.firedEventIds.ev_soup_fail && Math.random() < 0.06) {
      candidates.push({ ev: getEvent("ev_soup_fail"), ctx: {}, kind: "once", once: "ev_soup_fail" });
    }

    // 3-3: 1週に出すのは最大1件。fixed(決算・家賃等)は月のクォータを無視して必ず出す。
    var fixed = candidates.filter(function (c) { return c.kind === "fixed"; });
    if (fixed.length > 0) return [fixed[0]];
    var others = candidates.filter(function (c) { return c.kind !== "fixed"; });
    if (!others.length) return [];
    if (eventsThisMonth(state) >= MONTHLY_EVENT_CAP) return [];
    return [others[0]];
  }

  function markFired(state, entry) {
    var ev = entry.ev;
    state.firedEventIds[ev.id] = true;
    if (entry.once) state.firedEventIds[entry.once] = true;
    if (entry.cooldownKey) setCooldown(state, entry.cooldownKey);
    if (entry.combo) { state.comboFired[entry.combo] = true; state.flags.lastCardEventWeek = state.week; }
    if (entry.ev.trigger === "card") state.flags.lastCardEventWeek = state.week;
    state.eventLog.push({ week: state.week, id: ev.id, title: ev.title });
  }

  return {
    getEvent: getEvent,
    initRun: initRun,
    applyEffect: applyEffect,
    snapshotForDiff: snapshotForDiff,
    diffSnapshots: diffSnapshots,
    tickTempBoosts: tickTempBoosts,
    checkCardUnlocks: checkCardUnlocks,
    checkWeeklyEvents: checkWeeklyEvents,
    markFired: markFired,
    ensureStaffState: ensureStaffState
  };
})();
