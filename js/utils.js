// 共通ユーティリティ
// v07-1-3: 1周の長さ(週数)を定数で持つ。数年に伸ばす可能性があるための下準備で、
// 今回はまだ実際には伸ばさない(値は52のまま)。
window.WEEKS_PER_RUN = 52;
// v09-3: 内部で持つ時間の単位は「開業からの通算日数」だけ。52週 × 7日 = 364日。
window.DAYS_PER_RUN = window.WEEKS_PER_RUN * 7;
// v12-1: 「1時間の実秒(×1)」をここ1箇所だけに持つ。速度の実秒(loop.js)も、客・店員の
// アニメーションの尺(shop-view.js)も、どちらもこの値からしか実msを作らない
// (実秒の直値をコードの他の場所に書かないための唯一の物差し)。
window.BASE_HOUR_MS = 1700; // ×1 = 1時間1.7秒

// STEP1(docs/新設計/01_STEP1_新システム用データ基盤_修正版.md §2-5): scoring.js内に直接
// 書かれていたバランス定数を、既存のBASE_HOUR_MS/WEEKS_PER_RUNと同じ場所(このファイル)へ集約した。
// 値は変えていない(置き場所を変えただけ)。
// 週あたりの理論最大客数の目安(1客層1週間の潜在客数)。噛み合えば繁盛、外せば閑古鳥になるよう調整。
// STEP11(docs/新設計/11_STEP11_経済バランス統合_修正版.md §3): 経済バランス統合で24→30に
// 上げた。損益分岐点(週150〜230人前後)に対し、認知度・評判を育てても客数の絶対量が
// 全く足りていなかったため(詳細はdocs/設計判断記録.md参照)。
window.BASE_CUSTOMERS = 30;
// 席1つが1週間に捌ける杯数の目安(1日6〜7杯転回 x 7日)
window.SEATS_TO_WEEKLY_CAPACITY = 45;
// 麺量アップ(茹で麺器の増設)はレシピではなく設備なので、state を渡された時だけ上乗せする
window.EXTRA_BOILER_VOLUME = 15;

// STEP6(docs/新設計/06_STEP6_従業員スカウト_修正版.md §4): 「現行の上限をそのまま使う。
// 新しい上限の仕組みを作らないこと」。従業員の雇用上限は、これまでjs/screens/setup.jsの
// stepStaff()内にだけ2という数値で埋め込まれていた(物件ごとの枠は実装されていない)。
// スカウトの上限チェックでも同じ値を参照する必要が生じたため、ここへ定数として括り出した。
// 値そのものは変えていない。
window.MAX_STAFF = 2;

window.Utils = (function () {
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function findById(list, id) { return list.find(function (x) { return x.id === id; }); }

  // v09-3: 日付計算をゼロから作り直した。
  // 「2/35」のような存在しない日付が出ていたのは、旧実装(週→月を4.333週/月で近似)の産物。
  // 新実装は開業日を4月1日固定(うるう年なし・平年固定)とし、実際の月の日数テーブルを
  // 4月始まりで持つ。内部の唯一の時計は「通算日数」(state.day, 1始まり)で、月日は
  // 表示するたびにこのテーブルを引いて逆算する(値を保存はしない)。
  // seq: 開業からの通し月番号(1=開業月=4月, 2=5月, ... 12=翌3月)。イベントの「N ヶ月目」といった
  //      相対的な間隔判定はこちらを使う(実カレンダー月と無関係に、開業からの経過だけで決めたいもの)。
  // cal: 実際のカレンダー月(1〜12)。「表示上の月」「季節(夏=7月、長期休暇=2月・8月など)」の
  //      判定はこちらを使う(v09指示: 季節の判定は表示上の月で行う)。
  var MONTHS = [
    { cal: 4, len: 30 }, { cal: 5, len: 31 }, { cal: 6, len: 30 }, { cal: 7, len: 31 },
    { cal: 8, len: 31 }, { cal: 9, len: 30 }, { cal: 10, len: 31 }, { cal: 11, len: 30 },
    { cal: 12, len: 31 }, { cal: 1, len: 31 }, { cal: 2, len: 28 }, { cal: 3, len: 31 }
  ];

  function dateInfo(day) {
    day = clamp(Math.round(day), 1, window.DAYS_PER_RUN);
    var rest = day;
    for (var i = 0; i < MONTHS.length; i++) {
      if (rest <= MONTHS[i].len) return { seq: i + 1, cal: MONTHS[i].cal, dom: rest };
      rest -= MONTHS[i].len;
    }
    var last = MONTHS[MONTHS.length - 1];
    return { seq: MONTHS.length, cal: last.cal, dom: last.len };
  }

  function calMonth(day) { return dateInfo(day).cal; }        // 表示上の月(1〜12)。季節判定用
  function dayOfMonth(day) { return dateInfo(day).dom; }       // 月の中の日(1〜31)
  function monthSeq(day) { return dateInfo(day).seq; }         // 開業からの通し月番号(1〜12, 1=開業月)
  // 通し月番号(seq) -> 実カレンダー月(cal)。集計(historyの月別まとめ)はwraparoundの無いseqで
  // キー付けしておき、見出しなど表示するときだけこれで実際の月名に戻す。
  function monthSeqToCal(seq) {
    var i = clamp(Math.round(seq), 1, MONTHS.length) - 1;
    return MONTHS[i].cal;
  }
  // 通算週番号(1〜52)。表示・ログ・「N週間以内」のような相対判定に使う。
  // 週の区切りは通算日数の7日ごと(月の区切りとは無関係。月をまたぐ週があってよい)。
  function weekOfRun(day) { return clamp(Math.ceil(day / 7), 1, window.WEEKS_PER_RUN); }

  // seq番目の月(開業月=1)の開始日/終了日。「開業からNヶ月目の間のどこか」を選びたいイベントの
  // 抽選窓に使う(実カレンダー月とは独立。開業日が変わっても相対的な間隔は保たれる)。
  function monthSeqStartDay(seq) {
    var d = 1;
    for (var i = 0; i < seq - 1 && i < MONTHS.length; i++) d += MONTHS[i].len;
    return d;
  }
  function monthSeqEndDay(seq) { return monthSeqStartDay(seq + 1) - 1; }

  // この週末(day)で、表示上の月が直前の週から変わったか。月次の請求・まとめ表示のトリガーに使う。
  // 最初の週(day<=7)は「開業月(4月)の初回」として必ずtrueを返す(月の日数はどれも7日より長いので、
  // 1週間の中で月境界が2回またぐことは無い=判定はこれで十分)。
  function monthJustChanged(day) {
    if (day <= 7) return true;
    return calMonth(day) !== calMonth(day - 7);
  }

  // v10-2: 営業時間の帯定義。開業日(day1)を月曜日固定とする(現実のカレンダーとの対応は無い、
  // ゲーム内だけの取り決め)。dow: 0=月,1=火,2=水,3=木,4=金,5=土,6=日。
  var DOW_LABEL = ["月", "火", "水", "木", "金", "土", "日"];
  function dow(day) { return (Math.round(day) - 1) % 7; }
  function isWeekend(day) { var d = dow(day); return d === 5 || d === 6; }
  function dowLabel(day) { return DOW_LABEL[dow(day)]; }

  // 帯は常にこの4つ。start/endは時(24時制、深夜だけ26時まで延長表記=実質翌1〜2時)。
  window.BANDS = [
    { key: "lunch", label: "昼", start: 11, end: 14 },
    { key: "dinner", label: "夕", start: 17, end: 20 },
    { key: "night", label: "夜", start: 20, end: 23 },
    { key: "latenight", label: "深夜", start: 23, end: 26 }
  ];
  // 「2帯(昼+夜)開けた状態」を現状の数値の基準とする(v10指示2-5)
  window.BASE_HOUR_BANDS = ["lunch", "night"];

  // BANDSの要素は id ではなく key を識別子に持つので、findById(id前提)は使えない。
  function bandDef(key) { return window.BANDS.find(function (b) { return b.key === key; }); }
  function timeLabel(min) {
    min = Math.max(0, Math.round(min));
    var h = Math.floor(min / 60), m = min % 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }
  var BAND_EMOJI = { lunch: "🌞", dinner: "🌇", night: "🌙", latenight: "🌃" };
  function bandEmoji(key) { return BAND_EMOJI[key] || "🕐"; }
  // 帯の時刻表示。終了が24時を超える(深夜)場合は「翌N:00」にする。setup/loopの両方で使う共通表記。
  function bandTimeLabel(b) {
    var endLabel = b.end > 24 ? ("翌" + (b.end - 24) + ":00") : (b.end + ":00");
    return b.start + ":00〜" + endLabel;
  }

  function formatMoney(n) {
    // Math.round(n)+0 で -0 を +0 に正規化する(そのままだと "¥-0" のように表示が崩れる箇所があった)
    return "¥" + (Math.round(n) + 0).toLocaleString("ja-JP");
  }
  function formatMoneyShort(n) {
    var v = Math.round(n);
    if (Math.abs(v) >= 10000) return (v / 10000).toFixed(1) + "万円";
    return v + "円";
  }
  function rand(min, max) { return min + Math.random() * (max - min); }
  function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
  function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

  // v12-1: 速度倍率(1,2,4...)から「1時間の実ms」を作る唯一の関数。速度0(停止)はnull。
  // BASE_HOUR_MSを変えるだけで×1〜×4のすべてが追随する(loop.jsは倍率テーブルを持たない)。
  function hourMs(speedMult) {
    if (!speedMult) return null;
    return window.BASE_HOUR_MS / speedMult;
  }
  // v12-1: 「ゲーム内でN分」を実ms(速度×1基準)に変換する。歩行・食事などのアニメーション尺は
  // すべてこれで作る(実秒の直値を書かない)。呼び出し側(later()等)がさらに速度で割る。
  function gameMinMs(min) {
    return min * (window.BASE_HOUR_MS / 60);
  }

  return {
    clamp: clamp, findById: findById,
    calMonth: calMonth, dayOfMonth: dayOfMonth, weekOfRun: weekOfRun, monthSeq: monthSeq, monthSeqToCal: monthSeqToCal,
    monthSeqStartDay: monthSeqStartDay, monthSeqEndDay: monthSeqEndDay, monthJustChanged: monthJustChanged,
    dow: dow, isWeekend: isWeekend, dowLabel: dowLabel, bandDef: bandDef, timeLabel: timeLabel,
    bandEmoji: bandEmoji, bandTimeLabel: bandTimeLabel,
    formatMoney: formatMoney, formatMoneyShort: formatMoneyShort,
    rand: rand, randInt: randInt, pick: pick,
    hourMs: hourMs, gameMinMs: gameMinMs
  };
})();
