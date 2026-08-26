// v38-2: モードメニュー(docs/指示書/v38-2_モードメニュー_指示書.md §5〜§7)。タイトル画面(js/screens/opening.js)と
// 本編(setup)の間に挟まる、state を持たない通過点。state.phase には "menu" を書かず、js/main.js が
// goToPhase("menu") で入るだけ。
//
// 札のタップ(v40 §58): 押された事実は pending に積み、カルーセルが止まってから解決する。「止まった」は
// 描画位置(getTranslate)で見る。sw.animating は端のゴム戻りで true のまま降りないことがあり(v40 で実測)、
// §10 のようにそれで分岐すると「押しても開かない・押し直しても開かない」になる。詳細は decide 節のコメント。
// カルーセル(§7): Swiper.js(js/vendor/swiper/、同梱)の coverflow effect。指への追従・フリック・吸着・端のゴム・
// キーボード・矢印・脇の札タップはすべて Swiper に任せ、自前では書かない(§6 の rAF 駆動の自前実装は撤回。
// 毎フレーム filter: brightness() と z-index を書いていたのが滑らかにならない原因だった、§7-1)。
// 効果音は Swiper の transitionEnd(止まった瞬間)で、止まった札が前回と違うときだけ1回(js/audio.js)。
// このメニューが書くのは「止まっている札の番号」だけで、ゲーム側へ渡るのは決定した瞬間のそれ(handlers.onContinue /
// onNewGame)のみ。
// 配色は theme-a「はっきり」で確定(§7-4)。CSS 変数 --m-* は css/style.css の .menu-root 直下。
// 札の絵(v38-3): 各札の .menu-card-pic に AssetImage.node(def) の <img>(img/menu/*.webp、透過)。読み込みに失敗したら
// AssetImage が空のテキストノードに差し替えるので、v38-2 までの無地の面に戻るだけで札は崩れない。
// 「続きから」札の3状態(有効なセーブ/無し/形式不一致)は GameState.hasSave()/hasIncompatibleSave() で
// 決める(旧 js/main.js の showResumeChoice()/showVersionMismatchNotice() の役割を引き取った)。
window.ScreenMenu = (function () {
  var h = window.UI.h;

  // v38-3: img は img/ 配下の拡張子なしパス(js/asset-image.js の AssetImage.node と同じ流儀。?v=__BUILD__ はそちらが付ける)。
  // 絵は img/menu/*.webp(源PNGは docs/素材検討/menu/、共通枠で切って縁の白を透過、docs/完了/v38-3_確認/make_menu_webp.js)。
  var CARDS = [
    { id: "continue", label: "続きから", img: "menu/start" }, // 有効なセーブが無ければ「はじめから」(render() で差し替える)
    { id: "compendium", label: "図鑑", img: "menu/book" },
    { id: "records", label: "記録", img: "menu/record" },
    { id: "opening", label: "オープニング", img: "menu/opening" },
    { id: "settings", label: "設定", img: "menu/settings" }
  ];
  var MISMATCH_TEXT = "セーブデータの形式が変わったため、最初から始まります。"; // 旧 showVersionMismatchNotice() と同文

  // ---- Swiper の設定(§7-3)。実測値は docs/完了/v38-2_確認/確認結果.md「§7 Swiper 版」 ----
  var SPEED = 400;            // 吸着・送りの時間(ms)。prefers-reduced-motion では 0(即切替、§7-3)
  // v40 §58: 押されたあと「止まった」と判定するまでの見張り。POLL ごとに描画位置を見て、STABLE 回続けて
  // 同じなら止まったとみなす。MAX を過ぎたら止まっていなくても解決する(決定待ちを宙に浮かせない)。
  var REST_POLL_MS = 40;
  var REST_STABLE = 2;
  var PENDING_MAX_MS = 2000;
  var COVERFLOW = {
    rotate: 20,               // 脇の札の傾き(度)。大きいほど ±2 が細く見える
    stretch: 48,              // 札同士を中央へ寄せる量(px。正で寄る)。5枚を枠内に収めるため
    depth: 220,               // 奥行き(px)。perspective は Swiper 既定の 1200px(.swiper-3d)
    modifier: 1,
    scale: 0.86,              // 1枚離れるごとの縮小(0.86 → ±2 は 0.72)
    slideShadows: true        // 脇の札に暗色の板(Swiper の gradient 板。filter は使わない、§7-4)
  };
  // 端のゴム(resistance)は Swiper 既定(resistanceRatio 0.85)のまま(§7-3)。
  // フリックで複数枚送る(§7-3)は Swiper の freeMode(momentum)+sticky(札の位置へ吸着)で作る。
  // 通常モードだと1回のスワイプで1枚しか進まないため。ゆっくり離せば最寄りの札へ吸着する。
  var FREE_MODE = { enabled: true, sticky: true, momentum: true, momentumRatio: 0.6, momentumVelocityRatio: 0.8, momentumBounce: true, momentumBounceRatio: 1 };

  // ---- 状態 ----
  var sel = 0;          // 止まっている札(決定に使う唯一の値)。初期選択は「続きから」(§2)
  var kind = "none";    // "ok" | "none" | "mismatch"
  var handlers = null;  // { onContinue, onNewGame } (js/main.js)
  var stageEl = null, noteEl = null, swEl = null;
  var sw = null;        // Swiper インスタンス
  var subEl = null;     // 開いている下位画面(図鑑/記録/設定)。null なら閉じている
  var busy = false;     // 遷移中(二重起動防止)
  // 押された事実(v40 §58)。タップも「決定」も、まずここに積んでから、カルーセルが止まった時点で解決する。
  var pending = null;       // { card: 押された札の番号(null は「中央の札」=決定ボタン/Enter), until: 打ち切りの時刻 }
  var pendingTimer = null;
  var restPos = null, restCount = 0;  // 「止まった」の判定用: 直前の描画位置と、それが続いた回数
  var keyBound = false;

  function reduced() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function saveKind() {
    var G = window.GameState;
    if (!G.hasSave()) return "none";
    return G.hasIncompatibleSave() ? "mismatch" : "ok";
  }
  function refreshNote() {
    noteEl.textContent = (CARDS[sel].id === "continue" && kind === "mismatch") ? MISMATCH_TEXT : "";
  }
  // Swiper のキーボード(←→)はメニューが前面で下位画面が閉じているときだけ効かせる。
  // Swiper の keyboard モジュールは document に付くので、他の画面(setup/loop)の裏で動かないよう自分で止める。
  function keysOn(on) {
    if (!sw || !sw.keyboard) return;
    if (on) sw.keyboard.enable(); else sw.keyboard.disable();
  }

  // ---- 決定(v40 §58) ----
  // 押された事実は、押した瞬間には解決しない。まず pending に積み、カルーセルが**止まってから**
  // 「押された札が中央かどうか」を見て、中央なら決定・中央でなければそこへ寄せる。
  //
  // §10 はこの判断を押した瞬間に sw.animating で分岐していた。それが実機で「設定札を押しても開かない」に
  // なった(v40 で再現。docs/v40_確認/)。理由は2つあり、どちらも animating に寄りかかったせい:
  //   (1) 右端のゴム戻りで animating が **true のまま降りなくなる**ことがある。降りないと §10 の経路では
  //       タップが永久に「寄せるだけ」になり、押し直しても決して開かない。
  //   (2) 降りた場合でも、ゴム戻りの最中に押された「すでに中央にある札」まで「移動」として消費されていた。
  // なので判定の土台を animating から**描画位置(getTranslate が動かなくなったこと)**へ移し、
  // 打ち切り(PENDING_MAX_MS)を必ず持たせて、決定待ちが宙に浮かないようにする。animating は一切見ない。
  function tapCard(i) { requestDecide(i); }
  // 「決定」ボタン・Enter は指の位置の情報が無いので、止まった時点で中央にある札を決める(card = null)。
  // §10 では移動中に何もしていなかった(sel が古い札を指すため)が、待ってから中央を読めば取りこぼさない。
  function decide() { requestDecide(null); }

  function requestDecide(card) {
    if (busy || subEl) return;
    if (card != null && (card < 0 || card >= CARDS.length)) return;
    pending = { card: card, until: Date.now() + PENDING_MAX_MS };
    if (pendingTimer) return;   // 見張りは1本だけ。連打ぶんは pending.card の上書きになる
    restPos = null; restCount = 0;
    pendingStep();
  }
  function cancelPending() {    // ドラッグし直した・画面を作り直した: 押された事実は古くなったので捨てる
    pending = null;
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
  }
  function pendingStep() {
    pendingTimer = null;
    if (!pending) return;
    if (busy || subEl || !sw) { pending = null; return; }
    var pos = null;
    try { pos = Math.round(sw.getTranslate()); } catch (e) { pos = null; }
    if (pos !== null && pos === restPos) restCount++; else restCount = 0;
    restPos = pos;
    // まだ動いている。ただし打ち切りの時刻を過ぎたら、動いていても下へ進む(待ち続けて無反応にしない)。
    if (restCount < REST_STABLE && Date.now() < pending.until) {
      pendingTimer = setTimeout(pendingStep, REST_POLL_MS);
      return;
    }
    var centre = centreIndex();
    var want = (pending.card == null) ? centre : pending.card;
    pending = null;
    // 押された札を指定し直す。同じ番号でも引き直す: 吸着中のカルーセルに触れると Swiper の translate と
    // activeIndex がずれることがあり(§57-4 の副産物)、指定し直すと位置が引き直されて直る。
    sw.slideTo(want);
    if (want !== centre) return;  // 押された札はまだ脇。中央へ寄せるだけ(v38-2 からの二段階のまま)
    decideCard(want);
  }
  // 中央の札は「実際に描かれている位置」から決める。Swiper の activeIndex は吸着中に描画とずれることが
  // あり(§57-4)、transitionEnd が来なければ sel も古いままなので、どちらも判定の基準にしない。
  function centreIndex() {
    if (!swEl) return sel;
    var box = swEl.getBoundingClientRect();
    if (!box.width) return sel;   // 画面が隠れている(幅0)ときは今の選択のまま
    var cx = box.left + box.width / 2;
    var nodes = swEl.querySelectorAll(".swiper-slide");
    var best = -1, bd = Infinity;
    for (var k = 0; k < nodes.length; k++) {
      var r = nodes[k].getBoundingClientRect();
      if (!r.width) continue;
      var d = Math.abs(r.left + r.width / 2 - cx);
      if (d < bd) { bd = d; best = parseInt(nodes[k].getAttribute("data-index"), 10); }
    }
    return best < 0 ? sel : best;
  }

  function decideCard(i) {
    if (busy || subEl) return;
    if (i == null || i < 0 || i >= CARDS.length) return;
    sel = i; refreshNote();   // 止まった位置に合わせて確定させる(transitionEnd が来ていなくても揃う)
    var id = CARDS[i].id;
    window.GameAudio.se("decide"); // v39: 決定(中央の札のタップ・「決定」・Enter)。脇の札のタップは移動なので鳴らさず、止まった時の slide に任せる
    if (id === "continue") {
      busy = true; keysOn(false);
      if (kind === "ok") handlers.onContinue(); else handlers.onNewGame();
    } else if (id === "opening") {
      playOpening();
    } else if (id === "compendium") {
      openSub("図鑑", [h("p", { text: "準備中" })]); // 中身は次バージョン(§5-4)
    } else if (id === "records") {
      openSub("記録", [h("p", { text: "準備中" })]); // 中身は次バージョン(§5-4)
    } else if (id === "settings") {
      openSettings();
    }
  }

  // 「オープニング」札: シネマティックを #screen-opening で頭から再生し、終端(またはスキップ)でメニューへ戻る。
  // renderCinematic() の描画先は #screen-opening 固定なので、画面の出し入れはこちらで面倒を見る。
  // 終端の白フラッシュは opening.js が onDone の後に root へ付け直して自分で外す(隠れた画面の上で消えるだけ)。
  function playOpening() {
    busy = true; keysOn(false);
    var opRoot = document.getElementById("screen-opening");
    window.UI.showScreen("opening");
    window.ScreenOpening.renderCinematic(function () {
      window.UI.clear(opRoot); // 丼など最後のカットの残骸を片付ける
      window.UI.showScreen("menu");
      window.GameAudio.bgm("title"); // v39: 再生(opening の曲)が終わったらメニューの曲へ戻す
      busy = false; keysOn(true);
      if (sw) sw.update(); // 非表示の間に寸法が変わっていても位置を取り直す
    });
  }

  // ---- 下位画面(図鑑/記録/設定) ----
  function openSub(title, bodyNodes) {
    if (subEl) return;
    var panel = h("div", { className: "menu-sub-panel" }, [
      h("div", { className: "menu-sub-title", text: title }),
      h("div", { className: "menu-sub-body" }, bodyNodes),
      h("button", { className: "menu-btn", text: "閉じる", onclick: closeSub })
    ]);
    subEl = h("div", { className: "menu-sub" }, [panel]);
    stageEl.appendChild(subEl);
    keysOn(false);
  }
  function closeSub() {
    if (!subEl) return;
    if (subEl.parentNode) subEl.parentNode.removeChild(subEl);
    subEl = null;
    keysOn(true);
  }
  // 設定: BGM と 効果音 のオン/オフ(v39 §4 で2系統に)。切替ボタンは本編UIの .btn(§5-2 の例外、§6-4/§7-5 で据え置き)。
  // 音量スライダーは将来ここに行を足す(js/audio.js 側は bgmVol/seVol の器だけ用意してある)。
  function openSettings() {
    var A = window.GameAudio;
    function row(label, isOn, setOn, onTurnedOn) {
      var btn = h("button", {
        className: "btn small",
        onclick: function () {
          setOn(!isOn());
          refresh();
          if (isOn() && onTurnedOn) onTurnedOn(); // オンにした瞬間に一度鳴らして確認できるように
        }
      });
      function refresh() {
        var on = isOn();
        btn.textContent = on ? "オン" : "オフ";
        btn.classList.toggle("primary", on);
      }
      refresh();
      return h("div", { className: "pixel-panel menu-settings-row" }, [h("span", { text: label }), btn]);
    }
    openSub("設定", [
      row("BGM", A.isBgmOn, A.setBgmOn, null),
      row("効果音", A.isSeOn, A.setSeOn, function () { A.se("decide"); }),
      // v39 §9-1: BGM は魔王魂(https://maou.audio/)。著作表記が利用条件なので、音源を積んでいる限り消さない。
      // 出典の詳細(曲名・元ファイル名・ライセンス)は docs/素材出典.md。
      h("div", { className: "menu-settings-credit", text: "音楽：魔王魂" })
    ]);
  }

  // ---- キーボード(Enter/Space=決定、Escape=閉じる。←→は Swiper の keyboard モジュール) ----
  // document に1回だけ付ける。メニュー画面が表示中(active)のときだけ効く。
  function onKey(e) {
    var screen = document.getElementById("screen-menu");
    if (!screen || !screen.classList.contains("active") || busy) return;
    if (subEl) { if (e.key === "Escape") { closeSub(); e.preventDefault(); } return; }
    if (e.key === "Enter" || e.key === " ") { decide(); e.preventDefault(); }
  }

  // ---- DOM ----
  function build(root) {
    stageEl = h("div", { className: "menu-stage menu-root" });
    var head = h("div", { className: "menu-head", text: "RAMEN DREAM" });
    // Swiper の器: .menu-swiper-clip(枠幅、overflow:hidden=枠の外へはみ出す札を切る、§7-3) > .swiper(幅=札1枚ぶん、中央) >
    // .swiper-wrapper > .swiper-slide。器を札1枚ぶんの幅にする理由: centeredSlides + slidesPerView:auto で器が枠幅だと
    // Swiper は最初の札の snap 位置を負(-(器幅-札幅)/2)に置き、左端付近で translate が正になる。freeMode(sticky)の
    // 吸着先の計算はその領域で符号が混ざり、右へゆっくり送っても隣へ戻ってしまう(実測: 図鑑→はじめから に行かない)。
    // 器の幅=札幅なら snap は 0 始まりで translate は常に 0 以下になり、正しく吸着する。ドラッグは札の上(子要素)から
    // 器へ泡立って来るので、器が細くても脇の札からのドラッグは効く。
    var slides = CARDS.map(function (c, i) {
      return h("div", { className: "swiper-slide menu-card", "data-index": String(i) }, [
        h("div", { className: "menu-card-pic" }, [window.AssetImage.node({ img: c.img, name: c.label, emoji: "" })]),
        h("div", { className: "menu-card-band", text: c.label })  // 札名はこの帯だけ(下の大きい文字は §7-4 で廃止)
      ]);
    });
    swEl = h("div", { className: "swiper menu-swiper" }, [h("div", { className: "swiper-wrapper" }, slides)]);
    var clipEl = h("div", { className: "menu-swiper-clip" }, [swEl]);
    noteEl = h("div", { className: "menu-note" });
    var prev = h("button", { className: "menu-arrow menu-prev", "aria-label": "前の札" });
    var next = h("button", { className: "menu-arrow menu-next", "aria-label": "次の札" });
    var nav = h("div", { className: "menu-nav" }, [
      prev,
      h("button", { className: "menu-btn menu-go", text: "決定", onclick: function () { decide(); } }),
      next
    ]);
    [head, clipEl, noteEl, nav].forEach(function (el) { stageEl.appendChild(el); });
    root.appendChild(stageEl);

    // Swiper 14 の freeMode(momentum)は wrapper の transitionend を {once:true} で待つ。ところが coverflow では
    // 札(と slideShadows の板)の transitionend が先に wrapper へ泡立って来て、その1回で待ち受けが消える
    // (target が違うので callback は呼ばれず、animating が true のまま止まり transitionEnd も来ない。
    // 実測: docs/完了/v38-2_確認/確認結果.md「§7 Swiper 版」)。子要素からの transitionend を wrapper の捕捉段階で
    // 止め、wrapper 自身の分だけを通す。slideTo(キー・矢印・脇の札タップ)の経路は once を使わないので元々問題ない。
    var wrapperEl = swEl.querySelector(".swiper-wrapper");
    wrapperEl.addEventListener("transitionend", function (e) { if (e.target !== wrapperEl) e.stopPropagation(); }, true);

    sw = new window.Swiper(swEl, {
      effect: "coverflow",
      coverflowEffect: COVERFLOW,
      centeredSlides: true,
      slidesPerView: "auto",
      loop: false,
      initialSlide: 0,
      speed: reduced() ? 0 : SPEED,
      freeMode: FREE_MODE,
      grabCursor: true,
      // 脇の札への移動も tapCard() で行う(§10-2)。Swiper 任せ(slideToClickedSlide)にすると、吸着中の
      // タップで進行中の慣性へ割り込む形になり、sticky の再吸着に上書きされて指の下でない札に着地する。
      slideToClickedSlide: false,
      keyboard: { enabled: true, onlyInViewport: true },
      navigation: { nextEl: next, prevEl: prev },
      on: {
        // 止まった瞬間に sel を確定し、札が変わっていれば効果音を1回(複数枚送っても最後の1回だけ。ドラッグ中・
        // 移動中は鳴らない、§7-3)。freeMode(momentum)の停止でも transitionEnd は来るので、slideChangeTransitionEnd
        // ではなくこちらで「前回止まった札と違うか」を見る(端から戻っただけなら鳴らない)。
        transitionEnd: function (s) {
          if (s.activeIndex === sel) return;
          sel = s.activeIndex;
          refreshNote();
          window.GameAudio.se("slide");
        },
        // タップ(Swiper が「ドラッグではない」と判定したもの)。押された札の番号をそのまま渡す(脇の札の移動もここ)。
        // clickedIndex は指の下の DOM から決まるので、吸着中でも「見えている札」と一致する。
        // 中央かどうかの判定・移動か決定かの選択は tapCard() 側で行う(§10-2)。
        click: function (s) {
          if (s.clickedIndex == null || s.clickedIndex < 0) return;
          tapCard(s.clickedIndex);
        },
        // 指を置いて動かし始めたら、待っている「押された事実」は古い(選び直している最中)ので捨てる。
        // タップ自体は touchStart → touchEnd → click の順なので、これで自分のタップを消すことはない。
        sliderMove: function () { cancelPending(); }
      }
    });
  }

  // ---- 入口 ----
  // opts.onContinue: 有効なセーブを読んで続きへ / opts.onNewGame: セーブを消して最初から(いずれも js/main.js)。
  function render(opts) {
    handlers = opts;
    var root = document.getElementById("screen-menu");
    if (sw) { sw.destroy(true, true); sw = null; }
    window.UI.clear(root);
    sel = 0; busy = false; subEl = null;
    cancelPending();
    kind = saveKind();
    CARDS[0].label = kind === "ok" ? "続きから" : "はじめから";
    build(root);
    refreshNote();
    if (!keyBound) { document.addEventListener("keydown", onKey); keyBound = true; }
  }

  return { render: render };
})();
