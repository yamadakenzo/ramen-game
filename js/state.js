// ゲーム状態の定義とlocalStorage永続化
window.GameState = (function () {
  // v10 で時間の刻みが「1日単位」から「1時間単位+営業時間帯の選択」に変わり、
  // 営業時間の設定(businessHours)がstateに増えたため、旧セーブは読ませない。
  // キーごと変えているので、旧キーのデータが残っていても「続きから」に出てこない。
  var SAVE_KEY = "ramen_v10_save";
  // STEP1(docs/新設計/01_STEP1_新システム用データ基盤_修正版.md §1-2): 新システム用の器を
  // stateに追加したためバージョンを上げ、旧セーブは読ませない(移行処理は作らない・開発中のため)。
  // ただし今回から「バージョン不一致は無言で破棄しない」。main.jsのinit()がhasIncompatibleSave()で
  // 検出し、画面上で一言知らせてから始まる(このファイルのload()自体は今まで通り黙って失敗を返す)。
  // STEP4(docs/新設計/04_STEP4_ラーメン新パラメータとレシピ計算_修正版.md §9): レシピ素材の
  // 持ち方(oiliness廃止、quality/uniqueness/workload追加)が変わったため6→7に上げた。
  // 警告の仕組み自体はSTEP1で作り切っているので、ここでは変更しない。
  // STEP2(docs/新設計/02_STEP2_素材カード基本システム_修正版.md §8): 所持カード(ownedMaterials)
  // を持つようになったため7→8に上げた。
  // STEP5(docs/新設計/05_STEP5_従業員能力と育成_修正版.md §7): 従業員のstaffStateにlevel/
  // newStatBonusが増えたため8→9に上げた。
  // STEP6(docs/新設計/06_STEP6_従業員スカウト_修正版.md §9): スカウトで雇った従業員の定義
  // (scoutedStaff)を持つようになったため9→10に上げた。
  // STEP7(docs/新設計/07_STEP7_設備_修正版.md §8): 設備の週維持費・処理可能人数への読み替えで
  // 週の収支の内訳(stateの形自体は変わっていないが、historyに積む内容とお金の計算が変わった)が
  // 変わったため10→11に上げた。
  // STEP8(docs/新設計/08_STEP8_複数ラーメンとサイドメニュー_修正版.md §7): ラーメン2・3品目
  // (extraRamens)とサイドメニュー(sideMenu)を持つようになったため11→12に上げた。
  // STEP9(docs/新設計/09_STEP9_客層相性_注文_満足度_修正版.md §9): state自体の形は変えていないが、
  // 満足度・客数・売上の計算式(客がどのラーメンを選ぶか)が大きく変わったため12→13に上げた。
  // STEP10(docs/新設計/10_STEP10_広告_認知度_評判_修正版.md §9): state.awarenessが今回から
  // 実際に動く(それまでは初期値30のまま何にも使われない飾りだった)ようになり、週の客数の
  // 計算式自体が変わった(認知度の係数が新たに掛かる)ため13→14に上げた。あわせて
  // flags.meetingAttendCountは「商店街の寄合」自体が「宣伝をする」に読み替わり出番が無くなった
  // ため削除した(このバージョン以降のセーブには残らない)。
  // STEP11(docs/新設計/11_STEP11_経済バランス統合_修正版.md §9): stateの形は変えていないが、
  // 経済バランス(BASE_CUSTOMERS・認知度の係数・家賃・返済額・設備維持費)を大きく調整したため、
  // 旧セーブのまま続けると収支の前提が変わってしまう。14→15に上げた。
  // STEP12(docs/新設計/12_STEP12_周回引き継ぎ_修正版.md §9): freshState()のrelationships・
  // staffStateの初期値がjs/meta-state.jsを参照するようになった(形自体は変わっていない)ため
  // 15→16に上げた。なお引き継ぎデータ自体(ramen_metaキー)はSAVE_VERSIONとは別物で、この
  // バージョン変更・旧セーブの破棄では一切消えない(§4)。
  // STEP3(docs/新設計/03_STEP3_素材カード育成と分岐_修正版.md §9): state.materialCards
  // (所持カードごとのLv・分岐の記録)が増えたため16→17に上げた。
  var SAVE_VERSION = 17;

  // STEP12(docs/新設計/12_STEP12_周回引き継ぎ_修正版.md §1): 既存の従業員5人ぶんの
  // staffStateを、js/event-engine.jsのensureStaffState()が作るのと同じ形であらかじめ
  // 作っておく(relだけ前回終了時点の値で上書きする。他の欄を欠けさせるとensureStaffState()側の
  // 「無ければ作る」判定(state.staffState[id]が既にあると素通りする)を通ってしまい、
  // morale等が未定義のまま残ってしまうため)。
  function initialStaffState() {
    var ids = ["yuta", "misaki", "gonzo", "rin", "tetsu"];
    var out = {};
    ids.forEach(function (id) {
      var rel = window.MetaState ? window.MetaState.startingStaffRel(id) : 0;
      out[id] = {
        morale: 70, rel: rel, lowMoraleWeeks: 0,
        statBonus: { noodle: 0, prep: 0, service: 0, numbers: 0, teach: 0 },
        level: 1, newStatBonus: { cooking: 0, speed: 0, service: 0, development: 0 }
      };
    });
    return out;
  }

  // STEP3(docs/新設計/03_STEP3_素材カード育成と分岐_修正版.md §2): 初期所持8枚ぶんの
  // materialCards記録を作る({dupes:0, branch:null}、まだ重複を引いていないのでLv1)。
  function initialMaterialCards() {
    var owned = { soup: ["chicken", "pork"], tare: ["shoyu", "shio"], noodle: ["thin", "thick"], topping: ["chashu_thin", "nori"] };
    var out = { soup: {}, tare: {}, noodle: {}, topping: {} };
    Object.keys(owned).forEach(function (cat) {
      owned[cat].forEach(function (id) { out[cat][id] = { dupes: 0, branch: null }; });
    });
    return out;
  }

  function freshState() {
    return {
      version: SAVE_VERSION,
      phase: "opening", // opening -> setup -> loop -> result
      openingStep: 0,
      setupStep: 0, // 0 資金,1 物件,2 スープ,3 タレ,4 麺,5 具,6 設備,7 従業員
      funding: null,
      property: null,
      recipe: { soup: null, tare: null, noodle: null, topping: null }, // ラーメン1品目(既存のまま)
      // STEP8(docs/新設計/08_STEP8_複数ラーメンとサイドメニュー_修正版.md §1): ラーメン2・3品目。
      // 開発の合計が閾値を超えると解放され(枠自体は常に見える)、解放後にプレイヤーが
      // soup/tare/noodle/toppingを全部選ぶと「品」として数えられる(未設定の間はnull)。
      extraRamens: [null, null],
      // STEP8(§1): サイドメニューの選択中id配列(最大2)。開発の合計が閾値を超えると枠が解放される。
      sideMenu: [],
      // STEP2(docs/新設計/02_STEP2_素材カード基本システム_修正版.md §1): 開業時点で持っている
      // 素材カード(カテゴリごとの id 配列)。各カテゴリ性格が反対のもの2枚ずつ、計8枚が初期所持。
      // トッピングの「なし」(none)はカードとして扱わない(常に選択可能。ここには含めない)。
      // 「CARDS」という名前は既に window.DATA.characters.cards(麺屋の親父・記者など関係値カード)
      // で使われているため、別物と分かるよう ownedMaterials という名前にした。
      // 2026-08-11差し替え: トッピングを「チャーシュー・野菜マシ」から「チャーシュー・海苔」に
      // 変更した。野菜マシ(量+40)が初期にあると大盛り(量+60)を手に入れても量の上限がほとんど
      // 変わらず、大盛りが目標にならなかったため。野菜マシは未所持スタート(試作で入手する側)に
      // 回した。理由・数値の詳細はdocs/設計判断記録.md参照。
      ownedMaterials: {
        soup: ["chicken", "pork"],
        tare: ["shoyu", "shio"],
        noodle: ["thin", "thick"],
        topping: ["chashu_thin", "nori"]
      },
      // STEP3(docs/新設計/03_STEP3_素材カード育成と分岐_修正版.md §2): 所持カードごとのLv育成状況
      // (カテゴリ→id→{dupes, branch})。初期所持8枚ぶんもここで最初から記録しておく(試作で
      // 重複を引いたときに初めて記録を作るのではなく、「持っている全カード」が常にこの器に
      // 対応する形にする)。dupes=重複を引いた回数の累計、branch=Lv2で選んだ方向("a"/"b"、
      // 未選択はnull)。Lvそのものはここに保存せず、dupes・branchから毎回
      // js/scoring.jsのmaterialCardState()で計算する(値の二重管理を避けるため)。
      materialCards: initialMaterialCards(),
      // STEP1で新設した器(品質/濃さ/量/個性/原価/提供負荷)。STEP4(docs/新設計/
      // 04_STEP4_ラーメン新パラメータとレシピ計算_修正版.md)で計算式(js/scoring.jsの
      // recipeAggregate)側がこれと同じ基礎値(20/10/20/10/0/0)から実際に計算するようになった。
      // ただしこのフィールド自体(state.ramenStats)へ計算結果を書き戻す配線はまだ無く、
      // 今も値は既定値のまま動かない(recipeAggregate()はstateを介さず毎回その場で計算して返す)。
      ramenStats: { quality: 20, richness: 10, volume: 20, uniqueness: 10, cost: 0, workload: 0 },
      equipment: [],
      staffHired: [], // staff id 配列
      // STEP6(docs/新設計/06_STEP6_従業員スカウト_修正版.md §5): 「求人を出す」で雇った従業員の
      // 定義(id→{id,name,emoji,role,newStats,maxLevel,stats,wage})。既存5人はwindow.DATA.
      // characters.staffという静的データに定義があるが、スカウト勢はプレイごとに生成される
      // ため、静的データではなくここ(state)に持つ。参照はwindow.Scoring.findStaffDef(state,id)
      // に一本化してあり、既存5人とスカウト勢のどちらでも同じ呼び方で定義が引ける。
      scoutedStaff: {},
      scoutCounter: 0, // スカウトIDの発行カウンタ(採用時にのみ1増える)
      price: 850,
      money: 0,
      loan: { monthlyRepay: 0, monthsLeft: 0 },
      day: 1, // v09-3: 開業からの通算日数(1始まり)。月日・曜日は表示時にUtilsで逆算する
      clockMin: 11 * 60, // v10-2: 「今日」の中の時計(分、0始まり)。開店前は無く、開いている帯の頭から始まる
      businessHours: ["lunch", "night"], // v10-2: 選んでいる営業時間帯(次の週から反映)。初期値は昼+夜
      businessHoursActive: ["lunch", "night"], // 今週すでに反映されている帯(週の頭でbusinessHoursから複製)
      reputation: 50,
      // STEP1で器だけ作った認知度。評判(reputation、上の行)とは別物(docs/新設計/
      // 01_STEP1_新システム用データ基盤_修正版.md §2-3)。STEP10(docs/新設計/
      // 10_STEP10_広告_認知度_評判_修正版.md)からjs/scoring.jsの週の客数計算に実際に効くように
      // なり、js/screens/loop.jsのrunWeeklyCalcで毎週1.5%ずつ下がる(下限10)。
      awareness: 30,
      // STEP12(docs/新設計/12_STEP12_周回引き継ぎ_修正版.md §1): 「既存キャラ5人との関係値は、
      // 前回仲良くなった人は次も好意的に始まる」。js/meta-state.js(通常のセーブとは別キーで
      // 持つ、周回をまたいで残るデータ)から前回終了時点の値を引き継ぐ。MetaStateが無い環境
      // (このファイル単体を古い順で読み込んだ場合の保険)では従来どおり0からになる。
      relationships: window.MetaState ? window.MetaState.startingRelationships() : { menya: 0, reporter: 0, landlord: 0, oldman: 0, lender: 0 },
      // STEP12(§1): 従業員は「雇った人はリセット。既存5人は関係値だけ引き継ぐ」。育成状態
      // (士気・statBonus・Lv・newStatBonus)は毎回まっさらにし、rel(関係値)だけ前回終了時点の
      // 値を引き継ぐ(ensureStaffState()が後から埋める形と同じ完成形をここで先に作っておく)。
      staffState: initialStaffState(), // id -> {morale, rel, lowMoraleWeeks, statBonus, level, newStatBonus}
      cardsUnlocked: {}, // card id -> true (関係値要求を満たしイベント発生済み)
      cardsMet: {}, // card id -> true (関係値要求を満たした瞬間、イベント待ち)
      comboFired: {},
      firedEventIds: {}, // 一度きりイベントの発生済みフラグ
      recipeChangeLog: [], // 変更があった週番号のログ(直近1ヶ月分の判定用)
      flags: {
        regularLowWeeks: 0,
        recipeLockWeeksLeft: 0,
        weekFlashDetailed: true, // v06-2-1: 週の収支表示は詳細版が初期状態
        fatigue: 0,              // v07-3-3: 唯一の新規パラメータ。0〜100
        tasteBonus: 0,           // v07: 「スープの試作」の積み上げ(素材の質に加算)
        costDiscountPct: 0,      // v07: 「仕入れ先を回る」の積み上げ(原価に掛ける割引%)
        eventRecipesUnlocked: false // v07: 「他店を食べ歩く」で野菜スープ・辛味タレが解禁
        // STEP10: meetingAttendCountは「商店街の寄合に出る」が「宣伝をする」に読み替わったため削除。
      },
      history: [], // {week, month, customers, revenue, foodCost, rent, wage, loanRepay, profit, money, satisfaction, queueLevel}
      eventLog: [], // {week, id, title}
      pendingEvents: [], // このtickで表示すべきイベントのキュー
      currentEvent: null,
      speed: 1, // 0=停止,1,2,4。v09: 「進んでいるか」はこの値とpauseReasons(loop.js)から決まるので、
      // 別に running フラグは持たない(以前はweekEndActive中にspeedを0へ強制的に書き換えて流用していたが、
      // それだと「選んでいた速度」を覚えていられなかった。v09で廃止)。
      weekEndActive: false, // 週末シーケンス中(「次の週へ」を押すまでtrue)。UIの表示・安全な再開判定に使う
      gameOverReason: null
    };
  }

  var state = freshState();

  function save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("save failed", e);
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      var loaded = JSON.parse(raw);
      if (!loaded || loaded.version !== SAVE_VERSION) return false;
      state = loaded;
      return true;
    } catch (e) {
      console.warn("load failed", e);
      return false;
    }
  }

  function hasSave() {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch (e) {
      return false;
    }
  }

  // STEP1: 「セーブはあるがバージョンが合わない(=読めば破棄される)」ことを、実際にload()して
  // stateを壊す前に判定するための関数。main.jsのinit()がこれで判定し、無言で消す前に
  // 画面上で一言警告を出す(docs/新設計/01_STEP1_新システム用データ基盤_修正版.md §1-2)。
  function hasIncompatibleSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      var loaded = JSON.parse(raw);
      return !loaded || loaded.version !== SAVE_VERSION;
    } catch (e) {
      return true; // 壊れているデータも「今の形式と互換ではない」扱いにする
    }
  }

  function clearSave() {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch (e) { /* noop */ }
  }

  function reset() {
    state = freshState();
  }

  return {
    get: function () { return state; },
    save: save,
    load: load,
    hasSave: hasSave,
    hasIncompatibleSave: hasIncompatibleSave,
    clearSave: clearSave,
    reset: reset
  };
})();
