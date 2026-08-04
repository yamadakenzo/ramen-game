// v01_データ_レシピ.json を埋め込み
window.DATA = window.DATA || {};
window.DATA.recipes = {
  "soup": [
    { "id": "chicken",   "name": "鶏ガラ",   "emoji": "🐔", "richness": 30, "oiliness": 20, "volume": 0,  "cost": 90,  "prep_time": 6,  "smell": 10, "unlock": "start" },
    { "id": "pork",      "name": "豚骨",     "emoji": "🐷", "richness": 80, "oiliness": 70, "volume": 0,  "cost": 140, "prep_time": 12, "smell": 85, "unlock": "start" },
    { "id": "seafood",   "name": "魚介",     "emoji": "🐟", "richness": 50, "oiliness": 25, "volume": 0,  "cost": 160, "prep_time": 5,  "smell": 45, "unlock": "start" },
    { "id": "veggie",    "name": "野菜",     "emoji": "🥬", "richness": 25, "oiliness": 10, "volume": 0,  "cost": 80,  "prep_time": 7,  "smell": 5,  "unlock": "event" },
    { "id": "double",    "name": "動物系＋魚介のダブル", "emoji": "🍲", "richness": 70, "oiliness": 50, "volume": 0, "cost": 210, "prep_time": 14, "smell": 60, "unlock": "recipe_lv3" }
  ],
  "tare": [
    { "id": "shoyu", "name": "醤油", "emoji": "🟤", "richness": 10,  "oiliness": 0,  "volume": 0, "cost": 25, "smell": 0, "unlock": "start" },
    { "id": "shio",  "name": "塩",   "emoji": "⚪", "richness": -10, "oiliness": -5, "volume": 0, "cost": 20, "smell": 0, "unlock": "start" },
    { "id": "miso",  "name": "味噌", "emoji": "🟠", "richness": 25,  "oiliness": 15, "volume": 0, "cost": 40, "smell": 20, "unlock": "start" },
    { "id": "spicy", "name": "辛味", "emoji": "🌶️", "richness": 15,  "oiliness": 5,  "volume": 0, "cost": 35, "smell": 30, "unlock": "event" }
  ],
  "noodle": [
    { "id": "thin",    "name": "細麺",   "emoji": "🍜", "richness": -5, "oiliness": 0,  "volume": -10, "cost": 60,  "boil_time": 1, "unlock": "start" },
    { "id": "medium",  "name": "中太麺", "emoji": "🍜", "richness": 0,  "oiliness": 0,  "volume": 0,   "cost": 70,  "boil_time": 2, "unlock": "start" },
    { "id": "thick",   "name": "太麺",   "emoji": "🍜", "richness": 5,  "oiliness": 0,  "volume": 20,  "cost": 85,  "boil_time": 4, "unlock": "start" },
    { "id": "premium", "name": "自家製麺", "emoji": "✨", "richness": 10, "oiliness": 0, "volume": 10, "cost": 110, "boil_time": 3, "unlock": "card_menya", "note": "製麺所の親父と関係を作ると解放" }
  ],
  "topping": [
    { "id": "chashu_thin", "name": "チャーシュー",     "emoji": "🥩", "richness": 10, "oiliness": 15, "volume": 15, "cost": 90,  "unlock": "start" },
    { "id": "chashu_thick","name": "厚切りチャーシュー","emoji": "🥩", "richness": 15, "oiliness": 30, "volume": 35, "cost": 180, "unlock": "start" },
    { "id": "egg",         "name": "味玉",             "emoji": "🥚", "richness": 5,  "oiliness": 5,  "volume": 10, "cost": 55,  "unlock": "start" },
    { "id": "veggie_pile", "name": "野菜マシ",         "emoji": "🥬", "richness": 0,  "oiliness": 5,  "volume": 40, "cost": 60,  "unlock": "start" },
    { "id": "nori",        "name": "海苔",             "emoji": "🟩", "richness": 5,  "oiliness": 0,  "volume": 5,  "cost": 30,  "unlock": "start" },
    { "id": "large",       "name": "大盛り",           "emoji": "⬆️", "richness": 0,  "oiliness": 0,  "volume": 60, "cost": 50,  "unlock": "start" },
    { "id": "none",        "name": "なし",             "emoji": "➖", "richness": 0,  "oiliness": 0,  "volume": 0,  "cost": 0,   "unlock": "start" }
  ]
};
