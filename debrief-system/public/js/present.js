// ניווט במצגת + עריכה בישיבה
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var stage = document.getElementById('stage');
  var jump = document.getElementById('slideJump');
  var cur = Math.min(Number(stage.getAttribute('data-start')) || 0, slides.length - 1);
  var KEY = 'present-' + location.pathname;

  function store(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } }

  function show(i) {
    cur = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach(function (s, k) { s.classList.toggle('active', k === cur); });
    jump.value = cur;
    var url = new URL(location.href); url.searchParams.set('slide', cur);
    history.replaceState(null, '', url);
  }

  document.getElementById('next').onclick = function () { show(cur + 1); };
  document.getElementById('prev').onclick = function () { show(cur - 1); };
  jump.onchange = function () { show(Number(jump.value)); };

  document.addEventListener('keydown', function (e) {
    if (e.target.closest('input,textarea,select,[contenteditable]')) return;
    // RTL: חץ שמאלה = הבא
    if (['ArrowLeft', 'PageDown', ' ', 'Enter'].indexOf(e.key) >= 0) { e.preventDefault(); show(cur + 1); }
    else if (['ArrowRight', 'PageUp', 'Backspace'].indexOf(e.key) >= 0) { e.preventDefault(); show(cur - 1); }
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(slides.length - 1);
    else if (e.key === 'f' || e.key === 'F') toggleFs();
    else if (e.key === 'e' || e.key === 'E') toggleEdit();
  });

  function toggleFs() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  }
  document.getElementById('fullscreen').onclick = toggleFs;

  var editBtn = document.getElementById('toggleEdit');
  function setEdit(on) {
    document.body.classList.toggle('editing', on);
    if (editBtn) editBtn.classList.toggle('btn-primary', on);
    store(KEY + '-edit', on ? '1' : '0');
  }
  function toggleEdit() { if (editBtn) setEdit(!document.body.classList.contains('editing')); }
  if (editBtn) { editBtn.onclick = toggleEdit; setEdit(store(KEY + '-edit') === '1'); }

  // שעון ישיבה
  var start = Number(store(KEY + '-start')) || Date.now();
  store(KEY + '-start', String(start));
  var timer = document.getElementById('timer');
  function tick() {
    var s = Math.floor((Date.now() - start) / 1000);
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
    timer.textContent = (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }
  tick(); setInterval(tick, 1000);
  timer.ondblclick = function () { start = Date.now(); store(KEY + '-start', String(start)); tick(); };

  // הגדלת תמונות נספחים
  document.addEventListener('click', function (e) {
    var img = e.target.closest('img[data-zoom]');
    if (!img) return;
    var o = document.createElement('div');
    o.className = 'zoom-overlay';
    o.innerHTML = '<img alt="">';
    o.firstChild.src = img.src;
    o.onclick = function () { o.remove(); };
    document.body.appendChild(o);
  });

  show(cur);
})();
