// v01_データ_レシピ.json を埋め込み
//
// STEP4(docs/新設計/04_STEP4_ラーメン新パラメータとレシピ計算_修正版.md §2〜4): 味の軸を
// 「コク(richness)・脂(oiliness)・量(volume)」から「品質(quality)・濃さ(richness)・量(volume)・
// 個性(uniqueness)」へ移した。
//   - richness: 旧richnessと旧oilinessを (richness+oiliness)/2 で統合した値に置き換えた
//     (§2の移行式。oilinessフィールドはここで削除し、コード全体から参照を無くした)
//   - quality/uniqueness: js/data/cards.js(STEP1で作成済み)の同名素材の数値を割り当てた。
//     cards.jsに対応する素材が無いもの(veggie/double/premium/chashu_thick/veggie_pile/large/none)
//     は、系統の近い素材に合わせて独自に決めた(§3〜4)。値と根拠はPROGRESS.md「STEP4対応」参照
//   - workload: 素材ごとに持たせたが、このSTEPではどこからも計算に使わない(§5)。値は既存の
//     prep_time/boil_time(スープ・麺)をそのまま流用し、タレは0、トッピングは下ごしらえの
//     手間感で独自に置いた(具体的な数値の根拠もPROGRESS.md参照)
// volume/cost/smell/prep_time/boil_time/unlock/noteは変更していない(§2「今回触らない」)。
window.DATA = window.DATA || {};
window.DATA.recipes = {
  // v31 §3-1: "img"はimg/配下の画像パス(拡張子・キャッシュ対策の?v=は付けない。js/asset-image.js
  // が組み立てる)。絵がまだ無いもの(double/spicy/none)は付けない → 絵文字のまま表示される。
  // noodleは初回シートが生成に失敗していたが(v31指示書§2)、後日1個ずつ届いたものを切り出して追加した。
  "soup": [
    { "id": "chicken",   "name": "鶏ガラ",   "emoji": "🐔", "img": "material/chicken", "quality": 18, "richness": 25, "volume": 0,  "uniqueness": 8,  "workload": 6,  "cost": 90,  "prep_time": 6,  "smell": 10, "unlock": "start" },
    { "id": "pork",      "name": "豚骨",     "emoji": "🐷", "img": "material/pork", "quality": 20, "richness": 75, "volume": 0,  "uniqueness": 15, "workload": 12, "cost": 140, "prep_time": 12, "smell": 85, "unlock": "start" },
    { "id": "seafood",   "name": "魚介",     "emoji": "🐟", "img": "material/seafood", "quality": 18, "richness": 38, "volume": 0,  "uniqueness": 20, "workload": 5,  "cost": 160, "prep_time": 5,  "smell": 45, "unlock": "start" },
    { "id": "veggie",    "name": "野菜",     "emoji": "🥬", "img": "material/veggie", "quality": 15, "richness": 18, "volume": 0,  "uniqueness": 10, "workload": 7,  "cost": 80,  "prep_time": 7,  "smell": 5,  "unlock": "event" },
    { "id": "double",    "name": "動物系＋魚介のダブル", "emoji": "🍲", "quality": 22, "richness": 60, "volume": 0, "uniqueness": 18, "workload": 14, "cost": 210, "prep_time": 14, "smell": 60, "unlock": "recipe_lv3" }
  ],
  "tare": [
    { "id": "shoyu", "name": "醤油", "emoji": "🟤", "img": "material/shoyu", "quality": 10, "richness": 5,  "volume": 0, "uniqueness": 5,  "workload": 0, "cost": 25, "smell": 0, "unlock": "start" },
    { "id": "shio",  "name": "塩",   "emoji": "⚪", "img": "material/shio", "quality": 9,  "richness": -7, "volume": 0, "uniqueness": 6,  "workload": 0, "cost": 20, "smell": 0, "unlock": "start" },
    { "id": "miso",  "name": "味噌", "emoji": "🟠", "img": "material/miso", "quality": 12, "richness": 20, "volume": 0, "uniqueness": 12, "workload": 0, "cost": 40, "smell": 20, "unlock": "start" },
    { "id": "spicy", "name": "辛味", "emoji": "🌶️", "quality": 11, "richness": 10, "volume": 0, "uniqueness": 18, "workload": 0, "cost": 35, "smell": 30, "unlock": "event" }
  ],
  "noodle": [
    { "id": "thin",    "name": "細麺",   "emoji": "🍜", "img": "material/thin", "quality": 7,  "richness": -2, "volume": -10, "uniqueness": 5,  "workload": 1, "cost": 60,  "boil_time": 1, "unlock": "start" },
    { "id": "medium",  "name": "中太麺", "emoji": "🍜", "img": "material/medium", "quality": 8,  "richness": 0,  "volume": 0,   "uniqueness": 2,  "workload": 2, "cost": 70,  "boil_time": 2, "unlock": "start" },
    { "id": "thick",   "name": "太麺",   "emoji": "🍜", "img": "material/thick", "quality": 9,  "richness": 3,  "volume": 20,  "uniqueness": 7,  "workload": 4, "cost": 85,  "boil_time": 4, "unlock": "start" },
    { "id": "premium", "name": "自家製麺", "emoji": "✨", "img": "material/premium", "quality": 15, "richness": 5, "volume": 10, "uniqueness": 12, "workload": 3, "cost": 110, "boil_time": 3, "unlock": "card_menya", "note": "製麺所の親父と関係を作ると解放" }
  ],
  "topping": [
    { "id": "chashu_thin", "name": "チャーシュー",     "emoji": "🥩", "img": "material/chashu_thin", "quality": 7,  "richness": 13, "volume": 15, "uniqueness": 4, "workload": 3, "cost": 90,  "unlock": "start" },
    { "id": "chashu_thick","name": "厚切りチャーシュー","emoji": "🥩", "img": "material/chashu_thick", "quality": 10, "richness": 23, "volume": 35, "uniqueness": 6, "workload": 5, "cost": 180, "unlock": "start" },
    { "id": "egg",         "name": "味玉",             "emoji": "🥚", "img": "material/egg", "quality": 5,  "richness": 5,  "volume": 10, "uniqueness": 3, "workload": 2, "cost": 55,  "unlock": "start" },
    { "id": "veggie_pile", "name": "野菜マシ",         "emoji": "🥬", "img": "material/veggie_pile", "quality": 2,  "richness": 3,  "volume": 40, "uniqueness": 3, "workload": 2, "cost": 60,  "unlock": "start" },
    { "id": "nori",        "name": "海苔",             "emoji": "🟩", "img": "material/nori", "quality": 1,  "richness": 5,  "volume": 5,  "uniqueness": 3, "workload": 1, "cost": 30,  "unlock": "start" },
    { "id": "large",       "name": "大盛り",           "emoji": "⬆️", "img": "material/large", "quality": 0,  "richness": 0,  "volume": 60, "uniqueness": 0, "workload": 0, "cost": 50,  "unlock": "start" },
    { "id": "none",        "name": "なし",             "emoji": "➖", "quality": 0,  "richness": 0,  "volume": 0,  "uniqueness": 0, "workload": 0, "cost": 0,   "unlock": "start" }
  ]
};

// STEP3(docs/新設計/03_STEP3_素材カード育成と分岐_修正版.md §3): Lv2で選ぶ2方向。
// 「カードごとに選べる方向は2つだけ」の指示により、4軸(品質/濃さ/量/個性)のうち
// カテゴリごとに2つだけを割り当てた(個別カードごとではなくカテゴリ単位。理由は
// docs/設計判断記録.md参照)。keyはjs/scoring.jsのeffectiveMaterialStats()が読む軸名、
// labelは表示用の短い方向名(§4-2「説明文は数値の表だけ」を守り、味わい文は書かない)。
window.DATA.materialBranches = {
  soup:    { a: { key: "quality",    label: "磨く" },   b: { key: "richness",   label: "濃くする" } },
  tare:    { a: { key: "quality",    label: "磨く" },   b: { key: "uniqueness", label: "尖らせる" } },
  noodle:  { a: { key: "quality",    label: "磨く" },   b: { key: "volume",     label: "増やす" } },
  topping: { a: { key: "volume",     label: "増やす" }, b: { key: "uniqueness", label: "尖らせる" } }
};
