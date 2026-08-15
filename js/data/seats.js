// v24(docs/指示書/v24_席の設備化とプレゼント演出_指示書.md §2-1): 席の種類の参照データ。
// 席は物件の固定値(旧 seats_counter)ではなく、state.seats(プレイヤーの持ち物)として持つ。
// 物件側は「カウンターに置ける席の上限」(js/data/property.jsのcounterSlots)だけを持つ。
// 今回中身が入るのは counter だけ。table/private は将来の版で追加する(今回は追加しない。
// 既存のtable_seats設備<js/data/property.js>とは別物なので混同しないこと)。
// price / weekly_upkeep は仮置きの値。バランス調整フェーズで見直す前提(指示書§2-1)。
window.DATA = window.DATA || {};
window.DATA.seats = [
  {
    id: 'counter',
    name: 'カウンター席',
    emoji: '🪑',            // 断面図の丸椅子自体はCSS(.sv-stool)の箱で描く。これは購入パネル等のアイコン用
    capacity: 1,            // 1つ置くと何人座れるか
    space: 1,               // 物件の席スロットをいくつ使うか
    price: 80000,           // 1つ買う値段(仮置き)
    weekly_upkeep: 200      // 週維持費(仮置き)
  }
  // 将来ここに table(capacity:4, space:2)・private(個室)が入る。今回は追加しない。
];
