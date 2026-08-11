// v01_データ_キャラクター.json を埋め込み
window.DATA = window.DATA || {};
window.DATA.characters = {
  // v06: 案内役。従業員でもカードでもない別枠。開業から営業開始まで、同じ1人が最後まで案内する。
  // v05では「信用金庫の開業支援担当」という人間キャラだったが、以下の理由で丼の擬人化キャラに差し替えた。
  //  - 名前が日本語の駄洒落だと翻訳で意味が消える(全世界向けと噛み合わない)
  //  - 「担当者が1年間ずっと店に出入りする」設定に無理がある
  //  - 人間の立ち絵は本番制作コストが最も高い
  // 素性は作り込まない。「この店を見守っている丼」以上の説明を持たせない。
  "guide": {
    "id": "donburi", "name": "どんぶりちゃん", "name_en": "Donburi", "emoji": "🍜",
    "role": "見守り役",
    "personality": "明るい・断定的・世話焼き",
    "tone": "「決めよう」「大丈夫」"
  },
  "staff": [
    {
      "id": "yuta", "name": "ユウタ", "name_en": "Yuta", "emoji": "🧑‍🍳", "age": 22, "role": "麺上げ",
      "personality": "熱血・不器用", "tone": "「押忍！」「やらせてください！」",
      "stats": { "noodle": 70, "prep": 30, "service": 25, "numbers": 10, "teach": 15 },
      // STEP5(docs/新設計/05_STEP5_従業員能力と育成_修正版.md §1): 新4能力(1〜10)と最大Lv。
      // 指示書の移行表の値をそのまま採用(四捨五入の式は参考程度で、表の値を正とする指示のため)。
      "newStats": { "cooking": 5, "speed": 6, "service": 3, "development": 3 },
      "maxLevel": 8, // growth:high → 8。ユウタは弱いが最も伸びる
      "wage": 180000, "growth": "high",
      "traits": ["濃厚路線で士気が上がる", "あっさり路線だと士気が下がる"],
      "backstory": "工場勤めを辞めてラーメンの世界へ。腕はまだだが伸びしろがある。独立願望が強い。",
      "route_bias": { "independent": 0.5, "stay": 0.3, "betray": 0.15, "retire": 0.05 }
    },
    {
      "id": "misaki", "name": "ミサキ", "name_en": "Misaki", "emoji": "👩‍🍳", "age": 28, "role": "接客",
      "personality": "如才ない・現実的", "tone": "「店長、それ言わなくていいですよ」",
      "stats": { "noodle": 20, "prep": 35, "service": 85, "numbers": 55, "teach": 40 },
      "newStats": { "cooking": 3, "speed": 7, "service": 9, "development": 4 },
      "maxLevel": 5, // growth:mid → 5
      "wage": 210000, "growth": "mid",
      "traits": ["OL・家族連れの満足度に補正", "店が汚いと機嫌が悪くなる"],
      "backstory": "カフェ勤務からの転職。接客は完璧だが、ラーメンそのものにはあまり興味がない。",
      "route_bias": { "independent": 0.1, "stay": 0.5, "betray": 0.15, "retire": 0.25 }
    },
    {
      "id": "gonzo", "name": "ゴンゾウ", "name_en": "Gonzo", "emoji": "👨‍🦳", "age": 58, "role": "仕込み",
      "personality": "頑固・寡黙", "tone": "「……ふん」「そりゃ違う」",
      "stats": { "noodle": 55, "prep": 90, "service": 5, "numbers": 20, "teach": 60 },
      "newStats": { "cooking": 7, "speed": 3, "service": 1, "development": 8 },
      "maxLevel": 1, // growth:none → 1。ゴンゾウは最初から強いが成長しない
      "wage": 260000, "growth": "none",
      "traits": ["スープの質に大補正", "レシピを頻繁に変えると激怒", "若手を育てる"],
      "backstory": "潰れた老舗の元店主。腕は本物だが、プライドが高く扱いが難しい。",
      "route_bias": { "independent": 0.05, "stay": 0.4, "betray": 0.2, "retire": 0.35 }
    },
    {
      "id": "rin", "name": "リン", "name_en": "Rin", "emoji": "👧", "age": 19, "role": "アルバイト",
      "personality": "軽い・SNS中毒", "tone": "「え、それバズるやつじゃないですか？」",
      "stats": { "noodle": 30, "prep": 20, "service": 60, "numbers": 15, "teach": 5 },
      "newStats": { "cooking": 3, "speed": 7, "service": 6, "development": 2 },
      "maxLevel": 5, // growth:mid → 5
      "wage": 95000, "growth": "mid",
      "traits": ["学生・観光客の流入に補正", "SNS拡散イベントを誘発", "無断欠勤あり"],
      "backstory": "近所の大学生。仕事は雑だが、外向きの発信力がある。",
      "route_bias": { "independent": 0.1, "stay": 0.2, "betray": 0.1, "retire": 0.6 }
    },
    {
      "id": "tetsu", "name": "テツ", "name_en": "Tetsu", "emoji": "🧔", "age": 34, "role": "万能",
      "personality": "冷静・計算高い", "tone": "「原価、今月32%ですよ」",
      "stats": { "noodle": 55, "prep": 55, "service": 50, "numbers": 80, "teach": 45 },
      "newStats": { "cooking": 6, "speed": 6, "service": 5, "development": 5 },
      "maxLevel": 3, // growth:low → 3
      "wage": 290000, "growth": "low",
      "traits": ["原価と客数の詳細表示を解放", "赤字が続くと見限る"],
      "backstory": "チェーン店の元店長。数字は読めるが、味への情熱は薄い。",
      "route_bias": { "independent": 0.3, "stay": 0.3, "betray": 0.35, "retire": 0.05 }
    }
  ],
  "cards": [
    {
      "id": "menya", "name": "麺屋の親父", "name_en": "The Noodle Maker", "emoji": "👨‍🏭", "type": "supplier",
      "personality": "職人気質・照れ屋", "tone": "「あんた、麺のこと分かっとらんな」",
      "unlocks": "自家製麺（premium noodle）", "requirement": "関係値 60 以上",
      "backstory": "三代続く製麺所。腕を認めた店にしか良い麺を回さない。",
      "requirement_value": 60,
      "combo": { "with": "gonzo", "effect": "旧知の仲。両方いると麺の質にさらに補正、専用イベント発生" }
    },
    {
      "id": "reporter", "name": "地元紙の記者", "name_en": "Local Reporter", "emoji": "📰", "type": "media",
      "personality": "軽薄だが目は確か", "tone": "「いい記事、書きますよ。……たぶん」",
      "unlocks": "取材イベント（評判が跳ねる／下がる）", "requirement": "関係値 40 以上",
      "backstory": "地域情報誌の記者。店の仕上がり次第で記事の内容が変わる。",
      "requirement_value": 40,
      "risk": "店の完成度が低い時期に取材が来ると評判が下がる"
    },
    {
      "id": "landlord", "name": "大家", "name_en": "The Landlord", "emoji": "🏠", "type": "property",
      "personality": "商売人・情も少しある", "tone": "「まあ、あんたなら待つよ。今回だけね」",
      "unlocks": "家賃交渉、家賃上昇イベントの緩和", "requirement": "関係値 50 以上",
      "backstory": "商店街の物件をいくつも持っている。関係が良ければ融通が利く。",
      "requirement_value": 50
    },
    {
      "id": "oldman", "name": "うるさい常連", "name_en": "The Picky Regular", "emoji": "🧓", "type": "customer",
      "personality": "口が悪いが的確", "tone": "「今日のスープ、薄いな」",
      "unlocks": "レシピの正確なフィードバック（数値ヒント）", "requirement": "関係値 30 以上",
      "backstory": "毎日同じ席。味の変化を全部言い当てる。彼が満足するなら味は間違っていない。",
      "requirement_value": 30,
      "combo": { "with": "menya", "effect": "昔の知り合い。両方いると新しい麺の相談イベントが発生" }
    },
    {
      "id": "lender", "name": "金貸し", "name_en": "The Lender", "emoji": "💰", "type": "finance",
      "personality": "愛想がいい。だが冷たい", "tone": "「困ったらいつでもどうぞ。……いつでもね」",
      "unlocks": "緊急融資（高金利）", "requirement": "関係値不問",
      "requirement_value": 0,
      "risk": "返済が滞ると強制イベントが発生する"
    }
  ]
};

// STEP1(docs/新設計/01_STEP1_新システム用データ基盤_修正版.md §2-2)で型だけ宣言していたが、
// STEP5(docs/新設計/05_STEP5_従業員能力と育成_修正版.md §1)で実際に値を割り当てた。
// 基礎値(cooking/speed/service/development)とmaxLevelは上のstaff各人の"newStats"/"maxLevel"を
// 参照すること(このオブジェクトはキーの一覧を示す参考用にとどめ、書き換えていない)。
// 現在Lv(level)と、Lvアップで伸びた分の上乗せは静的データではなく state.staffState[id] 側
// (level, newStatBonus)で管理する(既存のstatBonusと同じ考え方。js/event-engine.jsのensureStaffState)。
// 給料はLvが上がっても自動では上げない(§3の指示どおり。上げる仕組みはSTEP6のスカウトで扱う)。
// 既存の5能力(noodle/prep/service/numbers/teach)・士気・関係値・ルート分岐・traits・backstory・
// 専用イベントは1つも変更していない。
window.DATA.newStaffStatShape = {
  cooking: null,     // 調理 1〜10 (各staffの newStats.cooking を参照)
  speed: null,       // 速度 1〜10 (各staffの newStats.speed を参照)
  service: null,     // 接客 1〜10 (各staffの newStats.service を参照)
  development: null, // 開発 1〜10 (各staffの newStats.development を参照。今回は計算に未使用)
  level: null,        // 現在Lv 1〜 (state.staffState[id].level で管理。全員Lv1からスタート)
  maxLevel: null,      // 最大Lv(ポテンシャル) 1〜 (各staffの maxLevel を参照)
  wage: null           // 給料(円) (各staffの既存 wage を参照。Lvでは変わらない)
};
