// v01_データ_物件と設備.json を埋め込み
window.DATA = window.DATA || {};
window.DATA.property = {
  "properties": [
    {
      "id": "shotengai", "name": "商店街の空き店舗", "name_en": "Shopping Street Vacancy", "emoji": "🏪",
      "initial_cost": 3200000, "rent": 180000, "seats_counter": 10, "seats_table": 0, "condition": "居抜き",
      "segment_flow": { "regular": 1.4, "salaryman": 0.8, "ol": 0.5, "student": 0.6, "family": 0.7, "tourist": 0.3 },
      "traits": ["前の店の設備が使える（初期投資が安い）", "常連文化が根付いている", "商店街の付き合いイベントが多い"],
      "desc": "シャッターが半分閉まった商店街。人通りは多くないが、地元の人が毎日通る。"
    },
    {
      "id": "office", "name": "オフィス街の一階", "name_en": "Office District Ground Floor", "emoji": "🏢",
      "initial_cost": 7800000, "rent": 420000, "seats_counter": 14, "seats_table": 0, "condition": "スケルトン",
      "segment_flow": { "regular": 0.4, "salaryman": 1.6, "ol": 1.5, "student": 0.2, "family": 0.1, "tourist": 0.4 },
      "traits": ["昼のピークが極端（11:30-13:30に集中）", "夜と週末は死ぬ", "回転率が全て"],
      "desc": "ビルの一階。平日の昼だけ人が溢れる。それ以外の時間は誰も通らない。"
    },
    {
      "id": "campus", "name": "大学前", "name_en": "Near Campus", "emoji": "🎓",
      "initial_cost": 4100000, "rent": 230000, "seats_counter": 12, "seats_table": 2, "condition": "居抜き",
      "segment_flow": { "regular": 0.6, "salaryman": 0.5, "ol": 0.3, "student": 2.0, "family": 0.4, "tourist": 0.2 },
      "traits": ["長期休暇に客が消える（2月・8月）", "SNS拡散が起きやすい", "単価が上げられない"],
      "desc": "大学の正門から徒歩3分。学生で溢れるが、休みに入ると街ごと静まる。"
    },
    {
      "id": "roadside", "name": "郊外ロードサイド", "name_en": "Suburban Roadside", "emoji": "🛣️",
      "initial_cost": 9500000, "rent": 310000, "seats_counter": 8, "seats_table": 6, "condition": "スケルトン",
      "segment_flow": { "regular": 0.8, "salaryman": 0.7, "ol": 0.3, "student": 0.5, "family": 1.8, "tourist": 0.5 },
      "traits": ["駐車場あり", "テーブル席が最初からある", "週末に売上が集中", "初期投資が重い"],
      "desc": "幹線道路沿い。車で来る家族連れが主。平日は静かで週末に跳ねる。"
    },
    {
      "id": "tourist_spot", "name": "観光地の路地", "name_en": "Tourist Alley", "emoji": "⛩️",
      "initial_cost": 11000000, "rent": 520000, "seats_counter": 9, "seats_table": 0, "condition": "居抜き",
      "segment_flow": { "regular": 0.3, "salaryman": 0.2, "ol": 0.2, "student": 0.4, "family": 0.6, "tourist": 2.2 },
      "traits": ["単価を高く設定できる", "リピートしない客が中心", "季節変動が激しい", "多言語対応が必須"],
      "desc": "有名な神社の参道から一本入った路地。人は多いが、みんな一度きり。"
    }
  ],
  "equipment": [
    { "id": "ticket_machine", "name": "券売機",       "emoji": "🎫", "cost": 850000,  "effect": "提供速度+15、人件費削減", "penalty": "家族連れ・観光客の満足度-10", "note": "回転型の要" },
    { "id": "table_seats",    "name": "テーブル席",   "emoji": "🪑", "cost": 420000,  "effect": "家族連れ解放、席数+4", "penalty": "回転率-10", "requires_space": true },
    { "id": "exhaust",        "name": "強力ダクト",   "emoji": "💨", "cost": 1200000, "effect": "匂いペナルティを70%軽減", "note": "OL・家族連れ狙いなら必須。豚骨と組むと効く" },
    { "id": "multilingual",   "name": "多言語メニュー","emoji": "🌏", "cost": 120000,  "effect": "観光客解放、観光客満足度+15" },
    { "id": "bright_light",   "name": "明るい照明",   "emoji": "💡", "cost": 180000,  "effect": "brightness+30", "penalty": "常連満足度-5" },
    { "id": "big_pot",        "name": "大型寸胴",     "emoji": "🍲", "cost": 380000,  "effect": "1日の提供上限+40杯" },
    { "id": "noodle_boiler",  "name": "高性能茹で麺器","emoji": "♨️", "cost": 640000,  "effect": "提供速度+20" },
    { "id": "pos",            "name": "POSレジ",      "emoji": "🖥️", "cost": 300000,  "effect": "客層別の売上データを表示" },
    { "id": "extra_boiler",   "name": "麺量アップ",   "emoji": "🍜", "cost": 300000,  "effect": "全メニューの量+15", "note": "茹で麺器の増設。学生・サラリーマンなど量を求める客層の底上げ" }
  ],
  "funding": [
    { "id": "self_only",   "name": "自己資金のみ",         "amount": 3000000,  "monthly_repay": 0,      "months": 0,  "note": "借金なし。選べる物件が限られる" },
    { "id": "public_loan", "name": "公庫融資",             "amount": 7000000,  "monthly_repay": 68000,  "months": 84, "note": "標準。手堅い" },
    { "id": "big_loan",    "name": "公庫＋銀行",           "amount": 12000000, "monthly_repay": 135000, "months": 84, "note": "選択肢は広がるが返済が重い" },
    { "id": "family_loan", "name": "親から借りる",         "amount": 5000000,  "monthly_repay": 0,      "months": 0,  "note": "返済不要。ただし家族イベントが発生し続ける" }
  ]
};
