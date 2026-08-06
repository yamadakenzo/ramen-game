// 共通ユーティリティ
// v07-1-3: 1周の長さ(週数)を定数で持つ。数年に伸ばす可能性があるための下準備で、
// 今回はまだ実際には伸ばさない(値は52のまま)。
window.WEEKS_PER_RUN = 52;

window.Utils = (function () {
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function findById(list, id) { return list.find(function (x) { return x.id === id; }); }
  // 52週/12ヶ月をだいたい均等割り(4.33週/月)。
  // v06で発覚: weekToMonth が Math.floor、monthStartWeek が Math.round で別々の式だったため、
  // 1月→2月の境界(第5週)だけ「表示上は1月」なのに「月初課金の判定は2月スタート」という
  // 二重帰属が起きていた(月次まとめが1件分の家賃・給与・返済を取りこぼす形で顕在化した)。
  // 以後は weekToMonth を monthStartWeek から逆算する形にして、常に一致させる。
  function monthStartWeek(month) { return Math.round((month - 1) * 4.333) + 1; }
  function monthEndWeek(month) { return monthStartWeek(month + 1) - 1; }
  function weekToMonth(week) {
    week = clamp(week, 1, window.WEEKS_PER_RUN);
    for (var m = 12; m >= 1; m--) {
      if (week >= monthStartWeek(m)) return m;
    }
    return 1;
  }
  function weekOfMonth(week) {
    return week - monthStartWeek(weekToMonth(week)) + 1;
  }
  function isFirstWeekOfMonth(week) {
    return weekOfMonth(week) === 1;
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
  return { clamp: clamp, findById: findById, weekToMonth: weekToMonth, weekOfMonth: weekOfMonth,
    isFirstWeekOfMonth: isFirstWeekOfMonth, monthStartWeek: monthStartWeek, monthEndWeek: monthEndWeek,
    formatMoney: formatMoney, formatMoneyShort: formatMoneyShort,
    rand: rand, randInt: randInt, pick: pick };
})();
