// v07: 定休日のアクション8種のデータ(表示文言・結果セリフ)。
// 成功判定・効果の適用ロジックは js/event-engine.js 側に置く(このファイルは文言だけ)。
// 「大成功/成功」は結果だけ言う。数値は言わない(3-5: 成果は翌週の営業で分かる)。
// 「空振り」はマイナスにしない。1週間を損しただけ、にとどめる。
// v31 §3-1: imgフィールドは付けていない(v31指示書 質問3回答: アクション・広告手段は
// 「物」ではないため画像化の対象外)。絵文字のまま。
window.DATA = window.DATA || {};
window.DATA.actions = {
  actions: [
    {
      id: "soup_trial", emoji: "🍲", name: "スープの試作",
      blurb: "味を寸胴の前で詰める。手応えは翌週に出る",
      kind: "variable", headline: "スープを試作した",
      // STEP2: 未所持の素材が出たときはctx.gainedCardNameが立つ。
      // STEP3(docs/新設計/03_STEP3_素材カード育成と分岐_修正版.md §1): 所持済みの素材(重複)が
      // 出たときはctx.dupeCardName・ctx.dupeWasted(Lv3で頭打ちのため無駄になったか)が立つ。
      text: {
        great: function (state, ctx) {
          if (ctx.gainedCardName) return "思いがけず、新しい素材「" + ctx.gainedCardName + "」が手に入った。";
          if (ctx.dupeCardName) {
            return ctx.dupeWasted
              ? "「" + ctx.dupeCardName + "」がまた出たが、もう十分に育て切っていた。今日は空振りに近い。"
              : "「" + ctx.dupeCardName + "」がまた出た。育てる方向を選べそうだ。";
          }
          return "何度も味見して、狙った方向がはっきり見えた。手応えは十分。";
        },
        good: function (state, ctx) {
          if (ctx.gainedCardName) return "仕入れ先で見かけて、新しい素材「" + ctx.gainedCardName + "」を持ち帰った。";
          if (ctx.dupeCardName) {
            return ctx.dupeWasted
              ? "「" + ctx.dupeCardName + "」がまた出たが、もう十分に育て切っていた。"
              : "「" + ctx.dupeCardName + "」を、もう1枚手に入れた。";
          }
          return "新しい塩梅を試した。悪くない感触。";
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
    // STEP10(docs/新設計/10_STEP10_広告_認知度_評判_修正版.md §4): 「新しいアクションを増やさず、
    // 既存のものを使うこと」の指示により、唯一の客足ブースト系アクションだった「商店街の寄合に
    // 出る」を「宣伝をする」に読み替えた。手段は下のadMethodsから1つ選ぶ(needsTarget:"adMethod"、
    // 選択UIはjs/screens/dayoff.js、判定はjs/event-engine.js)。
    {
      id: "meeting", emoji: "🏮", name: "宣伝をする",
      blurb: "知ってもらう手段を選ぶ。安い/高い/タダの3通り",
      kind: "variable", needsTarget: "adMethod",
      headline: function (state, ctx) { return (ctx.adMethodName || "宣伝") + "をした"; },
      text: {
        great: function (state, ctx) { return ctx.adMethodText ? ctx.adMethodText.great : ""; },
        good: function (state, ctx) { return ctx.adMethodText ? ctx.adMethodText.good : ""; },
        miss: function (state, ctx) { return ctx.adMethodText ? ctx.adMethodText.miss : ""; }
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
  ],
  // STEP10(docs/新設計/10_STEP10_広告_認知度_評判_修正版.md §4): 「宣伝をする」で選ぶ3つの手段。
  // 「安いが効きが小さい」「高いが効きが大きい」「タダだが不確実(評判が高いほど効く)」の3性格。
  // 数値・chanceの決め方はjs/event-engine.jsのresolveVariableAction参照。ここは文言と固定値のみ。
  adMethods: [
    {
      id: "flyer", emoji: "📄", name: "チラシを配る",
      blurb: "安く済むが、効きは小さい",
      cost: 5000, chanceBase: 0.85,
      gainGreat: 6, gainGood: 3,
      text: {
        great: "配り終える前に何人か声をかけてくれた。手応えがあった。",
        good: "ひと通り配り終えた。",
        miss: "受け取ってもらえないことが多く、あまり広まらなかった。"
      }
    },
    {
      id: "paid_ad", emoji: "🖥️", name: "広告を出す",
      blurb: "値は張るが、効きは大きい",
      cost: 40000, chanceBase: 0.85,
      gainGreat: 20, gainGood: 12,
      text: {
        great: "思った以上に目に留まったようだ。問い合わせも来た。",
        good: "予定通り掲載された。",
        miss: "出したはいいが、あまり反応がなかった。"
      }
    },
    {
      id: "sns", emoji: "📊", name: "SNSで発信する",
      blurb: "タダだが、当たり外れが大きい。評判が良いほど伸びやすい",
      cost: 0,
      gainGreat: 15, gainGood: 8,
      text: {
        great: "思いがけず大きく広まった。",
        good: "そこそこ反応があった。",
        miss: "ほとんど反応がなかった。"
      }
    }
  ]
};
