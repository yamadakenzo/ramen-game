// STEP1(docs/新設計/01_STEP1_新システム用データ基盤_修正版.md §2-4): 素材カードの器。
// このファイルはまだどこからも読み込まれない(index.htmlへの追加のみ)。取得・所持・Lv・分岐の
// 仕組みはSTEP2・STEP3で作る。ここでは全体設計書(00_全体設計_ClaudeCode用.md §9)の仮数値表を
// カテゴリ別に写しただけ。カテゴリは soup / tare / noodle / aromaOil / topping の5種
// (現行の js/data/recipes.js に無い「香味油(aromaOil)」がここで新設される)。
//
// 各カードの数値は新パラメータの軸(quality=品質, richness=濃さ, volume=量, uniqueness=個性,
// cost=原価)で持つ。STEP1時点では js/data/recipes.js とは別物の参照用データだったが、
// STEP4(docs/新設計/04_STEP4_ラーメン新パラメータとレシピ計算_修正版.md §3〜4)で
// js/data/recipes.js側の各素材にも同じ軸(quality/richness/uniqueness、oilinessは廃止)を
// 実際に付与した。このファイル自体は今も未使用(取得・所持の仕組みはSTEP2・STEP3)のままだが、
// その際にrecipes.js側の値を割り当てる参照元として使った。
//
// 全体設計書 §3-1〜3-3 の原則(このSTEP1修正版の§3で再宣言されたもの)を先に踏まえておく:
//   - 隠し組み合わせ効果を作らない(効果は全て数字で画面表示)
//   - 説明文は数値の表だけにする(「コクのある深い味わい」のような文章は書かない)
//   - Lvが上がっても完全上位互換にはしない(具体的な引き換えの数値はSTEP3で決める)
window.DATA = window.DATA || {};
window.DATA.cards = {
  soup: [
    { id: "chicken_bone", name: "鶏ガラ", cost: 90, quality: 18, richness: 12, volume: 0, uniqueness: 8 },
    { id: "pork_bone", name: "豚骨", cost: 130, quality: 20, richness: 25, volume: 0, uniqueness: 15 },
    { id: "niboshi", name: "煮干し", cost: 110, quality: 17, richness: 18, volume: 0, uniqueness: 18 },
    { id: "seafood", name: "魚介", cost: 125, quality: 18, richness: 14, volume: 0, uniqueness: 20 }
  ],
  tare: [
    { id: "shoyu", name: "醤油", cost: 35, quality: 10, richness: 8, volume: 0, uniqueness: 5 },
    { id: "shio", name: "塩", cost: 30, quality: 9, richness: 3, volume: 0, uniqueness: 6 },
    { id: "miso", name: "味噌", cost: 55, quality: 12, richness: 18, volume: 0, uniqueness: 12 },
    { id: "spicy_miso", name: "辛味噌", cost: 65, quality: 11, richness: 22, volume: 0, uniqueness: 18 }
  ],
  noodle: [
    { id: "regular", name: "普通麺", cost: 65, quality: 8, richness: 0, volume: 10, uniqueness: 2 },
    { id: "thin", name: "細麺", cost: 60, quality: 7, richness: -3, volume: 7, uniqueness: 5 },
    { id: "thick", name: "太麺", cost: 80, quality: 9, richness: 4, volume: 15, uniqueness: 7 },
    { id: "chijire", name: "ちぢれ麺", cost: 75, quality: 8, richness: 2, volume: 11, uniqueness: 8 }
  ],
  aromaOil: [
    { id: "chicken_oil", name: "鶏油", cost: 25, quality: 5, richness: 6, volume: 0, uniqueness: 4 },
    { id: "backfat", name: "背脂", cost: 30, quality: 3, richness: 14, volume: 4, uniqueness: 7 },
    { id: "mayu", name: "マー油", cost: 40, quality: 5, richness: 8, volume: 0, uniqueness: 12 },
    { id: "rayu", name: "ラー油", cost: 25, quality: 2, richness: 7, volume: 0, uniqueness: 8 }
  ],
  topping: [
    { id: "negi", name: "ネギ", cost: 15, quality: 1, richness: 0, volume: 1, uniqueness: 1 },
    { id: "menma", name: "メンマ", cost: 25, quality: 2, richness: 0, volume: 3, uniqueness: 2 },
    { id: "nori", name: "海苔", cost: 18, quality: 1, richness: 0, volume: 1, uniqueness: 3 },
    { id: "moyashi", name: "もやし", cost: 18, quality: 0, richness: -2, volume: 8, uniqueness: 1 },
    { id: "hourensou", name: "ほうれん草", cost: 30, quality: 3, richness: -2, volume: 4, uniqueness: 4 },
    { id: "kikurage", name: "きくらげ", cost: 25, quality: 2, richness: 0, volume: 3, uniqueness: 5 },
    { id: "chashu", name: "チャーシュー", cost: 85, quality: 7, richness: 4, volume: 8, uniqueness: 4 },
    { id: "ajitama", name: "味玉", cost: 55, quality: 5, richness: 2, volume: 5, uniqueness: 3 },
    { id: "corn", name: "コーン", cost: 35, quality: 2, richness: 1, volume: 4, uniqueness: 5 },
    { id: "butter", name: "バター", cost: 45, quality: 3, richness: 10, volume: 3, uniqueness: 8 }
  ]
};
