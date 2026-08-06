// 共通ユーティリティ
// v07-1-3: 1周の長さ(週数)を定数で持つ。数年に伸ばす可能性があるための下準備で、
// 今回はまだ実際には伸ばさない(値は52のまま)。
window.WEEKS_PER_RUN = 52;
// v09-3: 内部で持つ時間の単位は「開業からの通算日数」だけ。52週 × 7日 = 364日。
window.DAYS_PER_RUN = window.WEEKS_PER_RUN * 7;

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
  return {
    clamp: clamp, findById: findById,
    calMonth: calMonth, dayOfMonth: dayOfMonth, weekOfRun: weekOfRun, monthSeq: monthSeq, monthSeqToCal: monthSeqToCal,
    monthSeqStartDay: monthSeqStartDay, monthSeqEndDay: monthSeqEndDay, monthJustChanged: monthJustChanged,
    formatMoney: formatMoney, formatMoneyShort: formatMoneyShort,
    rand: rand, randInt: randInt, pick: pick
  };
})();
