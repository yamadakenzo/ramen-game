// v31 §3-2: 絵文字 → 画像 差し替えの共通ヘルパー。
// 各画面が個別に<img>を書き散らさないよう、ここ1箇所にまとめる。
//
// 使い方: window.AssetImage.node(def)
//   def は id・name・emoji・(あれば)img を持つデータ定義そのもの
//   (js/data/recipes.js 等でこのSTEPから追加したimgフィールド。値は例えば "material/chicken"
//   のように img/ 配下の拡張子なしパス。フィールドが無ければ絵文字のまま)。
//
// 返すもの:
//   - defにimgがあれば <img>要素(読み込みに失敗したら自動で絵文字のテキストノードに差し替わる)
//   - imgが無い、またはdef自体が無ければ 絵文字のテキストノード
// どちらも「呼び出し元が持つ .emoji-font 要素の子として置く」前提の1文字ぶんのサイズで表示される
// (img側の実寸はcss/style.cssの .emoji-font img { width:1em; height:1em; ... } が決める)。
window.AssetImage = (function () {
  // v14で決めたキャッシュ対策(?v=20260822002923)と同じ形。tools/deploy-pages.shが公開時に
  // 実際の日時へ置換する(このファイル自体には常にプレースホルダのまま残る)。
  var BUILD_V = "20260822002923";

  function node(def) {
    if (!def) return document.createTextNode("");
    if (def.img) {
      var img = document.createElement("img");
      img.src = "img/" + def.img + ".webp?v=" + BUILD_V;
      img.alt = def.name || "";
      img.loading = "lazy";
      // §3-2「画像が読めなかった場合も絵文字にフォールバックすること」
      img.addEventListener("error", function onErr() {
        img.removeEventListener("error", onErr);
        if (img.parentNode) img.parentNode.replaceChild(document.createTextNode(def.emoji || ""), img);
      });
      return img;
    }
    return document.createTextNode(def.emoji || "");
  }

  return { node: node };
})();
