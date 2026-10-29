// The compare strip: a switch between the three versions of the page (plain JS "/plain", React "/", Aurora "/react2"),
// plus what each one really loaded. Plain script, no framework, so the same file works under both. Nothing here touches the page's own
// DOM besides inserting the strip as the first child of <body>.
(function () {
  var route = location.pathname.replace(/\/+$/, "");
  var VERSIONS = [
    { id: "plain", label: "Plain JS", path: "/plain", how: "Preact + htm, no build step" },
    { id: "react", label: "React", path: "/", how: "React 19 + TypeScript, built with Vite" },
    { id: "aurora", label: "Aurora", path: "/react2", how: "React 19 + TypeScript, second design" },
  ];
  var here = route === "/plain" ? "plain" : route === "/react2" ? "aurora" : "react";

  // Keep the look you picked: the theme is on <html data-theme>, the level (if you set one) is in the address.
  function carry() {
    var q = new URLSearchParams();
    var theme = document.documentElement.getAttribute("data-theme");
    if (theme) q.set("theme", theme);
    var level = new URLSearchParams(location.search).get("level");
    if (level) q.set("level", level);
    var s = q.toString();
    return s ? "?" + s : "";
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  var bar = el("nav", "cmp");
  bar.setAttribute("aria-label", "Page version");
  bar.appendChild(el("span", "cmp-label", "VERSION"));
  var seg = el("div", "cmp-seg");
  var links = VERSIONS.map(function (v) {
    var a = el("a", "", v.label);
    a.href = v.path;
    if (v.id === here) a.setAttribute("aria-current", "page");
    seg.appendChild(a);
    return [a, v];
  });
  bar.appendChild(seg);
  var note = el("span", "cmp-note");
  bar.appendChild(note);
  var hint = el("span", "cmp-key", "⇧V");
  hint.title = "Press Shift+V to switch";
  bar.appendChild(hint);

  // Same-origin links: refresh the query string at click time so the current theme comes along.
  links.forEach(function (p) {
    p[0].addEventListener("click", function () { p[0].href = p[1].path + carry(); });
  });

  // What this version downloaded: the files under /static/ that the page asked for (this strip's own two files left out).
  function fmt(bytes) { return bytes < 1024 ? bytes + " B" : (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + " KB"; }
  function measure() {
    var js = 0, css = 0, files = 0;
    performance.getEntriesByType("resource").forEach(function (r) {
      var u = new URL(r.name);
      if (u.origin !== location.origin || u.pathname.indexOf("/static/") !== 0 || /\/compare\.(js|css)$/.test(u.pathname)) return;
      var size = r.decodedBodySize || 0;
      if (/\.m?js$/.test(u.pathname)) { js += size; files++; }
      else if (/\.css$/.test(u.pathname)) { css += size; files++; }
    });
    var how = VERSIONS.filter(function (v) { return v.id === here; })[0].how;
    note.textContent = "";
    var b = el("b", "", how);
    note.appendChild(b);
    note.appendChild(document.createTextNode(" · loads " + files + " files: " + fmt(js) + " JS, " + fmt(css) + " CSS (uncompressed)"));
  }

  // The strip is pinned to the top. Pages with their own sticky or fixed parts (the React top bar, Aurora's floating header and drawer)
  // read its height from --cmp-h and sit below it. A ResizeObserver keeps it right when fonts load or the strip wraps.
  function publishHeight() {
    document.documentElement.style.setProperty("--cmp-h", (bar.offsetHeight || 0) + "px");
  }

  function mount() {
    document.body.insertBefore(bar, document.body.firstChild);
    publishHeight();
    if (window.ResizeObserver) new ResizeObserver(publishHeight).observe(bar);
    window.addEventListener("resize", publishHeight);
    window.addEventListener("load", publishHeight);
    measure();
    window.addEventListener("load", function () { setTimeout(measure, 300); });   // module scripts can finish after this runs
  }
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);

  document.addEventListener("keydown", function (e) {
    if (e.key !== "V" || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    var i = VERSIONS.map(function (v) { return v.id; }).indexOf(here);
    location.href = VERSIONS[(i + 1) % VERSIONS.length].path + carry();      // Shift+V: next version, wrapping around
  });
})();
