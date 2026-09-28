/* 브라우저 실동작 점검 (개발용) — node tests/browser-check.js */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require(process.env.PW_PATH || 'playwright');

const FILE = 'file://' + path.join(__dirname, '..', 'index.html');
const LAUNCH = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};

(async () => {
  const browser = await chromium.launch(LAUNCH);
  const errors = [];
  const results = [];
  const ok = (name, cond, extra) => {
    results.push((cond ? '✔ ' : '✘ ') + name + (extra !== undefined && !cond ? ' → ' + extra : ''));
    if (!cond) process.exitCode = 1;
  };

  /* ---------- 데스크톱 ---------- */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));

  await page.goto(FILE);
  await page.waitForSelector('.hero-ref', { timeout: 8000 });

  ok('홈 화면이 file:// 에서 렌더링된다', await page.isVisible('.hero-ref'));
  ok('본문 미완성 배지가 뜨지 않는다', await page.locator('#demoBadge').isHidden());

  // 범위 선택
  await page.click('[data-nav="select"]');
  await page.waitForSelector('#selChapter');
  await page.selectOption('#selChapter', '2');
  await page.selectOption('#selStart', '1');
  await page.selectOption('#selEnd', '7');
  ok('장 변경 시 절 목록이 갱신된다', (await page.locator('#selEnd option').count()) === 29,
     await page.locator('#selEnd option').count());
  ok('미리보기에 참조가 표시된다', (await page.textContent('.preview')).includes('요한계시록 2:1-7'));

  // 잘못된 범위
  await page.selectOption('#selStart', '7');
  await page.selectOption('#selEnd', '2');
  await page.waitForSelector('.err');
  ok('시작 절 > 종료 절 이면 오류를 보여준다',
     (await page.textContent('.err')).includes('시작 절은 종료 절보다 클 수 없습니다'));
  ok('오류 상태에서 암송 시작 버튼이 비활성화된다', await page.isDisabled('[data-action="start"]'));

  // 즐겨찾기
  await page.selectOption('#selStart', '1');
  await page.selectOption('#selEnd', '7');
  await page.click('[data-action="toggle-fav"]');
  await page.waitForTimeout(150);
  ok('즐겨찾기 추가 후 버튼 문구가 바뀐다',
     (await page.textContent('[data-action="toggle-fav"]')).includes('해제'));
  const favLen = await page.evaluate(() => JSON.parse(localStorage.getItem('revelation_favorites') || '[]').length);
  ok('localStorage 에 즐겨찾기가 저장된다', favLen === 1, favLen);

  // 암송 → 채점
  await page.click('[data-action="start"]');
  await page.waitForSelector('#answerInput');
  ok('암송 화면에 본문이 노출되지 않는다', !(await page.content()).includes('에베소 교회의 사자에게 편지하기를 오른손에'));

  const answer = await page.evaluate(() => RevData.getPassage(2, 1, 7).fullText);
  await page.fill('#answerInput', answer
    .replace('니골라당', '니골라땅')                       // 오타 → 유사
    .replace('처음 사랑을 버렸느니라', '사랑을 버렸느니라')); // 누락
  await page.waitForTimeout(1200);
  ok('타이머가 흐른다', /00:0[1-9]/.test(await page.textContent('#timerBox')), await page.textContent('#timerBox'));
  ok('글자 수가 표시된다', Number(await page.textContent('#charCount')) > 100);

  await page.click('[data-action="submit"]');
  await page.waitForSelector('.score-num', { timeout: 8000 });
  const score = Number((await page.textContent('.score-num')).replace(/[^0-9]/g, ''));
  ok('오타·누락이 있으면 100점 미만이 나온다', score >= 90 && score < 100, score);
  ok('누락 어절이 집계된다', Number(await page.textContent('.t-missing .tally-num')) >= 1,
     await page.textContent('.t-missing .tally-num'));
  ok('상세 비교에 유사/오답 표시가 있다', (await page.locator('.tk-similar, .tk-wrong').count()) > 0);
  ok('절별 점수 막대가 7개다', (await page.locator('.vrow').count()) === 7,
     await page.locator('.vrow').count());

  // 어절 클릭 → 설명 모달
  await page.locator('.tk-similar, .tk-wrong').first().click();
  await page.waitForSelector('#modalBack:not([hidden])', { timeout: 3000 });
  ok('어절을 누르면 비교 모달이 열린다', (await page.textContent('#modalBody')).includes('정답'));
  await page.click('#modalClose');

  await page.screenshot({ path: path.join(__dirname, 'shot-desktop-result.png'), fullPage: false });

  // 기록 저장 확인 + 새로고침 유지
  await page.click('[data-nav="history"]');
  await page.waitForSelector('.table');
  ok('학습 기록 표에 1행이 있다', (await page.locator('.table tbody tr').count()) === 1);
  await page.reload();
  await page.waitForSelector('.hero-ref');
  await page.click('[data-nav="history"]');
  await page.waitForSelector('.table');
  ok('새로고침 후에도 기록이 남는다', (await page.locator('.table tbody tr').count()) === 1);
  ok('연속 학습일 배지가 표시된다', (await page.textContent('#hdrStreak')).includes('연속'));

  await page.click('[data-nav="home"]');
  await page.waitForSelector('.hero-ref');
  await page.screenshot({ path: path.join(__dirname, 'shot-desktop-home.png') });

  await page.click('[data-nav="settings"]');
  await page.waitForSelector('.src-note');
  ok('설정에 본문 출처가 표시된다', (await page.textContent('.src-note')).includes('개역한글'));

  /* ---------- 확장 기능 ---------- */

  // manifest / PWA
  ok('manifest 가 연결되어 있다', (await page.locator('link[rel="manifest"]').count()) === 1);
  ok('file:// 에서는 설치 불가 안내가 뜬다',
     (await page.textContent('#screen-settings')).includes('file://'));

  // 학습자 이름
  await page.fill('[data-setting-text="learnerName"]', '조영호');
  await page.locator('[data-setting-text="learnerName"]').blur();
  await page.waitForTimeout(200);
  const savedName = await page.evaluate(() => JSON.parse(localStorage.getItem('revelation_settings')).learnerName);
  ok('학습자 이름이 저장된다', savedName === '조영호', savedName);

  // 간격 반복 — 채점하면 복습 카드가 생긴다
  const srsCount = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('revelation_srs') || '{}')).length);
  ok('채점 후 복습 카드가 만들어진다', srsCount === 1, srsCount);

  // 누적 암송
  await page.click('[data-nav="select"]');
  await page.waitForSelector('#selChapter');
  await page.selectOption('#selChapter', '1');
  await page.selectOption('#selStart', '1');
  await page.selectOption('#selEnd', '4');
  await page.click('[data-action="plan-start"]');
  await page.waitForSelector('[data-action="plan-load"]');
  ok('누적 암송 계획이 만들어진다',
     (await page.textContent('#screen-select')).includes('1단계'));

  await page.click('[data-action="plan-load"]');
  await page.waitForSelector('#answerInput');
  const p14 = await page.evaluate(() => RevData.getPassage(1, 1, 4).fullText);
  await page.fill('#answerInput', p14);
  await page.click('[data-action="submit"]');
  await page.waitForSelector('.score-num');
  ok('만점이면 결과에 다음 복습 안내가 뜬다',
     (await page.textContent('.next-review')).includes('다음 복습'));
  ok('누적 암송 확장 버튼이 나타난다', (await page.locator('[data-action="plan-advance"]').count()) > 0);

  await page.locator('[data-action="plan-advance"]').first().click();
  await page.waitForSelector('#answerInput');
  ok('확장하면 1~8절로 넓어진다', (await page.textContent('.mem-ref')).includes('1:1-8'),
     await page.textContent('.mem-ref'));

  // 홈에 누적/복습 카드
  await page.click('[data-nav="home"]');
  await page.waitForSelector('.hero-ref');
  ok('홈에 누적 암송 진행 카드가 있다', (await page.textContent('#screen-home')).includes('누적 암송 진행'));

  // 음성 암송 버튼 (file:// 이므로 비활성 + 안내)
  await page.click('[data-nav="select"]');
  await page.waitForSelector('[data-action="start"]');
  await page.click('[data-action="start"]');
  await page.waitForSelector('#answerInput');
  ok('음성 암송 버튼이 보인다', await page.isVisible('[data-action="voice"]'));
  const vAvail = await page.evaluate(() => RevVoice.isAvailable());
  const vDisabled = await page.isDisabled('[data-action="voice"]');
  ok('음성 버튼 상태가 지원 여부와 일치한다', vDisabled === !vAvail, 'avail=' + vAvail + ' disabled=' + vDisabled);
  ok('음성 안내 문구가 표시된다', (await page.textContent('#voiceNote')).length > 5,
     await page.textContent('#voiceNote'));
  ok('설정에서 음성 버튼을 끌 수 있다', await page.evaluate(async () => {
    Store.saveSettings({ voiceInput: false });
    RevApp.state.settings = Store.getSettings();
    RevApp.go('memorize');
    var gone = !document.querySelector('[data-action="voice"]');
    Store.saveSettings({ voiceInput: true });
    RevApp.state.settings = Store.getSettings();
    RevApp.go('memorize');
    return gone && !!document.querySelector('[data-action="voice"]');
  }));

  // 여러 명 취합
  const tmp = os.tmpdir();
  // 파일명은 ASCII 로 만든다 — 이 Chromium 빌드의 setInputFiles 가
  // 비ASCII 파일명을 전달하지 못한다(앱 문제 아님). 이름은 JSON 안의 learnerName 으로 확인한다.
  let seq = 0;
  const mk = (name, rows) => {
    const p = path.join(tmp, 'backup-' + (++seq) + '.json');
    fs.writeFileSync(p, JSON.stringify({
      exportedAt: new Date().toISOString(),
      settings: { learnerName: name },
      favorites: [],
      history: rows.map((r, i) => ({
        id: 'a' + i, chapter: r.c, startVerse: r.s, endVerse: r.e,
        reference: `계 ${r.c}:${r.s}~${r.e}`, score: r.score, accuracy: r.score / 100,
        duration: 150, hintsUsed: 0, weakVerses: r.weak || [],
        createdAt: new Date().toISOString()
      }))
    }), 'utf8');
    return p;
  };
  const f1 = mk('김성경', [{ c: 1, s: 1, e: 8, score: 96 }, { c: 2, s: 1, e: 7, score: 71, weak: [5] }]);
  const f2 = mk('이말씀', [{ c: 1, s: 1, e: 8, score: 84 }, { c: 2, s: 1, e: 7, score: 65, weak: [5] }]);

  await page.click('[data-nav="history"]');
  await page.waitForSelector('[data-action="go-report"]');
  await page.click('[data-action="go-report"]');
  await page.waitForSelector('[data-action="import-report"]');
  await page.setInputFiles('[data-action="import-report"]', [f1, f2]);
  await page.waitForSelector('#screen-report .table', { timeout: 5000 });
  const reportText = await page.textContent('#screen-report');
  ok('취합 결과에 인원 수가 나온다', reportText.includes('참여 인원'));
  ok('두 사람 이름이 모두 보인다', reportText.includes('김성경') && reportText.includes('이말씀'));
  ok('공통 취약절(계 2:5)이 집계된다', reportText.includes('계 2:5'), 'weak verse 미표시');
  ok('CSV 내보내기 버튼이 생긴다', await page.isVisible('[data-action="report-csv"]'));
  await page.screenshot({ path: path.join(__dirname, 'shot-desktop-report.png') });

  /* ---------- 본문 읽기 ---------- */
  await page.click('[data-nav="read"]');
  await page.waitForSelector('#screen-read .verses');
  ok('본문 읽기 화면이 열린다', await page.isVisible('#screen-read .verses'));
  ok('1장은 20절이 모두 표시된다', (await page.locator('#screen-read .vs').count()) === 20,
     await page.locator('#screen-read .vs').count());
  const v1 = await page.textContent('#screen-read .vs[data-verse="1"] .vs-text');
  ok('실제 본문이 표시된다', v1.includes('예수 그리스도의 계시라'), v1.slice(0, 30));

  // 장 이동
  await page.click('[data-action="read-next"]');
  await page.waitForTimeout(150);
  ok('다음 장으로 넘어간다 (2장 29절)', (await page.locator('#screen-read .vs').count()) === 29,
     await page.locator('#screen-read .vs').count());
  await page.selectOption('#readChapter', '4');
  await page.waitForTimeout(150);
  ok('장 선택으로 이동한다 (4장 11절)', (await page.locator('#screen-read .vs').count()) === 11,
     await page.locator('#screen-read .vs').count());
  ok('1장에서는 이전 버튼이 꺼지지 않는다(4장)', !(await page.isDisabled('[data-action="read-prev"]')));

  // 절을 눌러 범위 잡기
  await page.click('#screen-read .vs[data-verse="2"] .vs-num');
  await page.waitForTimeout(120);
  ok('첫 절을 누르면 선택 안내가 뜬다', (await page.textContent('.read-pickbar')).includes('계 4:2'));
  await page.click('#screen-read .vs[data-verse="5"] .vs-num');
  await page.waitForTimeout(120);
  ok('둘째 절을 누르면 범위가 된다', (await page.textContent('.read-pickbar')).includes('계 4:2~5'));
  ok('선택된 절이 강조된다', (await page.locator('#screen-read .vs.sel').count()) === 4,
     await page.locator('#screen-read .vs.sel').count());

  // 가리고 읽기
  await page.click('[data-action="read-cover"]');
  await page.waitForTimeout(150);
  ok('가림 모드가 켜진다', await page.locator('#screen-read .read-body.covered').count() === 1);
  ok('가림 상태에서는 아직 펼쳐진 절이 없다',
     (await page.locator('#screen-read .vs-text.shown').count()) === 0);
  await page.click('#screen-read .vs[data-verse="3"] .vs-text');
  await page.waitForTimeout(120);
  ok('절을 누르면 그 절만 펼쳐진다', (await page.locator('#screen-read .vs-text.shown').count()) === 1,
     await page.locator('#screen-read .vs-text.shown').count());
  await page.click('[data-action="read-cover"]');
  await page.waitForTimeout(150);
  ok('가림을 끄면 본문이 다시 보인다', await page.locator('#screen-read .read-body.covered').count() === 0);

  // 글자 크기
  const fsBefore = await page.getAttribute('#screen-read .read-body', 'class');
  await page.click('[data-action="read-font"]');
  await page.waitForTimeout(150);
  const fsAfter = await page.getAttribute('#screen-read .read-body', 'class');
  ok('글자 크기 버튼이 크기를 바꾼다', fsBefore !== fsAfter, fsBefore + ' → ' + fsAfter);
  await page.reload();
  await page.waitForSelector('.hero-ref');
  await page.click('[data-nav="read"]');
  await page.waitForSelector('#screen-read .read-body');
  ok('글자 크기가 새로고침 후에도 유지된다',
     (await page.getAttribute('#screen-read .read-body', 'class')).includes('fs-lg'),
     await page.getAttribute('#screen-read .read-body', 'class'));

  // 읽기 → 암송으로 이어지기
  await page.click('#screen-read .vs[data-verse="1"] .vs-num');
  await page.click('#screen-read .vs[data-verse="3"] .vs-num');
  await page.waitForTimeout(120);
  await page.click('[data-action="read-memorize"]');
  await page.waitForSelector('#answerInput');
  ok('읽기에서 고른 범위로 암송이 시작된다',
     (await page.textContent('.mem-ref')).includes('요한계시록 1:1-3'),
     await page.textContent('.mem-ref'));

  // 암송 결과 → 본문 다시 읽기 → 익힘 표시
  await page.fill('#answerInput', await page.evaluate(() => RevData.getPassage(1, 1, 3).fullText));
  await page.click('[data-action="submit"]');
  await page.waitForSelector('.score-num');
  ok('결과 화면에 본문 다시 읽기 버튼이 있다', await page.isVisible('[data-action="read-range"]'));
  await page.click('[data-action="read-range"]');
  await page.waitForSelector('#screen-read .verses');
  // 앞선 테스트들이 이미 1장에 기록을 남겼으므로, 방금 만점 받은 1~3절만 콕 집어 확인한다.
  const knownFlags = await page.evaluate(() => [1, 2, 3].map(function (v) {
    var el = document.querySelector('#screen-read .vs[data-verse="' + v + '"]');
    return el ? el.classList.contains('st-known') : false;
  }));
  ok('만점을 받은 절이 익힘으로 표시된다', knownFlags.every(Boolean), JSON.stringify(knownFlags));
  const knownCount = await page.locator('#screen-read .vs.st-known').count();
  ok('진도에 익힘 절 수가 반영된다',
     (await page.textContent('#screen-read')).includes('익힘 ' + knownCount + '절'), knownCount);
  await page.screenshot({ path: path.join(__dirname, 'shot-desktop-read.png'), fullPage: false });

  /* ---------- 모바일 ---------- */
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  mp.on('pageerror', e => errors.push('[mobile pageerror] ' + e.message));
  mp.on('console', m => { if (m.type() === 'error') errors.push('[mobile console] ' + m.text()); });
  await mp.goto(FILE);
  await mp.waitForSelector('.hero-ref');
  ok('모바일에서 하단 네비게이션이 보인다', await mp.isVisible('.bottom-nav'));
  ok('모바일에서 사이드바가 숨겨진다', await mp.locator('.side-nav').isHidden());
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('모바일 홈에서 가로 스크롤이 없다', overflow <= 0, overflow);

  await mp.click('.bottom-nav [data-nav="select"]');
  await mp.waitForSelector('#selChapter');
  await mp.selectOption('#selChapter', '21');
  await mp.selectOption('#selStart', '1');
  await mp.selectOption('#selEnd', '4');
  await mp.click('[data-action="start"]');
  await mp.waitForSelector('#answerInput');
  await mp.click('[data-action="hint"]');
  await mp.waitForSelector('.hint-box');
  ok('힌트 1단계가 초성을 보여준다', (await mp.textContent('.hint-text')).includes('ㄸ'),
     (await mp.textContent('.hint-text')).slice(0, 30));
  await mp.fill('#answerInput', '또 내가 새 하늘과 새 땅을 보니');
  await mp.click('[data-action="submit"]');
  await mp.waitForSelector('.score-num');
  const mOverflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('모바일 결과 화면에서 가로 스크롤이 없다', mOverflow <= 0, mOverflow);
  ok('힌트 사용이 결과에 기록된다', (await mp.textContent('.score-sub')).includes('힌트 1단계'));
  await mp.screenshot({ path: path.join(__dirname, 'shot-mobile-result.png'), fullPage: false });

  // 모바일 — 홈의 복습/누적 카드와 취합 화면 가로 스크롤 점검
  await mp.evaluate(() => {
    const back = RevSRS.addDays(RevStats.todayKey(), -3);
    Store.saveSrs({ 'rev-1-1-8': { id: 'rev-1-1-8', chapter: 1, startVerse: 1, endVerse: 8, ease: 2.36, interval: 4, reps: 2, lapses: 0, lastScore: 88, last: back, due: back } });
    RevPlan.start(2, 1, 4); RevPlan.record({ chapter: 2, startVerse: 1, endVerse: 4 }, 94);
    RevApp.go('home');
  });
  await mp.waitForTimeout(250);
  ok('모바일 홈에 복습 카드가 보인다', (await mp.textContent('#screen-home')).includes('오늘 복습할 범위'));
  const homeOverflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('복습·누적 카드가 있어도 가로 스크롤이 없다', homeOverflow <= 0, homeOverflow);

  await mp.evaluate(() => {
    RevApp.state.report = RevReport.aggregate([{
      name: 'a.json',
      data: {
        settings: { learnerName: '김성경' },
        history: [{ id: 'x', chapter: 1, startVerse: 1, endVerse: 8, score: 90, accuracy: 0.9, duration: 120, weakVerses: [3], createdAt: new Date().toISOString() }]
      }
    }]);
    RevApp.go('report');
  });
  await mp.waitForSelector('#screen-report .table');
  const repOverflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('모바일 취합 화면에서 가로 스크롤이 없다 (표는 자체 스크롤)', repOverflow <= 0, repOverflow);

  // 모바일 — 본문 읽기
  await mp.click('.bottom-nav [data-nav="read"]');
  await mp.waitForSelector('#screen-read .verses');
  ok('모바일에서 본문 읽기가 열린다', await mp.isVisible('#screen-read .verses'));
  const readOverflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('모바일 본문 읽기에서 가로 스크롤이 없다', readOverflow <= 0, readOverflow);
  ok('하단 네비게이션 6개가 모두 보인다', (await mp.locator('.bottom-nav .nav-item').count()) === 6,
     await mp.locator('.bottom-nav .nav-item').count());
  const navFits = await mp.evaluate(() => {
    const nav = document.querySelector('.bottom-nav');
    return nav.scrollWidth <= nav.clientWidth + 1;
  });
  ok('하단 네비게이션이 화면 폭 안에 들어간다', navFits);
  await mp.click('#screen-read .vs[data-verse="1"] .vs-num');
  await mp.waitForTimeout(120);
  ok('모바일에서도 절 선택이 된다', (await mp.textContent('.read-pickbar')).includes('계 1:1'));
  await mp.screenshot({ path: path.join(__dirname, 'shot-mobile-read.png'), fullPage: false });

  /* ---------- 채점 결과 표시 ---------- */
  await page.evaluate(() => {
    const p2 = RevData.getPassage(1, 1, 4);
    // 1절: 오타 / 2절: 정확 / 3절: 뒤 3어절 빠뜨림 / 4절: 정확 + 본문에 없는 말 추가
    const typed = [
      '1 ' + p2.verses[0].text.replace('속히', '속이'),
      '2 ' + p2.verses[1].text,
      '3 ' + p2.verses[2].text.split(' ').slice(0, -3).join(' '),
      '4 ' + p2.verses[3].text + ' 할렐루야'
    ].join(' ');
    RevApp.state.passage = p2;
    RevApp.state.selected = { chapter: 1, startVerse: 1, endVerse: 4 };
    RevApp.state.result = RevScorer.score(p2, typed, { hintsUsed: 0, hintPenalty: true });
    RevApp.state.lastUserText = typed;
    RevApp.state.lastDuration = 200;
    RevApp.state.onlyWrong = false;
    RevApp.go('result');
  });
  await page.waitForSelector('.diff-flow');

  // 절 번호(1·2·3·4)를 적었는데도 '잘못 넣음'으로 세지 않아야 한다
  const extraCount = await page.evaluate(() => RevApp.state.result.counts.extra);
  ok('절 번호를 적어도 잘못 넣음은 추가한 말 1개뿐', extraCount === 1, extraCount);

  // 잘못 넣은 말에는 취소선이, 빠뜨린 말에는 취소선이 없어야 한다 (예전엔 반대였음)
  const deco = await page.evaluate(() => {
    const ex = document.querySelector('#screen-result .tk-extra .tk-main');
    const ms = document.querySelector('#screen-result .tk-missing .tk-main');
    const g = el => el ? getComputedStyle(el).textDecorationLine : 'none-element';
    return { extra: g(ex), missing: g(ms) };
  });
  ok('잘못 넣은 말에는 취소선이 있다', deco.extra.includes('line-through'), deco.extra);
  ok('빠뜨린 말에는 취소선이 없다', !deco.missing.includes('line-through'), deco.missing);

  // 클릭하지 않아도 "내가 쓴 말"이 아래에 보인다
  const subText = await page.evaluate(() => {
    const t = [...document.querySelectorAll('#screen-result .tk-similar, #screen-result .tk-wrong')]
      .map(el => (el.querySelector('.tk-sub') || {}).textContent || '');
    return t.join('|');
  });
  ok('비슷함·틀림 어절 아래에 내가 쓴 말이 보인다', subText.includes('속이'), subText);
  ok('빠뜨린 말에는 "안 씀" 표시', await page.isVisible('#screen-result .tk-missing .tk-sub'));
  ok('잘못 넣은 말에는 "뺄 말" 표시',
    (await page.textContent('#screen-result .tk-extra .tk-sub')).includes('뺄 말'));

  // 오답 유형 요약
  ok('오답 유형 요약이 보인다', await page.isVisible('.issue-list'));
  const issueText = await page.textContent('.issue-list');
  ok('빠뜨림 유형이 잡힌다', issueText.includes('빠뜨림'), issueText.slice(0, 80));
  ok('잘못 넣음 유형이 잡힌다', issueText.includes('잘못 넣음'), issueText.slice(0, 80));

  // 틀린 절만 보기
  ok('틀린 절만 보기 버튼이 있다', await page.isVisible('[data-action="toggle-only-wrong"]'));
  const allVerses = await page.locator('#screen-result .diff-verse').count();
  await page.click('[data-action="toggle-only-wrong"]');
  await page.waitForTimeout(150);
  const fewer = await page.locator('#screen-result .diff-verse').count();
  ok('누르면 틀린 절만 남는다', fewer < allVerses && fewer > 0, fewer + '/' + allVerses);
  await page.click('[data-action="toggle-only-wrong"]');
  await page.waitForTimeout(150);
  ok('다시 누르면 전체가 돌아온다',
    (await page.locator('#screen-result .diff-verse').count()) === allVerses);

  // 용어가 바뀌었는지 (추가 → 잘못 넣음)
  const legend = await page.textContent('#screen-result .legend');
  ok('범례 용어가 행동으로 바뀌었다',
    legend.includes('잘못 넣음') && legend.includes('빠뜨림') && !legend.includes('추가 입력'), legend);

  await page.screenshot({ path: path.join(__dirname, 'shot-desktop-result2.png'), fullPage: false });

  /* ---------- 순서 바뀜 · 나눠 쓰기 · 지난 시도 비교 ---------- */
  const adv = await page.evaluate(() => {
    Store.clearHistory();               // 앞선 검사들의 기록과 섞이지 않게 비운다
    const ps = RevData.getPassage(1, 1, 4);

    // 1차 시도 — 3절을 많이 빠뜨려 약한 절로 남긴다
    const first = [ps.verses[0].text, ps.verses[1].text,
      ps.verses[2].text.split(' ').slice(0, 5).join(' '), ps.verses[3].text].join(' ');
    const r1 = RevScorer.score(ps, first, { hintsUsed: 0 });
    Store.saveAttempt({ chapter: 1, startVerse: 1, endVerse: 4, reference: '계 1:1~4',
      score: r1.score, accuracy: r1.accuracy, duration: 300, hintsUsed: 0,
      correctCount: r1.counts.correct, similarCount: r1.counts.similar, wrongCount: r1.counts.wrong,
      missingCount: r1.counts.missing, extraCount: r1.counts.extra,
      totalTokens: r1.totalTokens, weakVerses: r1.weakVerses });

    // 2차 시도 — 3절은 고치고, 어절 순서 바꿈 + 낱말 나눠 쓰기
    const w = ps.verses[0].text.split(' ');
    const t = w[5]; w[5] = w[6]; w[6] = t;
    const second = ['1 ' + w.join(' '),
      '2 ' + ps.verses[1].text.replace('증거하였느니라', '증거 하였느니라'),
      '3 ' + ps.verses[2].text,
      '4 ' + ps.verses[3].text].join(' ');
    const r2 = RevScorer.score(ps, second, { hintsUsed: 0 });

    const before = Store.getHistory();
    RevApp.state.passage = ps;
    RevApp.state.selected = { chapter: 1, startVerse: 1, endVerse: 4 };
    RevApp.state.result = r2;
    RevApp.state.lastUserText = second;
    RevApp.state.lastDuration = 240;
    RevApp.state.onlyWrong = false;
    RevApp.state.compare = RevStats.compareWithPrevious(r2,
      RevStats.previousAttempt(before, { chapter: 1, startVerse: 1, endVerse: 4 }));
    RevApp.state.attemptNo = RevStats.attemptNumber(before, { chapter: 1, startVerse: 1, endVerse: 4 });
    RevApp.go('result');
    return { prev: r1.score, now: r2.score, attemptNo: RevApp.state.attemptNo };
  });
  await page.waitForSelector('.diff-flow');

  // 순서 바뀜
  ok('순서가 바뀐 어절이 표시된다', (await page.locator('#screen-result .tk-moved').count()) === 2,
     await page.locator('#screen-result .tk-moved').count());
  const movedSubs = await page.evaluate(() =>
    [...document.querySelectorAll('#screen-result .tk-moved .tk-sub')].map(e => e.textContent).join('|'));
  ok('본문 자리에는 "자리 바뀜", 쓴 자리에는 "여기 아님"',
     movedSubs.includes('자리 바뀜') && movedSubs.includes('여기 아님'), movedSubs);
  ok('잘못 놓은 자리의 말에는 취소선이 있다', await page.evaluate(() => {
    const el = document.querySelector('#screen-result .tk-extra.tk-moved .tk-main');
    return !!el && getComputedStyle(el).textDecorationLine.includes('line-through');
  }));
  ok('순서 바뀜이 오답 유형 요약에 나온다',
     (await page.textContent('.issue-list')).includes('순서 바뀜'));

  // 낱말을 나눠 쓴 경우
  const spacingSubs = await page.evaluate(() =>
    [...document.querySelectorAll('#screen-result .tk-spacing .tk-sub')].map(e => e.textContent).join('|'));
  ok('나눠 쓴 어절에 "나눠 씀" 표시', spacingSubs.includes('나눠 씀'), spacingSubs);
  ok('나눠 써도 점수가 크게 깎이지 않는다', adv.now >= 95, adv.now);

  // 지난 시도 비교
  ok('지난번과 비교 카드가 보인다', await page.isVisible('.compare-card'));
  const cmpText = (await page.textContent('.compare-card')).replace(/\s+/g, ' ');
  ok('지난 점수와 이번 점수가 함께 보인다',
     cmpText.includes(adv.prev + '점') && cmpText.includes(adv.now + '점'), cmpText.slice(0, 90));
  ok('점수가 올랐으면 + 로 표시된다', cmpText.includes('+'), cmpText.slice(0, 90));
  ok('몇 번째 시도인지 보인다',
     adv.attemptNo === 2 && cmpText.includes('2번째'), adv.attemptNo + ' / ' + cmpText.slice(0, 60));
  ok('고쳐진 절을 짚어준다', cmpText.includes('고쳐진 절'), cmpText.slice(0, 160));
  ok('점수가 올랐을 때 카드가 좋아진 상태로 보인다',
     (await page.getAttribute('.compare-card', 'class')).includes('up'));

  // 첫 시도에는 비교 카드가 없어야 한다
  await page.evaluate(() => {
    Store.clearHistory();
    const ps = RevData.getPassage(2, 1, 3);
    RevApp.state.passage = ps;
    RevApp.state.result = RevScorer.score(ps, ps.fullText, { hintsUsed: 0 });
    RevApp.state.lastUserText = ps.fullText;
    RevApp.state.compare = null;
    RevApp.state.attemptNo = 1;
    RevApp.go('result');
  });
  await page.waitForSelector('.score-num');
  ok('첫 시도에는 비교 카드가 없다', (await page.locator('.compare-card').count()) === 0);

  await page.screenshot({ path: path.join(__dirname, 'shot-desktop-result3.png'), fullPage: false });

  /* ---------- 안드로이드(갤럭시) 음성 중복 입력 회귀 방지 ----------
     갤럭시 크롬은 onresult 마다 resultIndex 를 0 으로 주면서 지금까지의 결과를
     통째로 다시 보낸다. 그 동작을 그대로 흉내내는 가짜 인식기를 심어
     입력창 내용이 눈덩이처럼 불어나지 않는지 실제 화면에서 확인한다. */
  const actx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const ap = await actx.newPage();
  ap.on('pageerror', e => errors.push('[android pageerror] ' + e.message));
  ap.on('console', m => { if (m.type() === 'error') errors.push('[android console] ' + m.text()); });

  await ap.addInitScript(() => {
    window.isSecureContext = true;
    function AndroidLikeRecognition() { window.__rec = this; this._rows = []; }
    AndroidLikeRecognition.prototype.start = function () {};
    AndroidLikeRecognition.prototype.stop = function () { if (this.onend) this.onend(); };
    AndroidLikeRecognition.prototype.say = function (text, isFinal) {
      this._rows.push({ 0: { transcript: text }, isFinal: isFinal !== false, length: 1 });
      this.onresult({ resultIndex: 0, results: this._rows });   // 항상 0
    };
    window.SpeechRecognition = AndroidLikeRecognition;
  });

  await ap.goto(FILE);
  await ap.waitForSelector('.hero-ref');
  await ap.click('.bottom-nav [data-nav="select"]');
  await ap.waitForSelector('#selChapter');
  await ap.selectOption('#selChapter', '20');
  await ap.selectOption('#selStart', '1');
  await ap.selectOption('#selEnd', '2');
  await ap.click('[data-action="start"]');
  await ap.waitForSelector('#answerInput');

  ok('안드로이드 환경에서 음성 버튼이 활성화된다', !(await ap.isDisabled('[data-action="voice"]')));
  await ap.click('[data-action="voice"]');
  await ap.waitForTimeout(150);

  const spoken = ['또 내가', '몸에', '천사가', '무저갱', '열쇠와', '큰 쇠사슬을'];
  for (const w of spoken) {
    await ap.evaluate(t => window.__rec.say(t), w);
    await ap.waitForTimeout(40);
  }
  const heard = (await ap.inputValue('#answerInput')).trim();
  ok('말한 그대로 입력된다 (중복 누적 없음)', heard === spoken.join(' '), heard);

  await ap.evaluate(() => window.__rec.onend());   // 조용해서 안드로이드가 끊음
  await ap.waitForTimeout(150);
  ok('자동으로 다시 듣기를 이어간다', await ap.evaluate(() => RevVoice.isListening()));
  await ap.evaluate(() => window.__rec.say('풀어 놓으리라'));
  await ap.waitForTimeout(80);
  const heard2 = (await ap.inputValue('#answerInput')).trim();
  ok('자동 재개 후에도 앞 내용이 유지된다', heard2 === spoken.join(' ') + ' 풀어 놓으리라', heard2);

  await ap.click('[data-action="voice"]');
  await ap.waitForTimeout(150);
  ok('마이크 버튼으로 끄면 멈춘다', (await ap.evaluate(() => RevVoice.isListening())) === false);

  await browser.close();

  console.log(results.join('\n'));
  console.log('\n콘솔/런타임 오류: ' + (errors.length ? '\n' + errors.join('\n') : '없음'));
  if (errors.length) process.exitCode = 1;
})();
