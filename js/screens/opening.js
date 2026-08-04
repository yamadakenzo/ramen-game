// オープニング(仮テキスト、3〜4画面、スキップ可能)
window.ScreenOpening = (function () {
  var h = window.UI.h;

  var PAGES = [
    "……いつからだろう、自分の店を持ちたいと思うようになったのは。",
    "修行先の厨房で、湯気の向こうに小さな暖簾が見えた気がした。",
    "貯金と、いくらかの借金と、覚悟。それだけを持って、この街に来た。",
    "さあ、店を開けよう。"
  ];

  function render(onFinish) {
    var root = document.getElementById("screen-opening");
    window.UI.clear(root);
    var idx = 0;

    function draw() {
      window.UI.clear(root);
      var box = h("div", { className: "opening-box" }, [
        h("p", { text: PAGES[idx] }),
        h("div", { className: "opening-actions" }, [
          h("button", {
            className: "btn", text: "スキップ",
            onclick: function () { onFinish(); }
          }),
          h("button", {
            className: "btn primary",
            text: idx < PAGES.length - 1 ? "つづける" : "開業準備へ",
            onclick: function () {
              if (idx < PAGES.length - 1) { idx++; draw(); }
              else onFinish();
            }
          })
        ])
      ]);
      root.appendChild(box);
    }
    draw();
  }

  return { render: render };
})();
