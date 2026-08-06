// v01_データ_イベント.json を埋め込み
// v02: 各選択肢に react_who / react（結果モーダルで出すキャラクターの反応）を追加。
//      結果が状況で分岐するものだけ関数 (state, ctx) => string を許容する。
window.DATA = window.DATA || {};
window.DATA.events = {
  // v05: 密度目標を「週1〜2回」から「月2〜3回」に下げた。
  // 元の v01_データ_イベント.json の _density_target は古い。こちらを正とする。
  "_density_target": {
    "per_month": "2〜3回", "per_year": "25〜35回",
    "per_week_max": 1,
    "note": "同一イベントは1周(52週)で1回のみ。例外は季節・決算・家賃など固定イベントだけ。実装上の上限は js/event-engine.js の MONTHLY_EVENT_CAP / 1週1件。"
  },
  "events": [
    {
      "id": "ev_open_day", "trigger": "fixed", "when": "day_1",
      "title": "開店初日",
      "text": "暖簾を出した。誰も来ない時間が30分続いた。……そして一人目が入ってきた。",
      "choices": [
        {
          "label": "深く頭を下げる", "effect": { "regular_flow": 8, "oldman_rel": 10 },
          "react_who": "🧓 最初の客", "react": "「そんなに畏まらんでいい。ラーメン、一つ」"
        },
        {
          "label": "黙って湯切りをする", "effect": { "staff_morale": 8, "reputation": 3 },
          "react_who": "🧓 最初の客", "react": "「……ふうん。そういう店か」"
        }
      ]
    },
    {
      "id": "ev_first_complaint", "trigger": "conditional", "when": "satisfaction < 50 かつ 初回のみ",
      "title": "初めての苦情",
      "text": "「これ、ぬるいよ」。カウンターの端の客が箸を置いた。",
      "choices": [
        {
          "label": "作り直す", "effect": { "money": -600, "reputation": 2, "oldman_rel": 10 },
          "react_who": "🍜 苦情の客", "react": "「……ああ、今度は熱い。うん、これでいい」"
        },
        {
          "label": "謝って値引き", "effect": { "money": -400, "oldman_rel": 3 },
          "react_who": "🍜 苦情の客", "react": "「まあいいよ。金の問題じゃないんだけどね」"
        },
        {
          "label": "何も言わない", "effect": { "reputation": -8, "oldman_rel": -15 },
          "react_who": "🍜 苦情の客", "react": "「……そう」半分残して、黙って出ていった。"
        }
      ]
    },
    {
      "id": "ev_menya_appear", "trigger": "card", "card": "menya", "when": "2〜4ヶ月目のどこか",
      "title": "麺屋の親父",
      "text": "「試作を持ってきた。使うかどうかはあんたが決めろ」",
      "choices": [
        {
          "label": "今の麺を捨てて切り替える", "effect": { "menya_rel": 20, "noodle_hint": true },
          "react_who": "👨‍🏭 麺屋の親父", "react": "「……いい度胸だ。うちの麺、無駄にすんなよ」"
        },
        {
          "label": "少しだけ試す", "effect": { "menya_rel": 8 },
          "react_who": "👨‍🏭 麺屋の親父", "react": "「まあ、そんなもんか。少しずつでいい」"
        },
        {
          "label": "今は要らない", "effect": { "menya_rel": -15 },
          "react_who": "👨‍🏭 麺屋の親父", "react": "「そうかい。……もう持ってこねえよ」"
        }
      ]
    },
    {
      "id": "ev_yuta_ask", "trigger": "staff", "staff": "yuta", "when": "在籍3ヶ月以降",
      "title": "ユウタの申し出",
      "text": "「店長。俺にもスープ、触らせてもらえませんか」",
      "choices": [
        {
          "label": "任せる", "effect": { "yuta_rel": 20, "yuta_morale": 10 },
          "react_who": "🧑‍🍳 ユウタ", "react": "「押忍！ 絶対うまくやります！」"
        },
        {
          "label": "まだ早い", "effect": { "yuta_rel": -10, "yuta_morale": -10 },
          "react_who": "🧑‍🍳 ユウタ", "react": "「……っす。分かりました」最後まで目が合わなかった。"
        },
        {
          "label": "隣で見ていろ", "effect": { "yuta_rel": 10, "yuta_morale": 3 },
          "react_who": "🧑‍🍳 ユウタ", "react": "「見てます。全部覚えます」"
        }
      ]
    },
    {
      "id": "ev_gonzo_angry", "trigger": "conditional", "when": "ゴンゾウ在籍中にレシピを1ヶ月以内に2回以上変更",
      "title": "ゴンゾウの沈黙",
      "text": "厨房に入ると、ゴンゾウが寸胴の前に立ったまま動かない。「……あんた、何がやりたいんだ」",
      "choices": [
        {
          "label": "説明する", "effect": { "gonzo_rel": 5 },
          "react_who": "👨‍🦳 ゴンゾウ", "react": "「……ふん。聞くだけ聞いた」"
        },
        {
          "label": "任せると言う", "effect": { "gonzo_rel": 20, "recipe_lock": 4 },
          "react_who": "👨‍🦳 ゴンゾウ", "react": "「なら、しばらく触るな。それでいい」"
        },
        {
          "label": "口を出すなと言う", "effect": { "gonzo_rel": -30, "gonzo_morale": -20 },
          "react_who": "👨‍🦳 ゴンゾウ", "react": "「……そうかい。あんたの店だ」寸胴から手を離した。"
        }
      ]
    },
    {
      "id": "ev_sns_viral", "trigger": "conditional", "when": "リン在籍中 かつ student満足度 > 75",
      "title": "バズった",
      "text": "リンが撮った写真が伸びている。「見てください店長、1万いきました」",
      "choices": [
        {
          "label": "全部受け入れる", "effect": { "student_flow": 60, "regular_rel": -20, "queue_spike": true, "staff_fatigue": 25 },
          "react_who": "👧 リン", "react": "「やば、外まで並んでます！」厨房はその日、戦場になった。"
        },
        {
          "label": "整理券を出す", "effect": { "student_flow": 30, "regular_rel": -5, "money": -20000 },
          "react_who": "👧 リン", "react": "「整理券、それっぽくて逆にバズりますよ」"
        },
        {
          "label": "普段通りやる", "effect": { "student_flow": 15, "reputation": 5 },
          "react_who": "👧 リン", "react": "「え、なんもしないんですか？ ……まあ、それはそれで」"
        }
      ],
      "note": "行列が常連を追い出す"
    },
    {
      "id": "ev_reporter_visit", "trigger": "card", "card": "reporter", "when": "5〜9ヶ月目",
      "title": "取材の申し込み",
      "text": "「来週、写真も撮らせてもらえますか」",
      "choices": [
        {
          "label": "受ける", "effect": { "reporter_visit": true },
          "react_who": "📰 地元紙の記者",
          "react": function (state) {
            var avg = state.lastAvgSatisfaction != null ? state.lastAvgSatisfaction : 50;
            return avg >= 60
              ? "「いい店ですね。これは、いい記事になりますよ」写真を何枚も撮っていった。"
              : "「……ええ、まあ。書きます。書きますけど」箸を置く手が早かった。";
          }
        },
        {
          "label": "断る", "effect": { "reporter_rel": -20 },
          "react_who": "📰 地元紙の記者", "react": "「あー、そうですか。まあ、縁があれば」"
        },
        {
          "label": "一ヶ月待ってもらう", "effect": { "reporter_rel": -5 },
          "react_who": "📰 地元紙の記者", "react": "「一ヶ月ね。……覚えておきます」"
        }
      ]
    },
    {
      "id": "ev_rent_up", "trigger": "fixed", "when": "month_10",
      "title": "家賃の話",
      "text": "大家が来た。「来月から、少し上げさせてもらうよ」",
      "choices": [
        {
          "label": "受け入れる", "effect": { "rent_pct": 15 },
          "react_who": "🏠 大家", "react": "「悪いね。こっちも固定資産税が上がってさ」"
        },
        {
          "label": "交渉する", "effect": { "rent_pct_negotiate": true },
          "react_who": "🏠 大家",
          "react": function (state) {
            return (state.relationships.landlord || 0) >= 50
              ? "「……まあ、あんたなら待つよ。今回だけね」据え置きになった。"
              : "「話は分かるけどね。こればっかりは」結局、上がった。";
          }
        },
        {
          "label": "出ていくと言う", "effect": { "rent_pct": 5, "landlord_rel": -30 },
          "react_who": "🏠 大家", "react": "「……本気かい。まあ、好きにしな」"
        }
      ]
    },
    {
      "id": "ev_rival_arrive", "trigger": "fixed", "when": "month_8",
      "title": "向かいに、何かできる",
      "text": "向かいの空き店舗に工事が入った。看板が上がるまで、あと二週間。ラーメン屋だ。",
      "choices": [
        {
          "label": "様子を見る", "effect": { "rival_open": true },
          "react_who": "", "react": "何もしなかった。看板が上がるのを、ただ見ていた。客が少し流れた。"
        },
        {
          "label": "先手を打って値下げ", "effect": { "rival_open": true, "price_delta": -100, "reputation": -3 },
          "react_who": "🧓 常連", "react": "「……安くなったな。何かあったのか？」"
        },
        {
          "label": "挨拶に行く", "effect": { "rival_open": true, "rival_cordial": true },
          "react_who": "🍜 向かいの店主", "react": "「ご丁寧にどうも。……お互い、やりましょう」"
        }
      ],
      "note": "v05: どの選択肢でも向かいに店はできる(rival_open)。差が出るのは客足の減り方"
    },
    {
      "id": "ev_staff_quit", "trigger": "conditional", "when": "staff_morale < 30 が2週間継続",
      "title": "辞めたい",
      "text": "閉店後、レジを締めているところに声をかけられた。「……話があるんですけど」",
      "choices": [
        {
          "label": "引き止める（給与を上げる）", "effect": { "wage_pct": 15, "morale": 25 },
          "react_who": "staff", "react": "「……分かりました。もう少しだけ、やってみます」"
        },
        {
          "label": "話を聞く", "effect": { "morale": 15, "rel": 10 },
          "react_who": "staff", "react": "「……聞いてもらえるとは、思ってませんでした」"
        },
        {
          "label": "送り出す", "effect": { "staff_leave": true },
          "react_who": "staff", "react": "「短い間でしたけど、ありがとうございました」"
        }
      ]
    },
    {
      "id": "ev_soup_fail", "trigger": "random", "when": "任意（低確率）",
      "title": "スープが違う",
      "text": "朝、味を見た瞬間に分かった。今日のスープは、いつもと違う。",
      "choices": [
        {
          "label": "今日は休む", "effect": { "revenue_mult": 0, "reputation": -5, "regular_rel": -3 },
          "react_who": "", "react": "暖簾は出さなかった。常連が三人、戸の前で引き返していった。"
        },
        {
          "label": "そのまま出す", "effect": { "satisfaction_hit": -25, "regular_rel": -20, "oldman_rel": -15 },
          "react_who": "🧓 うるさい常連", "react": "「今日のスープ、違うな。……分かってて出したのか」"
        },
        {
          "label": "作り直して昼から開ける", "effect": { "revenue_mult": 0.5, "staff_fatigue": 20 },
          "react_who": "", "react": "昼の光が入る頃、ようやく味が戻った。誰も口をきかなかった。"
        }
      ]
    },
    {
      "id": "ev_summer", "trigger": "fixed", "when": "month_7",
      "title": "夏",
      "text": "暑い。客足が落ちている。",
      "choices": [
        {
          "label": "冷やし麺を出す", "effect": { "money": -80000, "summer_flow": 25 },
          "react_who": "👩‍💼 OL", "react": "「これ、夏だけですか？ ……じゃあ、また来ます」"
        },
        {
          "label": "何もしない", "effect": { "summer_flow": -20 },
          "react_who": "", "react": "暖簾の前を、誰もが素通りしていく夏になった。"
        }
      ]
    },
    {
      "id": "ev_tax", "trigger": "fixed", "when": "month_12",
      "title": "決算",
      "text": "一年が終わった。税理士から封筒が届いている。",
      "choices": [
        {
          "label": "開ける", "effect": { "tax": true },
          "react_who": "📄 税理士の手紙", "react": "数字だけが並んでいた。良くも悪くも、これが一年の答えだ。"
        }
      ]
    },
    {
      "id": "ev_regular_gone", "trigger": "conditional", "when": "常連満足度 < 40 が3週間継続",
      "title": "空いた席",
      "text": "いつもの席が、三日続けて空いている。",
      "choices": [
        {
          "label": "気にしない", "effect": { "regular_flow": -30, "oldman_rel": -10 },
          "react_who": "", "react": "席は、それからずっと空いたままだった。"
        },
        {
          "label": "様子を見に行く", "effect": { "regular_rel": 15, "oldman_rel": 15, "money": -3000 },
          "react_who": "🧓 常連", "react": "「……なんだ、わざわざ来たのか」湯呑みを置いて、少し笑った。"
        }
      ],
      "note": "数字ではなく席が空くことで見せる。v05: 1周に1回だけ"
    },
    {
      "id": "ev_menya_gonzo_combo", "trigger": "combo", "combo_id": "menya_gonzo",
      "title": "旧知の仲",
      "text": "「おい、あの製麺所の親父じゃないか」ゴンゾウが珍しく声を上げた。二人は昔からの顔なじみらしい。",
      "choices": [
        {
          "label": "任せてみる", "effect": { "menya_rel": 10, "gonzo_rel": 10, "noodle_quality_bonus": true },
          "react_who": "👨‍🦳 ゴンゾウ", "react": "「こいつの麺なら、間違いはねえ」"
        }
      ]
    },
    {
      "id": "ev_menya_oldman_combo", "trigger": "combo", "combo_id": "menya_oldman",
      "title": "新しい麺の相談",
      "text": "「あの親父の麺か。……悪くない」うるさい常連が珍しく褒めた。麺屋の親父と旧知の仲らしい。",
      "choices": [
        {
          "label": "二人の話を聞く", "effect": { "menya_rel": 10, "oldman_rel": 10, "reputation": 5 },
          "react_who": "🧓 うるさい常連", "react": "「昔からこいつは、麺のことしか見てねえんだ」"
        }
      ]
    }
  ]
};
