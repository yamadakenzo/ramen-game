// DOM生成・画面切り替え・トースト・モーダルの共通ヘルパー
window.UI = (function () {
  function h(tag, props, children) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      if (props[k] == null) return;
      if (k === "className") el.className = props[k];
      else if (k === "text") el.textContent = props[k];
      else if (k === "html") el.innerHTML = props[k];
      else if (k.indexOf("on") === 0 && typeof props[k] === "function") {
        el.addEventListener(k.slice(2).toLowerCase(), props[k]);
      } else if (k === "style" && typeof props[k] === "object") {
        Object.assign(el.style, props[k]);
      } else {
        el.setAttribute(k, props[k]);
      }
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      if (typeof c === "string" || typeof c === "number") el.appendChild(document.createTextNode(String(c)));
      else el.appendChild(c);
    });
    return el;
  }

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(function (s) { s.classList.remove("active"); });
    var target = document.getElementById("screen-" + name);
    if (target) target.classList.add("active");
  }

  var toastTimer = null;
  function toast(msg, ms) {
    var box = document.getElementById("toast-box");
    if (!box) {
      // 固定枠の中に置く。body に付けるとレターボックスの余白に出てしまう
      box = h("div", { id: "toast-box" });
      (document.getElementById("app") || document.body).appendChild(box);
    }
    box.textContent = msg;
    box.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.style.display = "none"; }, ms || 2600);
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  return { h: h, showScreen: showScreen, toast: toast, clear: clear };
})();
