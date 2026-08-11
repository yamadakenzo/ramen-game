// STEP8(docs/新設計/08_STEP8_複数ラーメンとサイドメニュー_修正版.md §2): サイドメニュー5種。
// 説明文は書かない(数値の表だけ。指示書§4「翻訳量を増やさないため」)。
// segments: 「よく頼む客層」(注文確率が高くなる客層のid配列。他の客層は低い確率で注文する)。
//
// 絵文字について: 指示書は「ライス🍚・ビール🍺・餃子🥟・チャーハン🍛・唐揚げ🍗」を提案しているが、
// このゲームの絵文字フォント(Noto Emoji、実使用分だけをサブセット化したもの。css/emoji-fonts.css)
// にはこの5つのグリフが含まれていない。指示書§2「含まれていない場合は、含まれている絵文字に
// 差し替えてよい。新しくフォントを取得し直さないこと」に従い、既存フォントに含まれる食べ物系の
// 絵文字へ差し替えた(値と理由はPROGRESS.md「STEP8対応」参照)。
window.DATA = window.DATA || {};
window.DATA.sides = {
  items: [
    { id: "rice",       name: "ライス",     emoji: "🍥", price: 150, cost: 30,  workload: 1, segments: ["student", "salaryman"] },
    { id: "beer",       name: "ビール",     emoji: "🥘", price: 500, cost: 150, workload: 1, segments: ["salaryman", "tourist"] },
    { id: "gyoza",      name: "餃子",       emoji: "🍳", price: 350, cost: 120, workload: 4, segments: ["family", "regular"] },
    { id: "fried_rice", name: "チャーハン", emoji: "🍲", price: 600, cost: 200, workload: 7, segments: ["student", "family"] },
    { id: "karaage",    name: "唐揚げ",     emoji: "🥩", price: 450, cost: 180, workload: 6, segments: ["student", "salaryman"] }
  ]
};
