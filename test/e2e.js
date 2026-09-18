const { chromium } = require('playwright-core');
const SP = process.argv[2];
const ok = [], bad = [];
const check = (name, cond, extra='') => (cond ? ok : bad).push(name + (extra ? ' — ' + extra : ''));

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 760, height: 1000 }, deviceScaleFactor: 2, locale: 'ru-RU' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await p.goto('file://' + require('path').resolve(__dirname, '../index.html') + '');
  await p.waitForTimeout(400);

  // 1. Главная
  const cards = await p.locator('#list .task').count();
  check('главная: карточки задач отрисованы', cards === 3, cards + ' шт.');
  check('неделя: 7 дней', await p.locator('#week .day').count() === 7);
  check('сегодня выделено', await p.locator('#week .day.on').count() === 1);
  await p.screenshot({ path: SP + '/01-home.png' });

  // 2. Переход в фокус по кнопке Старт второй задачи
  await p.locator('#list .task').nth(1).locator('.go').click();
  await p.waitForTimeout(500);
  check('экран фокуса открылся', await p.locator('#s-focus.active').count() === 1);
  check('заголовок задачи проброшен', (await p.locator('#fTitle').innerText()) === 'Дизайн для соцсетей');
  check('интервал времени посчитан', (await p.locator('#fTime').innerText()) === '13:15 – 13:45');
  check('подпункты подтянулись', await p.locator('#subs .sub').count() === 3);
  await p.screenshot({ path: SP + '/02-focus.png' });

  // 3. Таймер реально идёт
  const t0 = await p.locator('#fClock').innerText();
  const off0 = await p.locator('#prog').evaluate(e => getComputedStyle(e).strokeDashoffset);
  await p.locator('#playBtn').click();
  await p.waitForTimeout(3200);
  const t1 = await p.locator('#fClock').innerText();
  const off1 = await p.locator('#prog').evaluate(e => getComputedStyle(e).strokeDashoffset);
  const knob = await p.locator('#knob').evaluate(e => e.style.transform);
  const sec = s => +s.split(':')[0]*60 + +s.split(':')[1];
  check('таймер отсчитывает', sec(t1) < sec(t0), t0 + ' → ' + t1);
  check('кольцо убывает по остатку времени', parseFloat(off1) > parseFloat(off0),
        parseFloat(off0).toFixed(1) + ' → ' + parseFloat(off1).toFixed(1));
  const knobDeg = parseFloat((knob.match(/rotate\(([-\d.]+)deg\)/)||[0,0])[1]);
  check('бегунок на кольце сдвинулся', knobDeg > 0 && knobDeg < 360, knob);
  check('в начале кольцо заполнено целиком', parseFloat(off0) < 1, 'offset ' + off0);
  check('кнопка стала «Пауза»', (await p.locator('#playText').innerText()) === 'Пауза');

  // 4. Подпункты и +15
  await p.locator('#subs .sub').nth(0).click();
  await p.locator('#subs .sub').nth(1).click();
  check('подпункты отмечаются', await p.locator('#subs .sub.on').count() === 2);
  const before = await p.locator('#fClock').innerText();
  await p.locator('#plus15').click();
  await p.waitForTimeout(300);
  const after = await p.locator('#fClock').innerText();
  check('«+15» добавляет 15 минут', sec(after) - sec(before) >= 890, before + ' → ' + after);
  check('интервал пересчитался', (await p.locator('#fTime').innerText()) === '13:15 – 14:00');
  await p.waitForTimeout(600);
  await p.screenshot({ path: SP + '/03-timer-running.png' });

  // 5. Новый подпункт с клавиатуры
  await p.fill('#newSub', 'Сторис для запуска');
  await p.press('#newSub', 'Enter');
  check('подпункт добавляется по Enter', await p.locator('#subs .sub').count() === 4);

  // 6. Завершение задачи
  await p.locator('#doneBtn').click();
  await p.waitForTimeout(600);
  check('после «Завершить» вернулись на главную', await p.locator('#s-home.active').count() === 1);
  check('задача отмечена выполненной', await p.locator('#list .task.done').count() === 1);
  check('статистика обновилась', (await p.locator('#statTitle').innerText()).startsWith('1 задача'),
        await p.locator('#statTitle').innerText());
  await p.screenshot({ path: SP + '/04-home-done.png' });

  // 7. Добавление задачи через шторку
  await p.locator('#openSheet').click();
  await p.waitForTimeout(500);
  await p.fill('#fName', 'Учу Vibecoding');
  await p.fill('#fStart', '16:00');
  await p.locator('#durs .pill', { hasText: '60 м' }).click();
  await p.locator('#colors .dotc').nth(3).click();
  await p.fill('#fSubs', 'Посмотреть урок\nПовторить код\nСделать свой пример');
  await p.screenshot({ path: SP + '/05-sheet.png' });
  await p.locator('.save').click();
  await p.waitForTimeout(600);
  check('шторка закрылась', await p.locator('#sheet.on').count() === 0);
  check('новая задача в списке', await p.locator('#list .task').count() === 4);
  const titles = await p.locator('#list .task h3').allInnerTexts();
  check('сортировка по времени', JSON.stringify(titles) ===
    JSON.stringify(['Дыхательная практика','Дизайн для соцсетей','Учу Vibecoding','План на неделю']),
    titles.join(' | '));

  // 8. Фильтр «скрыть выполненные»
  await p.locator('#toggleView').click();
  await p.waitForTimeout(300);
  check('переключатель прячет выполненные', await p.locator('#list .task').count() === 3);
  await p.locator('#toggleView').click();
  await p.waitForTimeout(300);

  // 9. Календарь
  await p.locator('.tab[data-go="cal"]').click();
  await p.waitForTimeout(500);
  check('календарь открылся', await p.locator('#s-cal.active').count() === 1);
  check('в месяце 30 дней (сентябрь)', await p.locator('#cal .cell:not(.void)').count() === 30);
  check('день с задачами помечен точкой', await p.locator('#cal .cell.has, #cal .cell.on').count() >= 1);
  await p.screenshot({ path: SP + '/06-calendar.png' });

  // 10. Профиль + тёмная тема
  await p.locator('.tab[data-go="prof"]').click();
  await p.waitForTimeout(500);
  check('профиль: всего задач', (await p.locator('#tAll').innerText()) === '4');
  check('профиль: выполнено', (await p.locator('#tDone').innerText()) === '1');
  const min = +(await p.locator('#tMin').innerText());
  check('профиль: минуты в фокусе накопились', min >= 0, min + ' мин');
  await p.screenshot({ path: SP + '/07-profile.png' });
  await p.locator('#rTheme').click();
  await p.waitForTimeout(600);
  check('тёмная тема включилась', await p.getAttribute('html', 'data-theme') === 'dark');
  await p.locator('.tab[data-go="home"]').click();
  await p.waitForTimeout(600);
  await p.screenshot({ path: SP + '/08-dark.png' });

  // 11. Сохранение после перезагрузки
  await p.reload();
  await p.waitForTimeout(700);
  check('после перезагрузки задачи на месте', await p.locator('#list .task').count() === 4);
  check('после перезагрузки выполненная отмечена', await p.locator('#list .task.done').count() === 1);
  check('после перезагрузки тема сохранилась', await p.getAttribute('html', 'data-theme') === 'dark');
  await p.locator('#rTheme') && await p.locator('.tab[data-go="prof"]').click();
  await p.waitForTimeout(400);
  await p.locator('#rTheme').click();
  await p.waitForTimeout(400);
  await p.locator('.tab[data-go="home"]').click();

  // 12. Мобильный размер
  const mp = await ctx.newPage();
  await mp.setViewportSize({ width: 390, height: 844 });
  await mp.goto('file://' + require('path').resolve(__dirname, '../index.html') + '');
  await mp.waitForTimeout(500);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('нет горизонтальной прокрутки на 390px', overflow <= 0, 'overflow ' + overflow);
  await mp.screenshot({ path: SP + '/09-mobile.png' });

  check('нет ошибок в консоли', errors.length === 0, errors.join(' / '));

  await b.close();
  console.log('\n✅ ПРОЙДЕНО (' + ok.length + '):');
  ok.forEach(s => console.log('   ✓ ' + s));
  if (bad.length){ console.log('\n❌ ПРОВАЛЕНО (' + bad.length + '):'); bad.forEach(s => console.log('   ✗ ' + s)); }
  process.exit(bad.length ? 1 : 0);
})();
