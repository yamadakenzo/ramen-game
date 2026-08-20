// v01_データ_客層.json を埋め込み(file://でも読めるようfetchせず<script>で読み込む)
//
// STEP4(docs/新設計/04_STEP4_ラーメン新パラメータとレシピ計算_修正版.md §2〜3): tasteの軸を
// 「richness・oiliness・volume」から「richness(新・濃さ)・volume・uniqueness(新・個性)」へ変更。
// richnessは指示書§2の表の値をそのまま採用(旧richness・oilinessの平均)。oilinessは削除した。
// uniquenessは指示書§3の表の値をそのまま採用(観光客だけ突出して高いのは意図どおり)。
// volume/tolerance/weights/budget/peak_hours等は変更していない。
// v31 §3-1: "img"を追加(意味はjs/data/recipes.js冒頭のコメント参照)。6種とも絵が揃っている。
window.DATA = window.DATA || {};
window.DATA.segments = {
  "segments": [
    {
      "id": "ol",
      "name": "OL",
      "name_en": "Office Worker (F)",
      "emoji": "👩‍💼",
      "img": "segment/ol",
      "desc": "昼休みの1時間で来る。並ぶのは嫌。匂いが服につくのを警戒する。",
      "taste": { "richness": 25, "volume": 35, "uniqueness": 40 },
      "tolerance": 18,
      "weights": {
        "speed": 0.8,
        "cleanliness": 1.0,
        "brightness": 0.9,
        "smell_penalty": 1.0,
        "price_sensitivity": 0.4,
        "queue_tolerance": 0.2
      },
      "budget": 1100,
      "peak_hours": ["lunch"],
      "spread_type": "word_of_mouth_slow",
      "notes": "リピートは強いが、一度嫌われると戻らない。口コミは同僚経由でじわじわ広がる。"
    },
    {
      "id": "salaryman",
      "name": "サラリーマン",
      "name_en": "Salaryman",
      "emoji": "🧑‍💼",
      "img": "segment/salaryman",
      "desc": "早く、多く、濃く。券売機を好む。並ぶことは苦にしない。",
      "taste": { "richness": 73, "volume": 80, "uniqueness": 45 },
      "tolerance": 25,
      "weights": {
        "speed": 1.0,
        "cleanliness": 0.3,
        "brightness": 0.1,
        "smell_penalty": 0.0,
        "price_sensitivity": 0.5,
        "queue_tolerance": 0.8
      },
      "budget": 1000,
      "peak_hours": ["lunch", "night"],
      "spread_type": "steady",
      "notes": "客数のベース。ここを掴むと安定するが、単価は上がらない。"
    },
    {
      "id": "student",
      "name": "学生",
      "name_en": "Student",
      "emoji": "🎓",
      "img": "segment/student",
      "desc": "安く、多く。味の細かい違いには鈍い。SNSでよく喋る。",
      "taste": { "richness": 63, "volume": 95, "uniqueness": 45 },
      "tolerance": 35,
      "weights": {
        "speed": 0.4,
        "cleanliness": 0.2,
        "brightness": 0.3,
        "smell_penalty": 0.0,
        "price_sensitivity": 1.0,
        "queue_tolerance": 0.7
      },
      "budget": 750,
      "peak_hours": ["lunch", "night", "latenight"],
      "spread_type": "sns_fast",
      "notes": "単価は最低だが拡散力が最大。学生が付くと他客層への波及がある。"
    },
    {
      "id": "family",
      "name": "家族連れ",
      "name_en": "Family",
      "emoji": "🧑👧",
      "img": "segment/family",
      "desc": "週末に来る。テーブル席がないと入れない。一度に人数が入る。",
      "taste": { "richness": 43, "volume": 55, "uniqueness": 35 },
      "tolerance": 30,
      "weights": {
        "speed": 0.5,
        "cleanliness": 0.9,
        "brightness": 0.8,
        "smell_penalty": 0.4,
        "price_sensitivity": 0.6,
        "queue_tolerance": 0.1
      },
      "budget": 900,
      "peak_hours": ["weekend_lunch", "weekend_dinner"],
      "requires": ["table_seats"],
      "spread_type": "word_of_mouth_slow",
      "notes": "テーブル席が無いと客数ゼロ。あると週末の売上が跳ねる。"
    },
    {
      "id": "tourist",
      "name": "観光客",
      "name_en": "Tourist",
      "emoji": "🧳",
      "img": "segment/tourist",
      "desc": "写真を撮る。分かりやすさを求める。二度と来ない。",
      "taste": { "richness": 60, "volume": 60, "uniqueness": 80 },
      "tolerance": 40,
      "weights": {
        "speed": 0.3,
        "cleanliness": 0.6,
        "brightness": 0.5,
        "smell_penalty": 0.2,
        "price_sensitivity": 0.2,
        "queue_tolerance": 0.9
      },
      "budget": 1400,
      "peak_hours": ["lunch", "dinner"],
      "requires": ["multilingual"],
      "spread_type": "sns_fast",
      "repeat_rate": 0.05,
      "notes": "リピートしない。評判でしか来ない。単価が高く行列にも耐えるが、常連文化とは噛み合わない。"
    },
    {
      "id": "regular",
      "name": "常連",
      "name_en": "Regular",
      "emoji": "🧓",
      "img": "segment/regular",
      "desc": "毎日同じ席に座る。味を変えると気づく。値上げに敏感。",
      "taste": { "richness": 53, "volume": 60, "uniqueness": 50 },
      "tolerance": 12,
      "weights": {
        "speed": 0.2,
        "cleanliness": 0.4,
        "brightness": 0.2,
        "smell_penalty": 0.0,
        "price_sensitivity": 0.9,
        "queue_tolerance": 0.0
      },
      "budget": 950,
      "peak_hours": ["lunch", "night"],
      "spread_type": "none",
      "repeat_rate": 0.95,
      "notes": "客数への寄与は小さいが、いなくなると分かる。行列ができると離れる（並びたくない）。レシピ変更に最も反応する。"
    }
  ]
};
