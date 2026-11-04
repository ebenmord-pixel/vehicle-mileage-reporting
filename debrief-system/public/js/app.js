// התנהגויות כלליות בממשק
(function () {
  // אישור לפני פעולה: על טופס או על כפתור
  document.addEventListener('submit', function (e) {
    var f = e.target;
    var btn = e.submitter;
    var msg = (btn && btn.getAttribute('data-confirm')) || f.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // העתקת קישור אישי
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-copy]');
    if (!b) return;
    var v = b.getAttribute('data-copy');
    if (v.charAt(0) === '/') v = location.origin + v;
    (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () {
      var t = b.textContent; b.textContent = '✔'; setTimeout(function () { b.textContent = t; }, 1200);
    }).catch(function () { window.prompt('העתיקו את הקישור:', v); });
  });

  // ציר זמן — הוספה/הסרה של שורות
  document.addEventListener('click', function (e) {
    var add = e.target.closest('.tl-add');
    if (add) {
      var ed = add.closest('.timeline-editor');
      var rows = ed.querySelector('.tl-rows');
      var first = rows.querySelector('.tl-row');
      var clone = first.cloneNode(true);
      clone.querySelectorAll('input').forEach(function (i) { i.value = ''; });
      var last = rows.querySelector('.tl-row:last-child input[name=tl_date]');
      clone.querySelector('input[name=tl_date]').value = (last && last.value) || ed.getAttribute('data-default-date') || '';
      rows.appendChild(clone);
      clone.querySelector('input[name=tl_time]').focus();
    }
    var rm = e.target.closest('.tl-remove');
    if (rm) {
      var all = rm.closest('.tl-rows').querySelectorAll('.tl-row');
      if (all.length > 1) rm.closest('.tl-row').remove();
      else rm.closest('.tl-row').querySelectorAll('input').forEach(function (i) { i.value = ''; });
    }
  });

  // בחירת מחלקה שלמה בהקצאת משתתפים
  document.addEventListener('change', function (e) {
    if (!e.target.classList.contains('dept-all')) return;
    e.target.closest('.dept-box').querySelectorAll('input[name=picks]:not([disabled])').forEach(function (c) {
      if (!c.closest('.user-pick').hidden) c.checked = e.target.checked;
    });
  });
  document.addEventListener('input', function (e) {
    if (!e.target.classList.contains('user-filter')) return;
    var s = e.target.value.trim();
    e.target.closest('form').querySelectorAll('.user-pick').forEach(function (l) {
      l.hidden = s && l.getAttribute('data-name').indexOf(s) === -1;
    });
  });

  // טבלת מעקב — הרחבת שורה
  document.addEventListener('click', function (e) {
    var row = e.target.closest('.track-row');
    if (!row || e.target.closest('a,form,input') && !e.target.closest('.expand')) return;
    var t = document.getElementById(row.getAttribute('data-toggle'));
    t.hidden = !t.hidden;
    row.parentNode.classList.toggle('open', !t.hidden);
  });

  // סגירת תפריטים בלחיצה בחוץ
  document.addEventListener('click', function (e) {
    document.querySelectorAll('details.menu[open], details.edit-pop[open]').forEach(function (d) {
      if (!d.contains(e.target)) d.removeAttribute('open');
    });
  });

  // סימון לשונית פעילה בעמוד תחקיר
  var sub = document.querySelectorAll('.subnav a[href^="#"]');
  if (sub.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        sub.forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id); });
      });
    }, { rootMargin: '-120px 0px -60% 0px' });
    sub.forEach(function (a) { var s = document.querySelector(a.getAttribute('href')); if (s) io.observe(s); });
  }
})();
