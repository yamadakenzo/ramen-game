// v07: 定休日のアクション8種のデータ(表示文言・結果セリフ)。
// 成功判定・効果の適用ロジックは js/event-engine.js 側に置く(このファイルは文言だけ)。
// 「大成功/成功」は結果だけ言う。数値は言わない(3-5: 成果は翌週の営業で分かる)。
// 「空振り」はマイナスにしない。1週間を損しただけ、にとどめる。
window.DATA = window.DATA || {};
window.DATA.actions = {
  actions: [
    {
      id: "soup_trial", emoji: "🍲", name: "スープの試作",
      blurb: "味を寸胴の前で詰める。手応えは翌週に出る",
      kind: "variable", headline: "スープを試作した",
      // STEP2: 未所持の素材が残っている間は、そのカードが手に入った旨の文言に差し替える
      // (event-engine.jsがctx.gainedCardNameを立てたときだけ)。全て所持済みなら今まで通りの文言。
      text: {
        great: function (state, ctx) {
          return ctx.gainedCardName
            ? "思いがけず、新しい素材「" + ctx.gainedCardName + "」が手に入った。"
            : "何度も味見して、狙った方向がはっきり見えた。手応えは十分。";
        },
        good: function (state, ctx) {
          return ctx.gainedCardName
            ? "仕入れ先で見かけて、新しい素材「" + ctx.gainedCardName + "」を持ち帰った。"
            : "新しい塩梅を試した。悪くない感触。";
        },
        miss: "何度やっても同じところで止まった。今日は収穫なし。"
      }
    },
    {
      id: "supplier_visit", emoji: "🚚", name: "仕入れ先を回る",
      blurb: "麺屋の親父を訪ねる。関係ができているほど話が早い",
      kind: "variable", headline: "仕入れ先を回った",
      gate: function (state) {
        if (!state.firedEventIds.ev_menya_appear) return { ok: false, reason: "麺屋の親父とはまだ会っていない" };
        return { ok: true };
      },
      text: {
        great: "親父が奥から良いものを出してきた。仕入れの目処が立った。",
        good: "いつもより少し安くしてもらえた。",
        miss: "「今日は無いよ」。手ぶらで帰った。"
      }
    },
    {
      id: "teach_staff", emoji: "📖", name: "従業員に教える",
      blurb: "手が空いた分、誰かに教え込む。必ず伸びる",
      kind: "fixed", needsTarget: "staff",
      headline: function (state, ctx) { return (ctx.staffName || "従業員") + "に教えた"; },
      text: {
        fixed: function (state, ctx) { return (ctx.staffName || "従業員") + "に、じっくり教え込んだ。"; }
      }
    },
    {
      id: "food_tour", emoji: "🍜", name: "他店を食べ歩く",
      blurb: "他のラーメン屋を回る。新しい方向が見つかることがある",
      kind: "variable", headline: "他店を食べ歩いた",
      text: {
        great: "一軒、忘れられない店に当たった。うちにも取り入れられそうだ。",
        good: "参考になる店を何軒か回れた。",
        miss: "どこも似たり寄ったりだった。目新しい発見なし。"
      }
    },
    {
      id: "meeting", emoji: "🏮", name: "商店街の寄合に出る",
      blurb: "顔を出すだけでも意味がある。通うほど馴染む",
      kind: "variable", headline: "商店街の寄合に出た",
      text: {
        great: "話が弾んで、何人もの顔と名前が一致した。今度うちに寄ると言っていた。",
        good: "顔を出して、少し世間話をしてきた。",
        miss: "長引く話し合いに付き合わされただけだった。"
      }
    },
    {
      id: "meet_person", emoji: "🤝", name: "人に会う",
      blurb: "気になる相手に時間を使う。すでに近い相手ほど深まる",
      kind: "variable", needsTarget: "card",
      headline: function (state, ctx) { return (ctx.cardName || "人") + "と会った"; },
      text: {
        great: function (state, ctx) { return (ctx.cardName || "相手") + "と、長く話し込んだ。距離が縮んだ手応えがある。"; },
        good: function (state, ctx) { return (ctx.cardName || "相手") + "と少し話した。"; },
        miss: function (state, ctx) { return (ctx.cardName || "相手") + "は忙しそうだった。挨拶だけで終わった。"; }
      }
    },
    {
      id: "rest", emoji: "😴", name: "休む",
      blurb: "何もしない。疲れが取れる",
      kind: "fixed", headline: "休んだ",
      text: { fixed: "何もせず、ただ休んだ。体が軽い。" }
    },
    {
      id: "open_shop", emoji: "🔓", name: "店を開ける",
      blurb: "定休日を返上する。その場で売上が増える。疲れは残る",
      kind: "fixed", headline: "店を開けた",
      text: { fixed: "定休日を返上して、暖簾を出した。" }
    },
    // STEP6(docs/新設計/06_STEP6_従業員スカウト_修正版.md §1): 9つ目のアクションとして追加。
    // 候補の生成・選択はjs/screens/dayoff.jsのUI側で行い、実際の雇用処理(お金・staffHiredへの
    // 追加)はjs/event-engine.jsのresolveFixedAction("scout")が行う。
    {
      id: "scout", emoji: "📰", name: "求人を出す",
      blurb: "貼り紙を出す。今週だけ3人と会える",
      kind: "fixed", needsTarget: "scout", headline: "求人を出した",
      text: {
        fixed: function (state, ctx) {
          if (ctx.scoutResult === "full") return "貼り紙を出したが、今はこれ以上雇えない状態だった。";
          if (ctx.scoutResult === "insufficient_funds") return (ctx.staffName || "その人") + "が来てくれたが、紹介料が足りず雇えなかった。";
          if (ctx.scoutResult === "hired") return (ctx.staffName || "その人") + "が来てくれることになった。紹介料を払って迎え入れた。";
          return "3人と会ったが、今回は見送った。";
        }
      }
    }
  ]
};
