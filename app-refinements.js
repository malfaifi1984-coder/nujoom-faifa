/* Exported daily cards share the app's navy, muted gold and mountain/star mark. */
(() => {
  'use strict';
  // Installation help belongs to both Home and About, including installed PWAs.
  function paintInstallState(installed = window.isStandalone?.()) {
    if (!installed) return;
    const button = document.getElementById('install-btn');
    button.classList.remove('hidden'); button.disabled = true;
    button.textContent = 'التطبيق مثبت على هذا الجهاز';
    document.getElementById('app-install-note').textContent = 'يمكنك إدارة تنبيهاتك من الخيارات أسفل هذه البطاقة.';
  }
  paintInstallState();
  window.addEventListener('appinstalled', () => paintInstallState(true));
  const openInstallGuide = window.homeInstall, closeInstallGuide = window.closeInstallGuide;
  let installOpener;
  window.homeInstall = () => {
    installOpener = document.activeElement;
    openInstallGuide();
    if (document.getElementById('install-overlay').classList.contains('open')) document.querySelector('.install-sheet-close').focus();
  };
  window.closeInstallGuide = () => { closeInstallGuide(); installOpener?.focus(); };
  document.addEventListener('keydown', (event) => {
    if (!document.getElementById('install-overlay').classList.contains('open')) return;
    if (event.key === 'Escape') window.closeInstallGuide();
    if (event.key === 'Tab') { event.preventDefault(); document.querySelector('.install-sheet-close').focus(); }
  });
  const dateOptions = { timeZone: 'Asia/Riyadh' };
  const numeric = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const number = (value) => numeric(value) === null ? '—' : Math.round(value).toLocaleString('ar-SA');
  function panel(ctx, x, y, w, h) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 26); else roundedRect(ctx, x, y, w, h, 26);
    ctx.fillStyle = '#142238'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#33455f'; ctx.stroke();
  }
  function text(ctx, value, x, y, size, color = '#e7eef8', weight = 500) {
    ctx.font = `${weight} ${size}px Cairo, Tahoma, Arial`; ctx.fillStyle = color; ctx.fillText(value, x, y);
  }
  function wrap(ctx, value, x, y, width, lineHeight, count = 4) {
    const words = value.split(/\s+/); let line = '', n = 0;
    for (let i = 0; i < words.length; i++) {
      const next = line ? `${line} ${words[i]}` : words[i];
      if (ctx.measureText(next).width > width && line) {
        if (++n >= count) { ctx.fillText(line + '…', x, y); return; }
        ctx.fillText(line, x, y); y += lineHeight; line = words[i];
      } else line = next;
    }
    if (line) ctx.fillText(line, x, y);
  }
  window.buildShareCard = async () => {
    await document.fonts.ready;
    const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
    const ctx = canvas.getContext('2d'); ctx.direction = 'rtl'; ctx.textAlign = 'right';
    const gradient = ctx.createLinearGradient(0, 0, 1080, 1350); gradient.addColorStop(0, '#182a43'); gradient.addColorStop(.65, '#0b1423'); gradient.addColorStop(1, '#0b1220'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1080, 1350);
    for (const [x, y, r] of [[72,85,2],[1010,345,2],[52,650,1.5],[1000,1060,2],[510,112,1.5]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = '#beccdd'; ctx.fill(); }
    const logo = await loadCanvasImage('/assets/brand-mark.svg'); ctx.drawImage(logo, 80, 63, 92, 92);
    text(ctx, 'نجوم مذاري فيفاء', 1000, 111, 55, '#e2cca0', 700);
    text(ctx, 'مواسم الأرض والسماء', 1000, 158, 25, '#a9bdd6');
    const now = new Date();
    const gregorian = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { ...dateOptions, day: 'numeric', month: 'long', year: 'numeric' }).format(now);
    const hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { ...dateOptions, day: 'numeric', month: 'long', year: 'numeric' }).format(now);
    panel(ctx, 70, 210, 940, 154);
    text(ctx, new Intl.DateTimeFormat('ar-SA', { ...dateOptions, weekday: 'long' }).format(now), 960, 264, 33, '#e0c99a', 600);
    text(ctx, gregorian, 960, 316, 30); text(ctx, hijri, 530, 316, 26, '#afc1d8');
    const cycle = getTodayCycleStars(), stars = cycle ? cycle.stars : getActiveStars();
    const localDay = nowKSA(); localDay.setHours(0, 0, 0, 0);
    const index = cycle ? cycle.idx : getCurrentStarIdx(localDay), star = stars[Math.max(0, index)], season = SEASON[star.season];
    panel(ctx, 70, 394, 940, 250);
    text(ctx, 'النجم الحالي', 960, 448, 28, '#a8bed8');
    text(ctx, star.name, 960, 538, 74, '#e2cca0', 700);
    text(ctx, season.name, 960, 597, 29, '#bed0e5');
    const day = diffDays(star.start, localDay) + 1;
    text(ctx, `اليوم ${number(day)} من ١٣`, 440, 597, 28, '#a8bed8');
    panel(ctx, 70, 674, 940, 424);
    text(ctx, 'من خصائص الموسم', 960, 737, 32, '#e2cca0');
    ctx.font = '500 32px Cairo, Tahoma, Arial'; ctx.fillStyle = '#d5e0ed'; wrap(ctx, star.chars, 960, 803, 840, 51, 5);
    panel(ctx, 70, 1128, 940, 152);
    const qr = await loadCanvasImage(SHARE_QR_DATA); ctx.drawImage(qr, 91, 1150, 108, 108);
    text(ctx, 'اكتشف نجوم ومواسم فيفاء', 960, 1186, 30, '#e2cca0', 600);
    ctx.save(); ctx.direction = 'ltr'; ctx.textAlign = 'left'; text(ctx, 'nujoom-faifa.netlify.app', 242, 1242, 27, '#b6cae2'); ctx.restore();
    text(ctx, 'جمع وإعداد: علي أحمد الفيفي (أبو منير) · الإصدار 6.00', 1000, 1324, 21, '#90a8c3');
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve({ blob, url: URL.createObjectURL(blob) }) : reject(new Error('Card export failed')), 'image/png'));
  };
})();
