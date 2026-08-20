// 常時表示のステータスパネル: ラーメンの完成度(味4軸+総合) と 従業員の能力
window.StatusPanel = (function () {
  var h = window.UI.h;
  var U = window.Utils;
  var SEGMENTS = window.DATA.segments.segments;
  var RECIPES = window.DATA.recipes;
  var STAFF = window.DATA.characters.staff;

  // STEP4(docs/新設計/04_STEP4_ラーメン新パラメータとレシピ計算_修正版.md §6): 3軸(コク・脂・量)を
  // 4軸(品質・濃さ・量・個性)に差し替えた。品質は客層ごとの理想値が無いため、noMarker:trueにして
  // axisRow側でマーカー(客層の顔)を置かないようにする。
  var AXES = [
    { key: "quality", label: "品質", noMarker: true },
    { key: "richness", label: "濃さ" },
    { key: "volume", label: "量" },
    { key: "uniqueness", label: "個性" }
  ];

  function rankBadge(rank) {
    return h("span", { className: "rank-badge rank-" + rank, text: rank });
  }

  function bar(value, max, cls) {
    var pct = U.clamp((value / (max || 100)) * 100, 0, 100);
    return h("div", { className: "mini-track" }, [
      h("div", { className: "mini-fill" + (cls ? " " + cls : ""), style: { width: pct + "%" } })
    ]);
  }

  // 味の1軸。バーの上に各客層の理想位置を重ねるのがこの表示の要点。
  // STEP4: 品質(axis.noMarker)は客層ごとの理想値を持たないため、マーカーを一切置かない。
  function axisRow(state, axis, value) {
    var marks = [];
    if (!axis.noMarker) {
      SEGMENTS.forEach(function (seg) {
        marks.push({
          seg: seg,
          x: U.clamp(seg.taste[axis.key], 0, 100),
          blocked: !window.Scoring.meetsRequires(seg, state)
        });
      });
      marks.sort(function (a, b) { return a.x - b.x; });
      // 近接したマーカーは2段に振り分けて潰れないようにする
      var lastX = -99, lastRow = 0;
      marks.forEach(function (m) {
        m.row = (m.x - lastX < 7 && lastRow === 0) ? 1 : 0;
        lastX = m.x; lastRow = m.row;
      });
    }

    var track = h("div", { className: "axis-track" }, [
      h("div", { className: "axis-fill", style: { width: U.clamp(value, 0, 100) + "%" } })
    ]);
    marks.forEach(function (m) {
      var tick = h("span", { className: "axis-tick" + (m.blocked ? " blocked" : ""), style: { left: m.x + "%" } });
      var mark = h("span", {
        className: "axis-mark emoji-font" + (m.blocked ? " blocked" : ""),
        style: { left: m.x + "%", top: (m.row === 1 ? -30 : -16) + "px" }
      }, [window.AssetImage.node(m.seg)]);
      mark.title = m.seg.name + "の理想 " + m.seg.taste[axis.key] + (m.blocked ? "（設備不足で来店なし）" : "");
      tick.title = mark.title;
      track.appendChild(tick);
      track.appendChild(mark);
    });

    return h("div", { className: "axis-row" }, [
      h("span", { className: "axis-name", text: axis.label }),
      track,
      h("span", { className: "axis-num", text: String(Math.round(value)) })
    ]);
  }

  // v31 §3-2(Q4): 以前は"item.emoji + item.name"を1本の文字列に連結していたが、絵に差し替わった
  // 素材と絵文字のままの素材が混在すると崩れるため、要素を分けて返す(呼び出し側はtextではなく
  // childrenとして渡す)。
  function recipeLine(state) {
    var parts = [];
    [["soup", "スープ"], ["tare", "タレ"], ["noodle", "麺"], ["topping", "トッピング"]].forEach(function (c) {
      var item = U.findById(RECIPES[c[0]], state.recipe[c[0]]);
      if (!item) return;
      if (parts.length) parts.push(" ＋ ");
      parts.push(h("span", { className: "recipe-line-icon" }, [window.AssetImage.node(item)]));
      parts.push(item.name);
    });
    return parts;
  }

  function renderRamen(state) {
    var r = window.Scoring.ramenScore(state);
    var box = h("div", { className: "status-card" }, [
      h("h3", { className: "emoji-font", text: "🍜 ラーメンの完成度" }),
      h("div", { className: "score-head" }, [
        rankBadge(r.rank),
        h("span", { className: "score-num", text: String(r.score) }),
        h("span", { className: "score-max", text: "/ 100" })
      ]),
      h("div", { className: "dim", text: "味の相性 " + r.fit + " ・ 素材の質 " + r.material }),
      h("div", { className: "recipe-line emoji-font" }, recipeLine(state)),
      h("div", { className: "dim", text: "原価 " + r.cost + "円 / 価格 " + state.price + "円" })
    ]);
    var axesBox = h("div", { className: "axes-box" });
    AXES.forEach(function (a) { axesBox.appendChild(axisRow(state, a, r.axes[a.key])); });
    box.appendChild(axesBox);
    box.appendChild(h("div", { className: "dim axis-legend", text: "バーの上の顔は各客層の理想。近いほどその客層に刺さる。" }));
    return box;
  }

  // 雇用画面でも使えるよう能力ブロックだけ切り出しておく。
  // bonus: v07「従業員に教える」の上乗せ分({noodle,prep,...})。雇用前は省略(undefined)でよい。
  function staffStats(def, bonus) {
    var keys = ["noodle", "prep", "service", "numbers", "teach"];
    var labels = ["麺上げ", "仕込み", "接客", "数字", "育成"];
    var box = h("div", { className: "stat-grid" });
    keys.forEach(function (k, i) {
      var v = bonus ? window.Scoring.effectiveStat(def, bonus, k) : def.stats[k];
      var grown = bonus && bonus[k] > 0;
      box.appendChild(h("span", { className: "stat-name", text: labels[i] }));
      box.appendChild(bar(v, 100, grown ? "good-fill" : null));
      box.appendChild(h("span", { className: "stat-num", text: String(v) + (grown ? "↑" : "") }));
    });
    return box;
  }

  // STEP5(docs/新設計/05_STEP5_従業員能力と育成_修正版.md §1): 新4能力(調理/速度/接客/開発、
  // 1〜10)の表示。sstate.newStatBonusは「教える」でLvアップした分の上乗せ(既存のstatBonusと
  // 同じ考え方)。雇用前(sstateが無い)は基礎値のみを表示する。
  function newStaffStats(def, sstate) {
    var keys = ["cooking", "speed", "service", "development"];
    var labels = ["調理", "速度", "接客", "開発"];
    var box = h("div", { className: "stat-grid" });
    if (!def.newStats) return box;
    keys.forEach(function (k, i) {
      var bonus = (sstate && sstate.newStatBonus && sstate.newStatBonus[k]) || 0;
      var v = U.clamp(def.newStats[k] + bonus, 1, 10);
      var grown = bonus > 0;
      box.appendChild(h("span", { className: "stat-name", text: labels[i] }));
      box.appendChild(bar(v, 10, grown ? "good-fill" : null));
      box.appendChild(h("span", { className: "stat-num", text: String(v) + (grown ? "↑" : "") }));
    });
    return box;
  }

  function staffBlock(def, sstate) {
    var bonus = sstate && sstate.statBonus;
    var rating = window.Scoring.staffRating(def, bonus);
    var level = sstate ? (sstate.level || 1) : 1;
    var block = h("div", { className: "staff-card" }, [
      h("div", { className: "staff-head" }, [
        h("span", { className: "staff-emoji emoji-font" }, [window.AssetImage.node(def)]),
        h("span", { className: "staff-name", text: def.name }),
        h("span", { className: "dim", text: "（" + def.role + "）" }),
        rankBadge(rating.rank),
        h("span", { className: "dim", text: "総合 " + rating.avg }),
        def.maxLevel != null ? h("span", { className: "dim", text: "Lv " + level + "/" + def.maxLevel }) : null
      ]),
      staffStats(def, bonus),
      newStaffStats(def, sstate)
    ]);
    if (sstate) {
      var moraleCls = sstate.morale >= 60 ? "good-fill" : (sstate.morale >= 30 ? "warn-fill" : "bad-fill");
      var extra = h("div", { className: "stat-grid" }, [
        h("span", { className: "stat-name", text: "士気" }),
        bar(sstate.morale, 100, moraleCls),
        h("span", { className: "stat-num", text: String(Math.round(sstate.morale)) }),
        h("span", { className: "stat-name", text: "関係値" }),
        bar(sstate.rel, 100, "rel-fill"),
        h("span", { className: "stat-num", text: String(Math.round(sstate.rel)) })
      ]);
      block.appendChild(extra);
    }
    return block;
  }

  function renderStaff(state) {
    var box = h("div", { className: "status-card" }, [h("h3", { className: "emoji-font", text: "👥 従業員" })]);
    if (!state.staffHired.length) {
      box.appendChild(h("p", { className: "dim", text: "従業員がいない。全部ひとりでやっている。" }));
      return box;
    }
    state.staffHired.forEach(function (id) {
      var def = window.Scoring.findStaffDef(state, id); // STEP6: スカウト勢も対象に含める
      if (!def) return;
      box.appendChild(staffBlock(def, window.EventEngine.ensureStaffState(state, id)));
    });
    return box;
  }

  function render(state, container) {
    if (!container) return;
    window.UI.clear(container);
    container.appendChild(renderRamen(state));
    container.appendChild(renderStaff(state));
  }

  return {
    render: render, renderRamen: renderRamen, renderStaff: renderStaff,
    staffBlock: staffBlock, staffStats: staffStats, newStaffStats: newStaffStats, rankBadge: rankBadge
  };
})();
