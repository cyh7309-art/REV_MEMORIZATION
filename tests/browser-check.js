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

  await browser.close();

  console.log(results.join('\n'));
  console.log('\n콘솔/런타임 오류: ' + (errors.length ? '\n' + errors.join('\n') : '없음'));
  if (errors.length) process.exitCode = 1;
})();
