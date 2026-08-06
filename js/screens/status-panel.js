// 常時表示のステータスパネル: ラーメンの完成度(味3軸+総合) と 従業員の能力
window.StatusPanel = (function () {
  var h = window.UI.h;
  var U = window.Utils;
  var SEGMENTS = window.DATA.segments.segments;
  var RECIPES = window.DATA.recipes;
  var STAFF = window.DATA.characters.staff;

  var AXES = [
    { key: "richness", label: "コク" },
    { key: "oiliness", label: "脂" },
    { key: "volume", label: "量" }
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
  function axisRow(state, axis, value) {
    var marks = [];
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

    var track = h("div", { className: "axis-track" }, [
      h("div", { className: "axis-fill", style: { width: U.clamp(value, 0, 100) + "%" } })
    ]);
    marks.forEach(function (m) {
      var tick = h("span", { className: "axis-tick" + (m.blocked ? " blocked" : ""), style: { left: m.x + "%" } });
      var mark = h("span", {
        className: "axis-mark" + (m.blocked ? " blocked" : ""),
        style: { left: m.x + "%", top: (m.row === 1 ? -30 : -16) + "px" },
        text: seg_emoji(m.seg)
      });
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

  function seg_emoji(seg) { return seg.emoji; }

  function recipeLine(state) {
    var parts = [];
    [["soup", "スープ"], ["tare", "タレ"], ["noodle", "麺"], ["topping", "トッピング"]].forEach(function (c) {
      var item = U.findById(RECIPES[c[0]], state.recipe[c[0]]);
      if (item) parts.push(item.emoji + item.name);
    });
    return parts.join(" ＋ ");
  }

  function renderRamen(state) {
    var r = window.Scoring.ramenScore(state);
    var box = h("div", { className: "status-card" }, [
      h("h3", { text: "🍜 ラーメンの完成度" }),
      h("div", { className: "score-head" }, [
        rankBadge(r.rank),
        h("span", { className: "score-num", text: String(r.score) }),
        h("span", { className: "score-max", text: "/ 100" })
      ]),
      h("div", { className: "dim", text: "味の相性 " + r.fit + " ・ 素材の質 " + r.material }),
      h("div", { className: "recipe-line", text: recipeLine(state) }),
      h("div", { className: "dim", text: "原価 " + r.cost + "円 / 価格 " + state.price + "円" })
    ]);
    var axesBox = h("div", { className: "axes-box" });
    AXES.forEach(function (a) { axesBox.appendChild(axisRow(state, a, r.axes[a.key])); });
    box.appendChild(axesBox);
    box.appendChild(h("div", { className: "dim axis-legend", text: "バーの上の顔は各客層の理想。近いほどその客層に刺さる。" }));
    return box;
  }

  // 雇用画面でも使えるよう能力ブロックだけ切り出しておく
  function staffStats(def) {
    var rows = [
      ["麺上げ", def.stats.noodle], ["仕込み", def.stats.prep], ["接客", def.stats.service],
      ["数字", def.stats.numbers], ["育成", def.stats.teach]
    ];
    var box = h("div", { className: "stat-grid" });
    rows.forEach(function (r) {
      box.appendChild(h("span", { className: "stat-name", text: r[0] }));
      box.appendChild(bar(r[1], 100));
      box.appendChild(h("span", { className: "stat-num", text: String(r[1]) }));
    });
    return box;
  }

  function staffBlock(def, sstate) {
    var rating = window.Scoring.staffRating(def);
    var block = h("div", { className: "staff-card" }, [
      h("div", { className: "staff-head" }, [
        h("span", { className: "staff-emoji", text: def.emoji }),
        h("span", { className: "staff-name", text: def.name }),
        h("span", { className: "dim", text: "（" + def.role + "）" }),
        rankBadge(rating.rank),
        h("span", { className: "dim", text: "総合 " + rating.avg })
      ]),
      staffStats(def)
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
    var box = h("div", { className: "status-card" }, [h("h3", { text: "👥 従業員" })]);
    if (!state.staffHired.length) {
      box.appendChild(h("p", { className: "dim", text: "従業員がいない。全部ひとりでやっている。" }));
      return box;
    }
    state.staffHired.forEach(function (id) {
      var def = U.findById(STAFF, id);
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
    staffBlock: staffBlock, staffStats: staffStats, rankBadge: rankBadge
  };
})();
