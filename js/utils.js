// 共通ユーティリティ
window.Utils = (function () {
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function findById(list, id) { return list.find(function (x) { return x.id === id; }); }
  function weekToMonth(week) {
    // 52週/12ヶ月をだいたい均等割り(4.33週/月)
    return clamp(Math.floor((week - 1) / 4.333) + 1, 1, 12);
  }
  function weekOfMonth(week) {
    var month = weekToMonth(week);
    var monthStartWeek = Math.round((month - 1) * 4.333) + 1;
    return week - monthStartWeek + 1;
  }
  function isFirstWeekOfMonth(week) {
    return weekOfMonth(week) === 1;
  }
  function monthStartWeek(month) { return Math.round((month - 1) * 4.333) + 1; }
  function monthEndWeek(month) { return monthStartWeek(month + 1) - 1; }
  function formatMoney(n) {
    return "¥" + Math.round(n).toLocaleString("ja-JP");
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
