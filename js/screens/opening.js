// オープニング(v30: 動画版。video/opening.mp4を全画面自動再生し、endedまたはスキップで
// onFinishを呼ぶ。動画が読み込めない/再生できない環境向けに、旧テキスト4画面を
// renderTextFallback()として残してある(§4-2、消さない)。
window.ScreenOpening = (function () {
  var h = window.UI.h;

  var VIDEO_SRC = "video/opening.mp4";

  var PAGES = [
    "……いつからだろう、自分の店を持ちたいと思うようになったのは。",
    "修行先の厨房で、湯気の向こうに小さな暖簾が見えた気がした。",
    "貯金と、いくらかの借金と、覚悟。それだけを持って、この街に来た。",
    "さあ、店を開けよう。"
  ];

  // ---- 旧テキスト4画面(v14以前の仮実装。動画版のフォールバックとして残す) ----
  function renderTextFallback(onFinish) {
    var root = document.getElementById("screen-opening");
    window.UI.clear(root);
    var idx = 0;
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      onFinish();
    }

    function draw() {
      window.UI.clear(root);
      var box = h("div", { className: "opening-box" }, [
        h("p", { text: PAGES[idx] }),
        h("div", { className: "opening-actions" }, [
          h("button", {
            className: "btn", text: "スキップ",
            onclick: function () { finish(); }
          }),
          h("button", {
            className: "btn primary",
            text: idx < PAGES.length - 1 ? "つづける" : "開業準備へ",
            onclick: function () {
              if (idx < PAGES.length - 1) { idx++; draw(); }
              else finish();
            }
          })
        ])
      ]);
      root.appendChild(box);
    }
    draw();
  }

  // ---- v30: 動画版 ----
  // onFinishは「再生完了(ended)」か「スキップボタン」のどちらか片方だけから、必ず1回呼ぶ
  // (両方から呼ばれる競合を避けるため、finish()自体をfinished/fellBackの2フラグで防御する)。
  function renderVideo(onFinish) {
    var root = document.getElementById("screen-opening");
    window.UI.clear(root);
    var finished = false;
    var fellBack = false;

    function finish() {
      if (finished || fellBack) return;
      finished = true;
      onFinish();
    }

    // 動画ファイルが無い・デコードできない等でerrorイベントを拾った場合、旧テキスト版へ
    // 切り替える(§4-2)。renderTextFallbackがroot内をクリアするので、動画要素・スキップ
    // ボタンはこの時点でDOMから外れる(以後finish()が呼ばれても上のガードで無視される)。
    function fallback() {
      if (finished || fellBack) return;
      fellBack = true;
      renderTextFallback(onFinish);
    }

    var video = document.createElement("video");
    video.className = "opening-video";
    video.src = VIDEO_SRC;
    // 自動再生制限対策(§4-1)。属性・プロパティ両方で明示する。
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.addEventListener("ended", finish);
    video.addEventListener("error", fallback);
    root.appendChild(video);

    // 右上に常設のスキップボタン。js/screens/setup.js の .setup-skip と同じ見た目・挙動
    // (position: absolute; top:8px; right:8px、css/style.css)をそのまま流用する。
    root.appendChild(h("button", {
      className: "btn small setup-skip", text: "スキップ",
      onclick: function () { finish(); }
    }));

    // muted+autoplayなら通常はここで再生が始まる。play()自体が例外・rejectを返しても
    // (=自動再生ポリシーで止められても)、それはerrorイベントとは別物なので黙って無視する
    // (その場合でもスキップボタンで先へ進める)。
    var playResult = video.play();
    if (playResult && typeof playResult.catch === "function") {
      playResult.catch(function () {});
    }
  }

  function render(onFinish) {
    // 2周目以降の扱いは未確定(§4-3、謙蔵さんに要確認)。現時点では毎回動画を再生する。
    renderVideo(onFinish);
  }

  return { render: render };
})();
