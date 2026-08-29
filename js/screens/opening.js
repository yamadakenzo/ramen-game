// オープニング(v38-1: 画像+CSS/JS版。docs/指示書/v38-1_オープニング刷新_指示書.md)。
// v30の動画版(video/opening.mp4、object-fit:containの上下黒帯)と、そのフォールバックだった
// 旧テキスト4画面(renderTextFallback)は廃止した。
//
// 構成は3段(v41 §61 で先頭に1枚足した):
//   renderGate(bgmId, onStart) … 「タップして始める」の1枚。触れた瞬間に曲を始めてから先へ渡す。これが無いと
//                             ブラウザが音を鳴らさせず、オープニングが無音で流れてしまう(§60・§61)。
//                             **起動のたびに必ず1回**通す(1周目・2周目とも。§61-3)。絵は img/gate/bowl.webp、
//                             まだ無ければ文字だけの形になる(GATE_PIC)。
//   renderCinematic(onDone) … 約10秒のシネマティック(商店街→店構え→厨房→丼→ズーム→白フラッシュ)。
//                             右上のスキップで即 onDone(=タイトル画面へ。setupへ直行ではない)。
//                             v38-2: モードメニューの「オープニング」札(js/screens/menu.js)からも直接呼ばれる
//                             (その場合の onDone はメニューへ戻る。描画先は変わらず #screen-opening)。
//   renderTitle(onStart)    … タイトル画面(ロゴ落下・TAP TO START)。フレーム全体タップで onStart。
//                             v38-2: 左下「オープニングをもう一度見る」はメニューの「オープニング」札へ移設し廃止。
// render(onFinish) が両者をつなぐ(呼び出し元は js/main.js の goToPhase("opening") の1か所。onFinish の先は
// v38-2 からモードメニュー。setup へは進まない)。
// 2周目以降(localStorageの既視フラグあり)はシネマティックを省略してタイトル画面へ直行する。
//
// アニメーションは可視化のみ: 切替の"時刻"はJS(単一スケジューラ、setTimeoutは常に1本)、
// 見た目の動きは css/style.css の CSSアニメーション。秒数はJSがCSS変数(--d 等)で流し込むだけで、
// JSがアニメの中間値を読んで何かを決めることはしない。数値・ゲームロジック・状態遷移には触れない。
window.ScreenOpening = (function () {
  var h = window.UI.h;

  // ---- 2周目判定 ----
  // 通常セーブ(ramen_v10_save)とは別、周回引き継ぎ(ramen_meta)にも入れない独立キー。
  // セーブ内に置くと「はじめから」の clearSave() で消えて毎回流れてしまい、ramen_meta は
  // 「履歴と関係だけ」の器(META_VERSION に巻き込まれる)なので、どちらにも混ぜない。
  var SEEN_KEY = "ramen_opening_seen";
  function hasSeen() {
    try { return localStorage.getItem(SEEN_KEY) === "1"; } catch (e) { return false; }
  }
  function markSeen() {
    try { localStorage.setItem(SEEN_KEY, "1"); } catch (e) { /* 保存できない環境では毎回再生されるだけ */ }
  }

  // ---- 画像 ----
  // js/asset-image.js と同じキャッシュ対策(?v=20260829172029)。tools/deploy-pages.sh が公開時に置換する。
  var BUILD_V = "20260829172029";
  var DIR = "img/opening/";
  function src(name) { return DIR + name + ".webp?v=" + BUILD_V; }
  // 画像の参照はこのテーブル1か所だけ。他所でファイル名を書かない。
  // bowl の4K版は不採用(アップスケーラーが平塗りにテクスチャを足して画風が崩れる。2Kをブラウザで
  // 拡大する方がきれい。docs/設計判断記録.md §54参照)。2048×2048 のまま。
  var IMG = {
    street: src("street"),         // 1536×2752 商店街(カット①)
    storefront: src("storefront"), // 1536×2752 店構え・暖簾なし(カット②・タイトル画面)
    norenA: src("noren_a"),        // 860×663 透過 暖簾2コマ
    norenB: src("noren_b"),
    kitchen: src("kitchen"),       // 1536×2752 厨房・人なし(カット③)
    chefA: src("chef_a"),          // 1080×1193 透過 主人公の湯切り2コマ
    chefB: src("chef_b"),
    bowl: src("bowl")              // 2048×2048 丼・真上(カット④、スープ中心は 50%,47.5%)
  };

  // 先読み。指定した画像すべての load/error を待ってから cb を呼ぶ(error でも待ち続けないよう、
  // 成否を問わず"決着"で数える)。決着は画像ごとにモジュール内で1回だけ持つので、シネマティック(8枚)
  // の後にタイトル画面(3枚)が続いても二重に読まず、既に決着済みなら cb は同期で呼ばれる。
  //   ALL_KEYS   … シネマティック開始前(読み込み中は黒のまま)
  //   TITLE_KEYS … 2周目のタイトル直行時(コールドロードで店構え・暖簾がポップインしないように)
  var ALL_KEYS = Object.keys(IMG);
  var TITLE_KEYS = ["storefront", "norenA", "norenB"];
  var settled = {};   // key -> true(決着済み)
  var loading = {};   // key -> 決着待ちの cb 配列(読み込み中のみ)
  function loadOne(key, cb) {
    if (settled[key]) { cb(); return; }
    if (loading[key]) { loading[key].push(cb); return; }
    loading[key] = [cb];
    function settle() {
      settled[key] = true;
      var cbs = loading[key]; loading[key] = null;
      cbs.forEach(function (f) { f(); });
    }
    var im = new Image();
    im.onload = settle;
    im.onerror = settle;
    im.src = IMG[key];
  }
  function preload(keys, cb) {
    var left = keys.length;
    keys.forEach(function (k) {
      loadOne(k, function () { left--; if (left === 0) cb(); });
    });
  }

  // ---- タイムライン(秒) ----
  // ここだけ直せば全体がずれる。各カットの開始時刻は CUT_DUR を順に積算して求める(下の buildTimeline)。
  var CUT_DUR = { street: 2.5, storefront: 2.5, kitchen: 2.5, bowl: 1.5 };
  var T = {
    fadeIn: 0.4,      // カット①: 黒からのフェードイン
    driftStreet: 1.08, // カット①: 背景 scale(1)→scale(1.08)(カットの長さぶん linear)
    driftStore: 1.04,  // カット②: 背景 scale(1)→scale(1.04)
    norenStep: 0.4,   // 暖簾のコマ間隔
    chefStep: 0.35,   // 主人公のコマ間隔
    cutIn: 0.35,      // カットイン: 帯の通過時間
    // カットイン: 帯に対する次カット(クリップ)の時間差。指示書の初期値は0.08sだったが、同じイージングの
    // 帯が抜けた後もクリップが動き続けて旧カットが見えるため0にし、「帯が先行・カットが追従」は
    // css/style.css 側の幾何(クリップの直線が帯の後端に乗る)で作っている。
    cutInLag: 0,
    zoom: 1.0,        // 丼ズーム(カット④の末尾に続く)
    flash: 0.15,      // 白フラッシュ(ズーム終端に重ねる。opacity 0→1)
    flashOut: 0.3,    // タイトル画面の上で白が消える時間
    logoDelay: 0.2,   // タイトル画面表示からロゴ落下開始まで
    logoDrop: 1.0,    // ロゴ落下バウンド
    subDelay: 1.2,    // タイトル画面表示からサブタイトル/TAP表示まで
    subFade: 0.4      // サブタイトル/TAP のフェードイン
  };

  // ---- 単一スケジューラ ----
  // events: [{at: 秒, run: fn}]。performance.now() 基準で「次のイベントまで」の setTimeout を
  // 1本だけ回す。stop() で残りを全部捨てられる(スキップ用)。run() の中から stop() を呼んでもよい。
  function makeScheduler(events) {
    var list = events.slice().sort(function (a, b) { return a.at - b.at; });
    var i = 0, t0 = 0, timer = null, stopped = false;
    function elapsed() { return performance.now() - t0; }
    function step() {
      timer = null;
      while (!stopped && i < list.length && list[i].at * 1000 <= elapsed() + 1) {
        var ev = list[i]; i++;
        ev.run();
      }
      if (!stopped && i < list.length) {
        timer = setTimeout(step, Math.max(0, list[i].at * 1000 - elapsed()));
      }
    }
    return {
      start: function () { t0 = performance.now(); step(); },
      stop: function () { stopped = true; if (timer) clearTimeout(timer); timer = null; }
    };
  }

  // ---- DOM部品 ----
  function img(className, s) {
    return h("img", { className: className, src: s, alt: "", draggable: "false" });
  }
  function setVar(el, name, val) { el.style.setProperty(name, val); return el; }

  // 2コマ交互(暖簾・主人公)。a/bを重ね、CSSの steps(2) で片方ずつ見せる。
  function frames(className, a, b, step) {
    var el = h("div", { className: "op-frames " + className }, [
      img("op-frame op-frame-a", a),
      img("op-frame op-frame-b", b)
    ]);
    return setVar(el, "--step", step + "s");
  }

  // 1カット。背景(cover)+レイヤーを .op-pic(画像基準の箱)>.op-zoom に積む。
  //   opts.drift: 到達倍率(背景のゆっくりズーム。省略で静止)  opts.dur: そのカットの長さ(秒)
  function makeCut(bgSrc, layers, opts) {
    opts = opts || {};
    var zoom = h("div", { className: "op-zoom" + (opts.drift ? " op-drift" : "") },
      [img("op-bg", bgSrc)].concat(layers || []));
    if (opts.drift) { setVar(zoom, "--to", String(opts.drift)); setVar(zoom, "--d", opts.dur + "s"); }
    var pic = h("div", { className: "op-pic" }, [zoom]);
    return h("div", { className: "op-cut" + (opts.className ? " " + opts.className : "") }, [pic]);
  }
  function norenLayer() { return frames("op-noren", IMG.norenA, IMG.norenB, T.norenStep); }
  function chefLayer() { return frames("op-chef", IMG.chefA, IMG.chefB, T.chefStep); }
  // 店構え+暖簾はカット②とタイトル画面で共通
  function storefrontCut(opts) { return makeCut(IMG.storefront, [norenLayer()], opts); }

  // ---- 最初の1枚「タップして始める」(v41 §61) ----
  // ブラウザは一度も操作がないと音を鳴らさせない(§60)。オープニングを**最初のコマから曲つき**で
  // 流すには、その前に一度触ってもらうしかない。ここで曲を鳴らし始めてから先へ渡す。
  // 押した瞬間(click=操作として成立している)に bgm(bgmId)。先の画面が同じ id を呼んでも鳴らし直さない。
  //
  // 出すのは「起動してから1回、いちばん最初だけ」:
  //   - **1周目・2周目とも出す**(§61-3)。2周目だけ出さないと、1周目は「触ってから画面が始まる」・
  //     2周目は「タイトルが無音で数秒立ち上がってから鳴る」となり、起動ごとに立ち上がりの印象が変わる。
  //   - シネマティックの途中では出ない(この画面は先頭に1回描くだけ)
  //   - メニューの「オープニング」札からの再生では出ない(あちらは renderCinematic を直接呼ぶ)
  //   - 同じ読み込みの中で render() が二度呼ばれても出ない(gatePassed)
  // ---- 関門の絵(v41 §61-6) ----
  // 絵が届いたら img/gate/bowl.webp(縦横比 1:1)を置き、GATE_PIC を true にする。**それだけで出る。**
  // false の間は要求しない: 無いファイルを要求すると 404 がコンソールエラーになるため(§57-1 と同じ理由)。
  // 置いたのに読めなかった場合も、絵の枠ごと外して文字だけの形に戻る(下の error ハンドラ)。
  var GATE_PIC = true;
  var GATE_IMG = "img/gate/bowl.webp?v=" + BUILD_V;

  var gatePassed = false;   // ページを読み込み直すまで持つ(タブを開き直せばまた出る)
  // bgmId は「この関門を抜けた先の画面で鳴る曲」。1周目はシネマティックなので "opening"、
  // 2周目はタイトルへ直行するので "title"。抜けた先が同じ id を呼んでも鳴らし直さない(js/audio.js の bgm())。
  function renderGate(bgmId, onStart) {
    var root = document.getElementById("screen-opening");
    window.UI.clear(root);
    var started = false;
    function start() {
      if (started) return;   // 連打しても1回だけ
      started = true;
      gatePassed = true;
      window.GameAudio.bgm(bgmId); // ← 触れているこの瞬間に鳴らし始める
      window.UI.clear(root);
      onStart();
    }
    var children = [];
    if (GATE_PIC) {
      var pic = h("div", { className: "op-gate-pic" });
      var img = document.createElement("img");
      img.src = GATE_IMG;
      img.alt = "";
      // 読めなければ枠ごと外す。絵の無い状態＝文字だけの形に戻るだけで、画面は壊れない。
      img.addEventListener("error", function () { if (pic.parentNode) pic.parentNode.removeChild(pic); });
      pic.appendChild(img);
      children.push(pic);
    }
    children.push(h("div", { className: "op-gate-text", text: "タップして始める" }));
    var stage = h("div", { className: "op-stage op-gate", onclick: start }, children);
    root.appendChild(stage);
  }

  function skipButton(onSkip) {
    // 右上に常設。js/screens/setup.js の .setup-skip と同じクラス・見た目(css/style.css)を流用。
    return h("button", { className: "btn small setup-skip", text: "スキップ", onclick: onSkip });
  }

  // ---- シネマティック ----
  // onDone は「タイムラインの終端(白フラッシュの下でタイトルへ)」か「スキップ」のどちらか片方から
  // 必ず1回だけ呼ぶ(done フラグで防御。v30の finish() と同じ)。
  function renderCinematic(onDone) {
    var root = document.getElementById("screen-opening");
    window.UI.clear(root);
    window.GameAudio.bgm("opening"); // v39: シネマティックのBGM(自動再生が拒否されれば最初の操作で始まる。js/audio.js §3)
    var done = false;
    var sched = null;

    var stage = h("div", { className: "op-stage" });
    root.appendChild(stage);
    root.appendChild(skipButton(function () { finish(null); }));

    // flash: 白フラッシュの要素。タイトルへ差し替えた後も(root がクリアされるので)付け直して
    // 0.3s で消す。スキップ時は null(白なしで即タイトル)。
    function finish(flash) {
      if (done) return;
      done = true;
      if (sched) sched.stop();
      onDone();
      if (flash) {
        root.appendChild(flash);
        flash.classList.remove("op-in");
        setVar(flash, "--d", T.flashOut + "s");
        flash.classList.add("op-out");
        setTimeout(function () { if (flash.parentNode) flash.parentNode.removeChild(flash); }, T.flashOut * 1000 + 50);
      }
    }

    // カットイン: 帯(.op-band)が斜めに通過し、その直後を追って次カットがクリップで広がる。
    // dir: "rtl"=右上→左下 / "ltr"=左下→右上。帯・クリップは pointer-events:none、終わったら
    // タイムラインのイベントで除去する(animationend には頼らない=時刻はすべてJSが持つ)。
    var current = null;
    function showCut(cut) {
      stage.appendChild(cut);
      current = cut;
    }
    function cutIn(dir, nextCut) {
      var band = setVar(h("div", { className: "op-band op-" + dir }), "--d", T.cutIn + "s");
      stage.appendChild(band);
      nextCut.classList.add("op-wipe-" + dir);
      setVar(nextCut, "--d", T.cutIn + "s");
      setVar(nextCut, "--lag", T.cutInLag + "s");
      var prev = current;
      showCut(nextCut);
      return function cleanup() {
        if (band.parentNode) band.parentNode.removeChild(band);
        if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
        nextCut.classList.remove("op-wipe-" + dir);
      };
    }

    function buildTimeline() {
      var ev = [];
      var t = 0;
      var cleanup = null;
      function addCutIn(at, dir, makeNext) {
        ev.push({ at: at, run: function () { cleanup = cutIn(dir, makeNext()); } });
        // 帯(0.35s)+遅れ(0.08s)が終わった後に片付ける
        ev.push({ at: at + T.cutIn + T.cutInLag + 0.05, run: function () { if (cleanup) cleanup(); cleanup = null; } });
      }

      // カット① 商店街: 黒からフェードイン、背景 scale(1)→scale(1.08) を linear
      ev.push({ at: 0, run: function () {
        var c = makeCut(IMG.street, [], { drift: T.driftStreet, dur: CUT_DUR.street, className: "op-fade-in" });
        setVar(c, "--d", T.fadeIn + "s");
        showCut(c);
      } });
      t += CUT_DUR.street;
      // カットイン①(右上→左下) → カット② 店構え+暖簾
      addCutIn(t, "rtl", function () { return storefrontCut({ drift: T.driftStore, dur: CUT_DUR.storefront }); });
      t += CUT_DUR.storefront;
      // カットイン②(左下→右上) → カット③ 厨房+主人公(背景は静止)
      addCutIn(t, "ltr", function () { return makeCut(IMG.kitchen, [chefLayer()]); });
      t += CUT_DUR.kitchen;
      // カットイン③(右上→左下) → カット④ 丼(静止)
      var bowlImg = img("op-bowl", IMG.bowl);
      addCutIn(t, "rtl", function () {
        return h("div", { className: "op-cut op-cut-bowl" }, [h("div", { className: "op-bowl-wrap" }, [bowlImg])]);
      });
      t += CUT_DUR.bowl;
      // ズーム(1.0s)。終端に白フラッシュ(0.15s)を重ね、白の下でタイトル画面へ差し替える。
      ev.push({ at: t, run: function () { setVar(bowlImg, "--d", T.zoom + "s"); bowlImg.classList.add("op-zooming"); } });
      var flash = setVar(h("div", { className: "op-flash" }), "--d", T.flash + "s");
      ev.push({ at: t + T.zoom - T.flash, run: function () { stage.appendChild(flash); flash.classList.add("op-in"); } });
      ev.push({ at: t + T.zoom, run: function () { finish(flash); } });
      return ev;
    }

    preload(ALL_KEYS, function () {
      if (done) return; // 読み込み中にスキップされた
      sched = makeScheduler(buildTimeline());
      sched.start();
    });
  }

  // ---- タイトル画面 ----
  // onStart はユーザー操作(タップ)起点なので、音の再生開始の起点にできる(自動再生制限に掛からない)。
  // v38-2: この先のモードメニューで効果音(js/audio.js)が鳴り始める。BGMはまだ無い。
  function renderTitle(onStart) {
    var root = document.getElementById("screen-opening");
    window.UI.clear(root);
    // 店構え・暖簾の3枚が決着してから組み立てる。シネマティックの直後(白フラッシュの下)は8枚とも
    // 決着済みなので同期で進み、白の下で差し替わる。2周目のタイトル直行だけが実際に待つ
    // (待っている間は枠の地色のまま)。
    preload(TITLE_KEYS, function () { buildTitle(root, onStart); });
  }

  function buildTitle(root, onStart) {
    var started = false;
    markSeen(); // タイトル画面が初めて表示された時点で既視扱い(2周目以降はシネマティック省略)
    window.GameAudio.bgm("title"); // v39: タイトル画面〜メニューのBGM(メニューへ移っても切り替えない。同じ曲なら鳴らし直さない)

    function start() {
      if (started) return;
      started = true;
      window.UI.clear(root); // 非表示になっても暖簾のコマ送りなどが残らないよう片付ける
      onStart();
    }

    var logo = h("div", { className: "op-logo" }, [h("span", { text: "RAMEN" }), h("span", { text: "DREAM" })]);
    var sub = h("div", { className: "op-sub", text: "どんぶりちゃん" });
    var tap = h("div", { className: "op-tap", text: "TAP TO START" });
    var children = [
      storefrontCut(),
      h("div", { className: "op-logo-pos" }, [logo]),
      sub, tap
    ];
    var stage = h("div", { className: "op-stage op-title", onclick: start }, children);
    root.appendChild(stage);

    // ロゴ落下(+0.2s)とサブタイトル/TAP(+1.2s)。タイトル画面内の演出なので、シネマティックとは
    // 別の(短い)スケジューラを1本回す。start() 後に発火しても、外れたDOMにクラスが付くだけ。
    setVar(logo, "--d", T.logoDrop + "s");
    setVar(sub, "--d", T.subFade + "s");
    setVar(tap, "--d", T.subFade + "s");
    var sched = makeScheduler([
      { at: T.logoDelay, run: function () { logo.classList.add("op-drop"); } },
      { at: T.subDelay, run: function () { sub.classList.add("op-show"); tap.classList.add("op-show"); } }
    ]);
    sched.start();
  }

  // ---- 入口 ----
  // onFinish(v38-2 からはモードメニューへ)は必ず1回だけ(finished で守る)。
  function render(onFinish) {
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      onFinish();
    }
    function showTitle() { renderTitle(finish); }
    // 2周目(既視)はシネマティックを飛ばしてタイトルへ直行する。
    function afterGate() { if (hasSeen()) showTitle(); else renderCinematic(showTitle); }
    // 関門は**起動のたびに必ず1回**通す(v41 §61-3)。2周目だけ出さないと、1周目は「触ってから画面が始まる」・
    // 2周目は「タイトルが無音で数秒立ち上がってから鳴る」となり、起動ごとに立ち上がりの印象が変わってしまう。
    // 抜けた先で鳴る曲をここで始めるので、1周目は "opening"、2周目は "title"。
    if (gatePassed) { afterGate(); return; }
    renderGate(hasSeen() ? "title" : "opening", afterGate);
  }

  return { render: render, renderCinematic: renderCinematic, renderTitle: renderTitle };
})();
