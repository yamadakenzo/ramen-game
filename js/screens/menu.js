// v38-2: モードメニュー(docs/完了/v38-2_モードメニュー_指示書.md §5〜§7)。タイトル画面(js/screens/opening.js)と
// 本編(setup)の間に挟まる、state を持たない通過点。state.phase には "menu" を書かず、js/main.js が
// goToPhase("menu") で入るだけ。
//
// v45(docs/指示書/v45_メニュー画面の作り込み_指示書.md、設計判断記録 §64): この画面を作り込んだ。
//   - 札を5枚→**4枚**に(ゲームスタート/図鑑/記録/設定)。オープニングの再生は画面隅の小さいリンク(.menu-replay)へ戻した。
//   - **下段の矢印2つと「決定」ボタンを撤去**(§55-2 の判断を撤回。v40 で「押された札は必ずその札が開く」が
//     確立し、決定の受け皿が札そのものになったため)。代わりに現在地のドット(.menu-dots)と、
//     選ばれている札の説明1行(.menu-desc)を置いた。キーボードの ←→ / Enter は残す。
//   - 上部は暖簾(img/opening/noren_a.webp)＋DOMテキストのロゴ。暖簾は吊り棒を軸にゆっくり揺れる(CSS)。
//   - 画面の動き(雲・中央の札の浮き・押し込み・どんぶりちゃん)はすべて CSS。**浮きは札そのものではなく
//     .menu-card-inner に掛ける**(札=.swiper-slide には Swiper が毎フレーム transform を書くので取り合いになる)。
//   - 1枚目の札は「ゲームスタート」に統一し、押すと下位画面と同じパネルで「つづきから」/「はじめから」を選ぶ。
//     セーブを壊す「はじめから」には確認を1枚挟む(既定は「やめる」側)。
//
// 札のタップ(v40 §58): 押された事実は pending に積み、カルーセルが止まってから解決する。「止まった」は
// 描画位置(getTranslate)で見る。sw.animating は端のゴム戻りで true のまま降りないことがあり(v40 で実測)、
// §10 のようにそれで分岐すると「押しても開かない・押し直しても開かない」になる。詳細は decide 節のコメント。
// カルーセル(§7): Swiper.js(js/vendor/swiper/、同梱)の coverflow effect。指への追従・フリック・吸着・端のゴム・
// キーボード・脇の札タップはすべて Swiper に任せ、自前では書かない(§6 の rAF 駆動の自前実装は撤回。
// 毎フレーム filter: brightness() と z-index を書いていたのが滑らかにならない原因だった、§7-1)。
// 効果音は Swiper の transitionEnd(止まった瞬間)で、止まった札が前回と違うときだけ1回(js/audio.js)。
// このメニューが書くのは「止まっている札の番号」だけで、ゲーム側へ渡るのは決定した瞬間のそれ(handlers.onContinue /
// onNewGame)のみ。
// 配色は theme-a「はっきり」で確定(§7-4)。CSS 変数 --m-* は css/style.css の .menu-root 直下。
// 札の絵(v38-3): 各札の .menu-card-pic に AssetImage.node(def) の <img>(img/menu/*.webp、透過)。読み込みに失敗したら
// AssetImage が空のテキストノードに差し替えるので、v38-2 までの無地の面に戻るだけで札は崩れない。
// セーブの3状態(有効/無し/形式不一致)は GameState.hasSave()/hasIncompatibleSave() で決める
// (旧 js/main.js の showResumeChoice()/showVersionMismatchNotice() の役割を引き取った)。
window.ScreenMenu = (function () {
  var h = window.UI.h;

  // v38-3: img は img/ 配下の拡張子なしパス(js/asset-image.js の AssetImage.node と同じ流儀。?v=__BUILD__ はそちらが付ける)。
  // 絵は img/menu/*.webp(源PNGは docs/素材検討/menu/、共通枠で切って縁の白を透過、docs/完了/v38-3_確認/make_menu_webp.js)。
  // v45: desc は札の下に出す1行(§3-2)。**帯の名前の言い換えではなく「その札で何ができるか」**を書く。
  var CARDS = [
    { id: "start", label: "ゲームスタート", img: "menu/start", desc: "お店をはじめる・つづける" },
    { id: "compendium", label: "図鑑", img: "menu/book", desc: "集めた素材や人を見る（準備中）" },
    { id: "records", label: "記録", img: "menu/record", desc: "これまでのお店の成績（準備中）" },
    { id: "settings", label: "設定", img: "menu/settings", desc: "音の設定" }
  ];
  var MISMATCH_TEXT = "セーブデータの形式が変わったため、最初から始まります。"; // 旧 showVersionMismatchNotice() と同文
  var NO_SAVE_TEXT = "まだお店がありません";
  var CONFIRM_TEXT = "いまのお店のデータは消えます。よろしいですか？";
  // v45 §3-5: 「つづきから」の下に出す一言のためだけに、セーブの中身を**読むだけ**で覗く。
  // GameState.load() は state をまるごと差し替える(=副作用がある)ので呼べない。localStorage を
  // JSON.parse するだけならセーブにもゲーム側の state にも一切触れないので、こちらで読む。
  // キー名が js/state.js の SAVE_KEY と二重管理になるが、§0 の範囲(触ってよいのは menu.js / style.css /
  // main.js の分岐だけ)を守るためにこの形にした。state.js 側を変えるときはここも直すこと(§64)。
  var SAVE_KEY = "ramen_v10_save";

  // ---- Swiper の設定(§7-3)。実測値は docs/設計判断記録.md §55-9(v45 で4枚の値に取り直した) ----
  var SPEED = 400;            // 吸着・送りの時間(ms)。prefers-reduced-motion では 0(即切替、§7-3)
  // v40 §58: 押されたあと「止まった」と判定するまでの見張り。POLL ごとに描画位置を見て、STABLE 回続けて
  // 同じなら止まったとみなす。MAX を過ぎたら止まっていなくても解決する(決定待ちを宙に浮かせない)。
  var REST_POLL_MS = 40;
  var REST_STABLE = 2;
  var PENDING_MAX_MS = 2000;
  var COVERFLOW = {
    rotate: 20,               // 脇の札の傾き(度)。大きいほど ±2 が細く見える
    stretch: 48,              // 札同士を中央へ寄せる量(px。正で寄る)。枠内に収めるため
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
  var sel = 0;          // 止まっている札(決定に使う唯一の値)。初期選択は「ゲームスタート」(§2)
  var kind = "none";    // "ok" | "none" | "mismatch"
  var handlers = null;  // { onContinue, onNewGame } (js/main.js)
  var stageEl = null, swEl = null, descEl = null, donburiEl = null;
  var dotEls = [];
  var sw = null;        // Swiper インスタンス
  var subEl = null;     // 開いている下位画面(ゲームスタート/図鑑/記録/設定)。null なら閉じている
  var confirmEl = null; // 「はじめから」の確認。subEl の上にもう1枚重なる
  var busy = false;     // 遷移中(二重起動防止)
  // 押された事実(v40 §58)。タップも Enter も、まずここに積んでから、カルーセルが止まった時点で解決する。
  var pending = null;       // { card: 押された札の番号(null は「中央の札」=Enter), until: 打ち切りの時刻 }
  var pendingTimer = null;
  var restPos = null, restCount = 0;  // 「止まった」の判定用: 直前の描画位置と、それが続いた回数
  // v45: 「いま動いているか」の見張り。中央の札の浮き(CSS)は止まっているあいだだけ掛ける(§3-4-2)。
  // ここでも sw.animating は見ない(v40 と同じ理由)。描画位置が動かなくなったら止まったとみなす。
  var moveTimer = null, movePos = null, moveCount = 0;
  var happyTimer = null;
  var keyBound = false;

  function reduced() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function saveKind() {
    var G = window.GameState;
    if (!G.hasSave()) return "none";
    return G.hasIncompatibleSave() ? "mismatch" : "ok";
  }
  // セーブを**読むだけ**(load() は呼ばない)。返すのは生の JSON か null。
  function peekSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return (o && typeof o === "object") ? o : null;
    } catch (e) { return null; }
  }
  // 「つづきから」の下に出す一言。形式が合っているセーブのときだけ。読めない項目は黙って落とす。
  function saveSummary() {
    if (kind !== "ok") return null;
    var o = peekSave();
    if (!o) return null;
    var parts = [];
    if (typeof o.day === "number" && isFinite(o.day)) parts.push(o.day + "日目");
    if (typeof o.money === "number" && isFinite(o.money)) parts.push("所持金 " + window.Utils.formatMoney(o.money));
    return parts.length ? parts.join(" ・ ") : null;
  }
  // ドットと説明の1行を i 番の札に合わせる。送っている最中でも空にしない(行き先の文言に切り替わる、§3-2)。
  function refreshInfo(i) {
    if (i == null || i < 0 || i >= CARDS.length) return;
    for (var k = 0; k < dotEls.length; k++) dotEls[k].classList.toggle("is-on", k === i);
    if (descEl) descEl.textContent = CARDS[i].desc;
  }
  // Swiper のキーボード(←→)はメニューが前面で下位画面が閉じているときだけ効かせる。
  // Swiper の keyboard モジュールは document に付くので、他の画面(setup/loop)の裏で動かないよう自分で止める。
  function keysOn(on) {
    if (!sw || !sw.keyboard) return;
    if (on) sw.keyboard.enable(); else sw.keyboard.disable();
  }

  // ---- 「動いている / 止まっている」(v45 §3-4-2) ----
  // .menu-swiper に is-moving を付け外しするだけ。浮きの CSS は :not(.is-moving) で受ける。
  function markMoving() {
    if (!swEl) return;
    swEl.classList.add("is-moving");
    if (moveTimer) return;    // 見張りは1本だけ
    movePos = null; moveCount = 0;
    moveTimer = setTimeout(moveStep, 80);
  }
  function moveStep() {
    moveTimer = null;
    if (!sw || !swEl) return;
    var pos = null;
    try { pos = Math.round(sw.getTranslate()); } catch (e) { pos = null; }
    if (pos !== null && pos === movePos) moveCount++; else moveCount = 0;
    movePos = pos;
    if (moveCount >= 2) { swEl.classList.remove("is-moving"); return; }
    moveTimer = setTimeout(moveStep, 80);
  }
  function stopMoveWatch() {
    if (moveTimer) { clearTimeout(moveTimer); moveTimer = null; }
  }

  // ---- 押した手応え(v45 §3-4-3) ----
  // 押された札の**中の要素**を一度沈ませて跳ねさせる。決定の処理そのものは何も変えない。
  function pressCard(i) {
    if (!swEl) return;
    var slide = swEl.querySelector('.swiper-slide[data-index="' + i + '"]');
    var inner = slide && slide.querySelector(".menu-card-inner");
    if (!inner) return;
    inner.classList.remove("is-pressed");
    void inner.offsetWidth;   // アニメを頭から掛け直す(連打しても毎回沈む)
    inner.classList.add("is-pressed");
  }
  // 決定の瞬間だけ happy の絵にして跳ねる(v45 §3-4-4)。3枚は共通枠なので重ねたまま class を替えるだけ。
  function donburiHappy() {
    if (!donburiEl) return;
    donburiEl.classList.remove("is-happy");
    void donburiEl.offsetWidth;
    donburiEl.classList.add("is-happy");
    if (happyTimer) clearTimeout(happyTimer);
    happyTimer = setTimeout(function () {
      happyTimer = null;
      if (donburiEl) donburiEl.classList.remove("is-happy");
    }, 900);
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
  function tapCard(i) { pressCard(i); requestDecide(i); }
  // Enter は指の位置の情報が無いので、止まった時点で中央にある札を決める(card = null)。
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
    sel = i; refreshInfo(sel);   // 止まった位置に合わせて確定させる(transitionEnd が来ていなくても揃う)
    var id = CARDS[i].id;
    window.GameAudio.se("decide"); // v39: 決定(中央の札のタップ・Enter)。脇の札のタップは移動なので鳴らさず、止まった時の slide に任せる
    donburiHappy();
    if (id === "start") {
      openStart();
    } else if (id === "compendium") {
      openSub("図鑑", [h("p", { text: "準備中" })]); // 中身は次バージョン(§5-4)
    } else if (id === "records") {
      openSub("記録", [h("p", { text: "準備中" })]); // 中身は次バージョン(§5-4)
    } else if (id === "settings") {
      openSettings();
    }
  }

  // 隅の「オープニングをもう一度見る」(v45 §3-1。v38-1 の .op-replay と同じ役割・同じ控えめさ):
  // シネマティックを #screen-opening で頭から再生し、終端(またはスキップ)でメニューへ戻る。
  // renderCinematic() の描画先は #screen-opening 固定なので、画面の出し入れはこちらで面倒を見る。
  // 終端の白フラッシュは opening.js が onDone の後に root へ付け直して自分で外す(隠れた画面の上で消えるだけ)。
  function playOpening() {
    if (busy || subEl) return;
    window.GameAudio.se("decide");
    busy = true; keysOn(false);
    cancelPending();
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

  // ---- 下位画面(ゲームスタート/図鑑/記録/設定) ----
  // v45: パネルの外(暗幕)のタップでも閉じられるようにした(Escape と同じ作法、§3-5)。
  function openSub(title, bodyNodes) {
    if (subEl) return;
    var panel = h("div", { className: "menu-sub-panel" }, [
      h("div", { className: "menu-sub-title", text: title }),
      h("div", { className: "menu-sub-body" }, bodyNodes),
      h("button", { className: "menu-btn", text: "閉じる", onclick: closeSub })
    ]);
    subEl = h("div", {
      className: "menu-sub",
      onclick: function (e) { if (e.target === subEl) closeSub(); }
    }, [panel]);
    stageEl.appendChild(subEl);
    keysOn(false);
  }
  function closeSub() {
    closeConfirm();
    if (!subEl) return;
    if (subEl.parentNode) subEl.parentNode.removeChild(subEl);
    subEl = null;
    keysOn(true);
  }

  // ---- 確認(v45 §3-5): セーブを消す「はじめから」の前に1枚挟む ----
  // 既定側(押しやすい側=右)に「やめる」を置き、目立つ配色もそちらに与える。
  // 「はじめる」は左・控えめな見た目。誤って押しても取り返しがつく形にするのが目的。
  function openConfirm(onYes) {
    if (confirmEl) return;
    var panel = h("div", { className: "menu-confirm-panel" }, [
      h("div", { className: "menu-confirm-text", text: CONFIRM_TEXT }),
      h("div", { className: "menu-confirm-btns" }, [
        h("button", { className: "menu-btn menu-btn-quiet menu-confirm-yes", text: "はじめる", onclick: function () { closeConfirm(); onYes(); } }),
        h("button", { className: "menu-btn menu-confirm-no", text: "やめる", onclick: closeConfirm })
      ])
    ]);
    confirmEl = h("div", {
      className: "menu-confirm",
      onclick: function (e) { if (e.target === confirmEl) closeConfirm(); }
    }, [panel]);
    stageEl.appendChild(confirmEl);
  }
  function closeConfirm() {
    if (!confirmEl) return;
    if (confirmEl.parentNode) confirmEl.parentNode.removeChild(confirmEl);
    confirmEl = null;
  }

  // ---- 「ゲームスタート」札のパネル(v45 §3-5) ----
  // 札の名前はセーブの有無で変えない。「つづきから」/「はじめから」はここで選ぶ。
  //   有効なセーブあり … つづきから: 押せる(下に何日目・所持金) / はじめから: 押せる、確認あり
  //   セーブ無し       … つづきから: 押せない見た目+「まだお店がありません」 / はじめから: 確認なしでそのまま
  //   形式不一致       … つづきから: 押せない見た目+不一致メッセージ / はじめから: 押せる、確認あり
  function openStart() {
    var canContinue = (kind === "ok");
    var note = canContinue ? saveSummary() : (kind === "mismatch" ? MISMATCH_TEXT : NO_SAVE_TEXT);
    var contBtn = h("button", {
      className: "menu-btn menu-start-btn" + (canContinue ? "" : " is-off"),
      text: "つづきから",
      disabled: canContinue ? null : "disabled",
      onclick: canContinue ? function () { runStart(handlers.onContinue); } : null
    });
    var newBtn = h("button", {
      className: "menu-btn menu-start-btn",
      text: "はじめから",
      onclick: function () {
        // セーブが無いときだけ確認を挟まない(消えるものが無いため)。
        if (kind === "none") { runStart(handlers.onNewGame); return; }
        openConfirm(function () { runStart(handlers.onNewGame); });
      }
    });
    openSub("ゲームスタート", [
      h("div", { className: "menu-start-block" }, [
        contBtn,
        note ? h("div", { className: "menu-start-note" + (canContinue ? "" : " is-warn"), text: note }) : null
      ]),
      h("div", { className: "menu-start-block" }, [newBtn])
    ]);
  }
  // ゲーム側へ渡す(js/main.js の onContinue / onNewGame)。渡す前にパネルを畳んで入力を締める。
  function runStart(fn) {
    if (busy) return;
    closeSub();
    busy = true; keysOn(false);
    fn();
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
    if (confirmEl) { if (e.key === "Escape") { closeConfirm(); e.preventDefault(); } return; }
    if (subEl) { if (e.key === "Escape") { closeSub(); e.preventDefault(); } return; }
    if (e.key === "Enter" || e.key === " ") { decide(); e.preventDefault(); }
  }

  // ---- DOM ----
  // v45: 背景の雲 → 暖簾+ロゴ → カルーセル → ドット → 説明 → どんぶりちゃん → 隅のリンク の順に積む。
  // 雲を先頭に置くのは、z-index を書かずに「札より奥」を作るため(重なりは DOM 順で決まる)。
  function build(root) {
    stageEl = h("div", { className: "menu-stage menu-root" });

    // 雲(§3-4-1)。絵は CSS の図形(円の重なり)。--w/--t/--d/--delay で1つずつ違う見え方にする。
    var sky = h("div", { className: "menu-sky" }, [
      cloud("0.34", "9%", "42s", "-6s"),
      cloud("0.22", "26%", "58s", "-30s"),
      cloud("0.30", "80%", "50s", "-44s")   // 3つ目は札より下の空いている帯へ(下半分が空っぽに見えないように)
    ]);

    // 暖簾+ロゴ(§3-3)。ロゴは DOM テキスト(生成画像に文字を入れない、§54-8)。
    // 揺れは .menu-noren に掛ける(ロゴも子なので一緒に揺れる)。吊り棒の位置が回転の軸。
    var noren = h("div", { className: "menu-noren" }, [
      window.AssetImage.node({ img: "opening/noren_a", name: "暖簾", emoji: "" }),
      h("div", { className: "menu-logo", text: "RAMEN DREAM" })
    ]);
    var head = h("div", { className: "menu-head" }, [noren]);

    // Swiper の器: .menu-swiper-clip(枠幅、overflow:hidden=枠の外へはみ出す札を切る、§7-3) > .swiper(幅=札1枚ぶん、中央) >
    // .swiper-wrapper > .swiper-slide。器を札1枚ぶんの幅にする理由: centeredSlides + slidesPerView:auto で器が枠幅だと
    // Swiper は最初の札の snap 位置を負(-(器幅-札幅)/2)に置き、左端付近で translate が正になる。freeMode(sticky)の
    // 吸着先の計算はその領域で符号が混ざり、右へゆっくり送っても隣へ戻ってしまう(実測: 図鑑→ゲームスタート に行かない)。
    // 器の幅=札幅なら snap は 0 始まりで translate は常に 0 以下になり、正しく吸着する。ドラッグは札の上(子要素)から
    // 器へ泡立って来るので、器が細くても脇の札からのドラッグは効く。
    //
    // v45: 札の中身を .menu-card-inner で1枚くるんだ。**浮き(§3-4-2)と押し込み(§3-4-3)はこの中の要素に掛ける。**
    // 札そのもの(.swiper-slide)には Swiper が coverflow の transform を毎フレーム書き込むので、そこへ
    // アニメーションを重ねると取り合いになって位置が壊れる。面・枠・影も inner 側へ移した(浮くのは絵の面ごと)。
    var slides = CARDS.map(function (c, i) {
      var inner = h("div", { className: "menu-card-inner" }, [
        h("div", { className: "menu-card-pic" }, [window.AssetImage.node({ img: c.img, name: c.label, emoji: "" })]),
        h("div", { className: "menu-card-band", text: c.label })  // 札名はこの帯だけ(下の大きい文字は §7-4 で廃止)
      ]);
      // 沈んで跳ねるアニメが終わったら class を落とす(次に押したときまた頭から掛かるように)
      inner.addEventListener("animationend", function (e) {
        if (e.animationName === "menuCardPress") inner.classList.remove("is-pressed");
      });
      return h("div", { className: "swiper-slide menu-card", "data-index": String(i) }, [inner]);
    });
    swEl = h("div", { className: "swiper menu-swiper" }, [h("div", { className: "swiper-wrapper" }, slides)]);
    var clipEl = h("div", { className: "menu-swiper-clip" }, [swEl]);

    // 現在地のドット(§3-2)。押せない飾りなので button ではなく div、pointer-events も切ってある。
    dotEls = CARDS.map(function () { return h("div", { className: "menu-dot" }); });
    var dots = h("div", { className: "menu-dots", "aria-hidden": "true" }, dotEls);
    // 選ばれている札の説明1行。中央の札が変わるたびに差し替わる(空にはしない)。
    descEl = h("div", { className: "menu-desc" });

    // どんぶりちゃん(§3-4-4)。3表情は共通枠で切ってあるので重ねたまま opacity を切り替えるだけ(§63-3)。
    // 置き場所は右下の隅。札・ドット・説明のどれにも重ならない位置に CSS で固定する。
    donburiEl = h("div", { className: "menu-donburi", "aria-hidden": "true" }, [
      h("div", { className: "menu-donburi-face is-normal" }, [window.AssetImage.node({ img: "char/donburi-normal", name: "どんぶりちゃん", emoji: "" })]),
      h("div", { className: "menu-donburi-face is-happy" }, [window.AssetImage.node({ img: "char/donburi-happy", name: "どんぶりちゃん", emoji: "" })])
    ]);

    // 隅のオープニング再生リンク(§3-1)。札から降ろした先。控えめな文字リンク1本。
    var replay = h("button", { className: "menu-replay", text: "オープニングをもう一度見る", onclick: playOpening });

    [sky, head, clipEl, dots, descEl, donburiEl, replay].forEach(function (el) { stageEl.appendChild(el); });
    root.appendChild(stageEl);

    // Swiper 14 の freeMode(momentum)は wrapper の transitionend を {once:true} で待つ。ところが coverflow では
    // 札(と slideShadows の板)の transitionend が先に wrapper へ泡立って来て、その1回で待ち受けが消える
    // (target が違うので callback は呼ばれず、animating が true のまま止まり transitionEnd も来ない。
    // 実測: docs/完了/v38-2_確認/確認結果.md「§7 Swiper 版」)。子要素からの transitionend を wrapper の捕捉段階で
    // 止め、wrapper 自身の分だけを通す。slideTo(キー・脇の札タップ)の経路は once を使わないので元々問題ない。
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
      // v45: navigation(矢印)は撤去した(§3-2)。
      on: {
        // 止まった瞬間に sel を確定し、札が変わっていれば効果音を1回(複数枚送っても最後の1回だけ。ドラッグ中・
        // 移動中は鳴らない、§7-3)。freeMode(momentum)の停止でも transitionEnd は来るので、slideChangeTransitionEnd
        // ではなくこちらで「前回止まった札と違うか」を見る(端から戻っただけなら鳴らない)。
        transitionEnd: function (s) {
          refreshInfo(s.activeIndex);
          if (s.activeIndex === sel) return;
          sel = s.activeIndex;
          window.GameAudio.se("slide");
        },
        // v45: 送っている最中でもドットと説明を行き先に合わせる(空白にしない、§3-2)。
        slideChange: function (s) { refreshInfo(s.activeIndex); },
        // v45: 動いているあいだは中央の札を浮かせない(§3-4-2)。setTranslate はドラッグ・慣性・吸着の
        // どの経路でも来るので、ここを入口にすれば取りこぼさない。降ろすのは描画位置が止まってから。
        setTranslate: markMoving,
        touchStart: markMoving,
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
  // 雲1つ(§3-4-1)。幅はフレーム幅に対する比、t は上からの位置、d は横切るのに掛かる時間、
  // delay は負の値にして「もう流れている途中」から始める(読み込み直後に一斉に左端から出ない)。
  // style は**文字列**で渡す(UI.h はオブジェクトを Object.assign(el.style, ...) するが、
  // CSS カスタムプロパティは style オブジェクトの代入では入らないため)。
  function cloud(w, t, d, delay) {
    return h("div", {
      className: "menu-cloud",
      style: "--cw:" + w + ";--ct:" + t + ";--cd:" + d + ";animation-delay:" + delay + ";"
    });
  }

  // ---- 入口 ----
  // opts.onContinue: 有効なセーブを読んで続きへ / opts.onNewGame: セーブを消して最初から(いずれも js/main.js)。
  function render(opts) {
    handlers = opts;
    var root = document.getElementById("screen-menu");
    if (sw) { sw.destroy(true, true); sw = null; }
    window.UI.clear(root);
    sel = 0; busy = false; subEl = null; confirmEl = null;
    dotEls = []; descEl = null; donburiEl = null;
    cancelPending();
    stopMoveWatch();
    if (happyTimer) { clearTimeout(happyTimer); happyTimer = null; }
    kind = saveKind();
    build(root);
    refreshInfo(sel);
    if (!keyBound) { document.addEventListener("keydown", onKey); keyBound = true; }
  }

  return { render: render };
})();
