// v01_データ_物件と設備.json を埋め込み
window.DATA = window.DATA || {};
// STEP11(docs/新設計/11_STEP11_経済バランス統合_修正版.md §3): rent(家賃)・funding[].monthly_repay
// (返済額)・equipment[].weekly_upkeep(設備維持費)を、それぞれ元の値の35%に下げた(以下
// 「×0.35」と注記した箇所)。認知度・評判を育て切っても損益分岐点(週の必要客数)に全く届かない
// ほど固定費が重すぎたため(測定の詳細はdocs/設計判断記録.md参照)。initial_cost・seats・
// segment_flow・funding[].amountは変更していない。既存キャラの給料(js/data/characters.js)は
// 指示書§3で「調整してはいけない」に明記されているため、一切触れていない。
// v23(docs/完了/v23_週次費用と月次成績_指示書.md §1-2): rentを月額から週額に換算し直した。
// 式は「週額 = round(月額 ÷ 4.3333 ÷ 500) × 500」(500円単位丸め)。年間総額(52週×週額 と
// 12ヶ月×旧月額の比較)の差はどの物件も±¥4,000以内(検算結果はdocs/設計判断記録.md参照)。
// 割り算を実行時に発生させる実装(v14で不具合の原因になった)はせず、値そのものをここで置き換えた。
// v24(docs/指示書/v24_席の設備化とプレゼント演出_指示書.md §2-3、
// docs/指示書/v24_追補_調査への回答と追加指示.md §1): 席は物件の固定値から state.seats(持ち物)
// へ移った。物件側は「カウンターに置ける席の上限」だけを持つため、旧 seats_counter を
// counterSlots に改名した(値はそのまま)。当初「断面図の描画数(一律8)に合わせる」という
// 判断で進めかけたが、原因は物件データではなく描画側の頭打ち(GEO.drawMaxCounter=8、
// 物件ごとの差別化を潰す描画都合の制約)だったため、その判断は追補で撤回し、
// 値は元のseats_counterをそのまま使っている(判断の経緯はdocs/設計判断記録.md参照)。
// seats_table には一切触れていない(テーブル席を席システムへ移すのは次以降の版)。
window.DATA.property = {
  "properties": [
    {
      "id": "shotengai", "name": "商店街の空き店舗", "name_en": "Shopping Street Vacancy", "emoji": "🏪",
      "initial_cost": 3200000, "rent": 14500, "counterSlots": 10, "seats_table": 0, "condition": "居抜き",
      "segment_flow": { "regular": 1.4, "salaryman": 0.8, "ol": 0.5, "student": 0.6, "family": 0.7, "tourist": 0.3 },
      "traits": ["前の店の設備が使える（初期投資が安い）", "常連文化が根付いている", "商店街の付き合いイベントが多い"],
      "desc": "シャッターが半分閉まった商店街。人通りは多くないが、地元の人が毎日通る。"
    },
    {
      "id": "office", "name": "オフィス街の一階", "name_en": "Office District Ground Floor", "emoji": "🏢",
      "initial_cost": 7800000, "rent": 34000, "counterSlots": 14, "seats_table": 0, "condition": "スケルトン",
      "segment_flow": { "regular": 0.4, "salaryman": 1.6, "ol": 1.5, "student": 0.2, "family": 0.1, "tourist": 0.4 },
      "traits": ["昼のピークが極端（11:30-13:30に集中）", "夜と週末は死ぬ", "回転率が全て"],
      "desc": "ビルの一階。平日の昼だけ人が溢れる。それ以外の時間は誰も通らない。"
    },
    {
      "id": "campus", "name": "大学前", "name_en": "Near Campus", "emoji": "🎓",
      "initial_cost": 4100000, "rent": 18500, "counterSlots": 12, "seats_table": 2, "condition": "居抜き",
      "segment_flow": { "regular": 0.6, "salaryman": 0.5, "ol": 0.3, "student": 2.0, "family": 0.4, "tourist": 0.2 },
      "traits": ["長期休暇に客が消える（2月・8月）", "SNS拡散が起きやすい", "単価が上げられない"],
      "desc": "大学の正門から徒歩3分。学生で溢れるが、休みに入ると街ごと静まる。"
    },
    {
      "id": "roadside", "name": "郊外ロードサイド", "name_en": "Suburban Roadside", "emoji": "🛣️",
      "initial_cost": 9500000, "rent": 25000, "counterSlots": 8, "seats_table": 6, "condition": "スケルトン",
      "segment_flow": { "regular": 0.8, "salaryman": 0.7, "ol": 0.3, "student": 0.5, "family": 1.8, "tourist": 0.5 },
      "traits": ["駐車場あり", "テーブル席が最初からある", "週末に売上が集中", "初期投資が重い"],
      "desc": "幹線道路沿い。車で来る家族連れが主。平日は静かで週末に跳ねる。"
    },
    {
      "id": "tourist_spot", "name": "観光地の路地", "name_en": "Tourist Alley", "emoji": "⛩️",
      "initial_cost": 11000000, "rent": 42000, "counterSlots": 9, "seats_table": 0, "condition": "居抜き",
      "segment_flow": { "regular": 0.3, "salaryman": 0.2, "ol": 0.2, "student": 0.4, "family": 0.6, "tourist": 2.2 },
      "traits": ["単価を高く設定できる", "リピートしない客が中心", "季節変動が激しい", "多言語対応が必須"],
      "desc": "有名な神社の参道から一本入った路地。人は多いが、みんな一度きり。"
    }
  ],
  // STEP7(docs/新設計/07_STEP7_設備_修正版.md §1): 既存8種(ticket_machine〜pos)に
  // weekly_upkeep(週維持費)を追加した。効果・デメリット・購入費は変更していない。
  // 8種の合計は週14,000円(指示書§1・§6-7の確認値)。
  // 「麺量アップ(extra_boiler)」は指示書の設備表(8種)に含まれておらず対象外。週維持費は付けて
  // いない(付けると合計が14,000円からずれるため。指示書自身の合計例とも整合する解釈)。
  "equipment": [
    { "id": "ticket_machine", "name": "券売機",       "emoji": "🎫", "cost": 850000,  "weekly_upkeep": 700,  "effect": "週の処理可能人数+60", "penalty": "家族連れ・観光客の満足度-10", "note": "回転型の要" },
    { "id": "table_seats",    "name": "テーブル席",   "emoji": "🪑", "cost": 420000,  "weekly_upkeep": 350,  "effect": "家族連れ解放、席数+4", "penalty": "回転率-10", "requires_space": true },
    { "id": "exhaust",        "name": "強力ダクト",   "emoji": "💨", "cost": 1200000, "weekly_upkeep": 1400, "effect": "匂いペナルティを70%軽減", "note": "OL・家族連れ狙いなら必須。豚骨と組むと効く" },
    { "id": "multilingual",   "name": "多言語メニュー","emoji": "🌏", "cost": 120000,  "weekly_upkeep": 0,    "effect": "観光客解放、観光客満足度+15" },
    { "id": "bright_light",   "name": "明るい照明",   "emoji": "💡", "cost": 180000,  "weekly_upkeep": 525,  "effect": "brightness+30", "penalty": "常連満足度-5" },
    { "id": "big_pot",        "name": "大型寸胴",     "emoji": "🍲", "cost": 380000,  "weekly_upkeep": 350,  "effect": "週の処理可能人数+50" },
    { "id": "noodle_boiler",  "name": "高性能茹で麺器","emoji": "♨️", "cost": 640000,  "weekly_upkeep": 1050, "effect": "週の処理可能人数+80" },
    { "id": "pos",            "name": "POSレジ",      "emoji": "🖥️", "cost": 300000,  "weekly_upkeep": 525,  "effect": "客層別の売上データを表示" },
    { "id": "extra_boiler",   "name": "麺量アップ",   "emoji": "🍜", "cost": 300000,  "effect": "全メニューの量+15", "note": "茹で麺器の増設。学生・サラリーマンなど量を求める客層の底上げ" }
  ],
  // v17(docs/新設計/v17_ラーメン屋_修正指示書.md §2-2): 「資金調達」の選択自体を無くし、
  // 開業資金を単一の固定額(自己資金のみ)にした。金額の根拠はdocs/設計判断記録.md参照
  // (安い方から2件=商店街3,200,000・大学前4,100,000は買える/3件目以降のオフィス街7,800,000以上は
  // 買えない/大学前を買っても設備1つ+従業員1人+初回の固定費を払える残額がある、の3条件を満たす)。
  "startingCapital": 5500000
};
