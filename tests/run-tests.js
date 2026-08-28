/* ============================================================
   run-tests.js — 명세 56항 테스트 케이스 자동 검증
   실행:  node tests/run-tests.js
   브라우저 없이 순수 로직(data/diff/scorer/statistics/storage)을 검사한다.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* ---------- 브라우저 흉내내기 ---------- */
const store = {};
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Array, Object, String, Number, Boolean, RegExp, Error,
  Uint32Array, Float32Array, Uint8Array,
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  },
  location: { protocol: 'file:', hostname: '', search: '' },
  document: {
    getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
    querySelectorAll: () => []
  }
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);

function load(rel) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel });
}

load('data/revelation_kor.js');
load('js/data.js');
load('js/storage.js');
load('js/diff.js');
load('js/scorer.js');
load('js/statistics.js');
load('js/srs.js');
load('js/plan.js');
load('js/read.js');
load('js/voice.js');
load('js/report.js');

const { RevData, RevDiff, RevScorer, RevStats, Store, RevSRS, RevPlan, RevRead, RevVoice, RevReport } = sandbox;

/* ---------- 미니 테스트 러너 ---------- */
let pass = 0, fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { pass++; console.log('  \x1b[32m✔\x1b[0m ' + name); }
  else {
    fail++; failures.push(name);
    console.log('  \x1b[31m✘\x1b[0m ' + name + (detail !== undefined ? '  → ' + detail : ''));
  }
}
function group(title) { console.log('\n\x1b[1m' + title + '\x1b[0m'); }

function tally(passage, userText, opts) {
  return RevScorer.score(passage, userText, Object.assign({ hintsUsed: 0, hintPenalty: true }, opts || {}));
}

/* ============================================================ */

RevData.init(null);

group('데이터 계층');
check('본문 데이터가 준비된다', RevData.isReady());
check('버전이 개역한글이다', RevData.getVersion() === '개역한글', RevData.getVersion());
check('22장이 모두 있다', RevData.getChapters().length === 22, RevData.getChapters().length);
check('총 404절이다', RevData.getTotalVerses() === 404, RevData.getTotalVerses());
check('데모 모드가 아니다(본문 완비)', RevData.isDemo() === false, JSON.stringify(RevData.getIssues()));

let countsOk = true, countDetail = '';
for (let c = 1; c <= 22; c++) {
  if (RevData.getVerseCount(c) !== RevData.REFERENCE_VERSE_COUNT[c]) {
    countsOk = false; countDetail += ` ${c}장:${RevData.getVerseCount(c)}`;
  }
}
check('장별 절 수가 실제 요한계시록과 일치한다', countsOk, countDetail);

const p18 = RevData.getPassage(1, 1, 8);
check('getPassage(1,1,8) 이 8절을 돌려준다', p18 && p18.verses.length === 8);
check('reference 형식이 맞다', p18.reference === '요한계시록 1:1-8', p18.reference);
check('fullText 가 절을 공백으로 잇는다', p18.fullText.indexOf(p18.verses[0].text) === 0);

group('범위 검증 (명세 43항)');
check('시작 절 > 종료 절 → 오류 메시지', RevData.checkRange(1, 8, 3) === '시작 절은 종료 절보다 클 수 없습니다.', RevData.checkRange(1, 8, 3));
check('범위를 벗어난 절 → 오류 메시지', /1절부터 20절까지/.test(RevData.checkRange(1, 1, 99) || ''), RevData.checkRange(1, 1, 99));
check('없는 장 → 오류 메시지', RevData.checkRange(23, 1, 2) !== null);
check('정상 범위 → null', RevData.checkRange(2, 1, 7) === null);
check('범위 밖이면 getPassage 가 null', RevData.getPassage(1, 5, 4) === null);

group('테스트 1 — 완전 일치');
const t1 = tally(p18, p18.fullText);
check('100점', t1.score === 100, t1.score);
check('정확 어절 수 = 전체 어절 수', t1.counts.correct === t1.totalTokens, `${t1.counts.correct}/${t1.totalTokens}`);
check('오답·누락·추가가 0', t1.counts.wrong + t1.counts.missing + t1.counts.extra === 0);
check('모든 절이 100점', t1.verses.every(v => v.score === 100));

group('테스트 2 — 단어 하나 오타 (속히 → 속이)');
const pass22 = RevData.getPassage(22, 6, 6);
const p1 = RevData.getPassage(1, 1, 1);
const typo = p1.fullText.replace('속히', '속이');
const t2 = tally(p1, typo);
const opTypo = t2.ops.find(o => o.answer === '속히');
check('입력이 실제로 달라졌다', typo !== p1.fullText);
check('"속히"가 유사(similar)로 분류된다', opTypo && opTypo.type === 'similar', opTypo && opTypo.type);
check('유사도가 0.6 이상', opTypo && opTypo.similarity >= 0.6, opTypo && opTypo.similarity);
check('오답(wrong)으로 처리되지 않는다', t2.counts.wrong === 0, t2.counts.wrong);
check('진단 문구가 붙는다', !!(opTypo && opTypo.issue), opTypo && opTypo.issue);
check('점수가 95점 이상', t2.score >= 95, t2.score);

group('테스트 3 — 단어 누락');
const answer3 = '반드시 속히 될 일을 그 종들에게';
const t3 = RevScorer.score(
  { verses: [{ verse: 1, text: answer3 }], fullText: answer3, reference: 'T', shortReference: 'T', chapter: 1, startVerse: 1, endVerse: 1, charCount: 1 },
  '반드시 될 일을 그 종들에게', {});
const miss = t3.ops.find(o => o.answer === '속히');
check('"속히"가 누락(missing)으로 표시된다', miss && miss.type === 'missing', miss && miss.type);
check('누락 1개', t3.counts.missing === 1, t3.counts.missing);
check('나머지는 모두 정확', t3.counts.correct === 5, t3.counts.correct);

group('테스트 4 — 단어 추가');
const t4 = RevScorer.score(
  { verses: [{ verse: 1, text: answer3 }], fullText: answer3, reference: 'T', shortReference: 'T', chapter: 1, startVerse: 1, endVerse: 1, charCount: 1 },
  '반드시 매우 속히 될 일을 그 종들에게', {});
const extra = t4.ops.find(o => o.type === 'extra');
check('"매우"가 추가(extra)로 표시된다', extra && extra.user === '매우', extra && extra.user);
check('추가 1개', t4.counts.extra === 1, t4.counts.extra);
check('추가는 감점된다 (100점 미만)', t4.score < 100, t4.score);
check('정확 어절은 그대로 6개', t4.counts.correct === 6, t4.counts.correct);

group('테스트 5 — 문장 일부만 입력');
const p15 = RevData.getPassage(1, 1, 5);
const halfText = p15.verses.slice(0, 2).map(v => v.text).join(' ');
const t5 = tally(p15, halfText);
check('누락이 다수 발생한다', t5.counts.missing > 10, t5.counts.missing);
check('앞 두 절은 100점', t5.verses[0].score === 100 && t5.verses[1].score === 100);
check('뒤 세 절은 0점', t5.verses.slice(2).every(v => v.score === 0));
check('점수가 절반 이하', t5.score < 50, t5.score);
check('약한 절 목록에 3·4·5절이 담긴다', t5.weakVerses.join(',') === '3,4,5', t5.weakVerses.join(','));

group('테스트 6 — 줄바꿈 차이');
const withBreaks = p18.verses.map(v => v.text).join('\n\n');
const t6 = tally(p18, withBreaks);
check('줄바꿈만 달라도 100점', t6.score === 100, t6.score);

group('테스트 7 — 공백 차이');
const withSpaces = p18.fullText.replace(/ /g, '   ').replace(/^/, '\t  ') + '   \n ';
const t7 = tally(p18, withSpaces);
check('연속 공백·앞뒤 공백은 무시된다', t7.score === 100, t7.score);

group('추가 — 문장부호 차이');
const punct = p18.fullText.replace(/ /g, ', ') + '.';
const t8 = tally(p18, punct);
check('쉼표·마침표는 기본 설정에서 오답이 아니다', t8.score === 100, t8.score);
const t8s = tally(p18, punct, { strictPunctuation: true });
check('엄격 모드에서는 점수가 내려간다', t8s.score < 100, t8s.score);

group('추가 — 띄어쓰기(어절 붙여쓰기) 진단');
const spacingAnswer = '반드시 속히 될 일을';
const t9 = RevScorer.score(
  { verses: [{ verse: 1, text: spacingAnswer }], fullText: spacingAnswer, reference: 'T', shortReference: 'T', chapter: 1, startVerse: 1, endVerse: 1, charCount: 1 },
  '반드시 속히 될일을', {});
const spaceOp = t9.ops.find(o => o.spacing);
check('띄어쓰기 오류로 진단된다', !!spaceOp, JSON.stringify(t9.ops.map(o => o.type)));
check('오답이 아니라 유사로 처리된다', t9.counts.wrong === 0, t9.counts.wrong);
check('점수가 80점 이상 유지된다', t9.score >= 80, t9.score);

group('유사도 계산 (명세 22항)');
check('속히 vs 속이 → 0.6 이상', RevDiff.similarity('속히', '속이') >= 0.6, RevDiff.similarity('속히', '속이'));
check('속히 vs 사랑 → 0.6 미만', RevDiff.similarity('속히', '사랑') < 0.6, RevDiff.similarity('속히', '사랑'));
check('하나님 vs 하나님이 → 0.6 이상(조사 차이)', RevDiff.similarity('하나님', '하나님이') >= 0.6, RevDiff.similarity('하나님', '하나님이'));
check('같은 단어 → 1', RevDiff.similarity('계시라', '계시라') === 1);
check('빈 문자열 → 0', RevDiff.similarity('', '계시라') === 0);
check('자모 분해가 종성을 포함한다', RevDiff.toJamo('감').length === 3, RevDiff.toJamo('감').length);

group('점수 계산 (명세 21항)');
const wSum = RevScorer.WEIGHTS;
check('정확=1.0, 유사=0.5, 오답=0, 누락=0, 추가=-0.2',
  wSum.correct === 1 && wSum.similar === 0.5 && wSum.wrong === 0 && wSum.missing === 0 && wSum.extra === -0.2);
check('점수는 0~100 사이', t5.score >= 0 && t5.score <= 100);
const hinted = tally(p18, p18.fullText, { hintsUsed: 2, hintPenalty: true });
check('힌트 2단계 사용 시 6점 감점', hinted.score === 94, hinted.score);
const noPenalty = tally(p18, p18.fullText, { hintsUsed: 2, hintPenalty: false });
check('감점 설정을 끄면 100점', noPenalty.score === 100, noPenalty.score);
check('격려 문구가 점수대에 맞는다', RevScorer.messageFor(96).indexOf('완벽') === 0, RevScorer.messageFor(96));

group('빈 입력 / 예외');
const empty = tally(p18, '');
check('빈 입력은 0점', empty.score === 0, empty.score);
check('빈 입력은 전부 누락', empty.counts.missing === empty.totalTokens);
check('공백만 입력해도 오류 없이 0점', tally(p18, '   \n  ').score === 0);
check('아주 긴 입력도 처리된다(잘라서 채점)', (() => {
  const long = new Array(4000).join('아멘 ');
  const r = tally(p18, long);
  return r.truncated === true && r.score >= 0;
})());

group('절별 점수 (명세 36항)');
const mixed = p18.verses.map((v, i) => (i === 2 ? '아멘 아멘 아멘' : v.text)).join(' ');
const t10 = tally(p18, mixed);
check('3절만 점수가 낮다', t10.verses[2].score < 50 && t10.verses[0].score === 100, t10.verses.map(v => v.score).join(','));
check('절별 ops 합이 전체 ops 와 같다',
  t10.verses.reduce((a, v) => a + v.ops.length, 0) === t10.ops.length);
check('약한 절 목록에 3절이 들어 있다', t10.weakVerses.indexOf(3) >= 0, t10.weakVerses.join(','));

group('테스트 8 — 즐겨찾기 (localStorage)');
Store.clearFavorites();
const favId = RevData.rangeId(1, 1, 8);
check('처음엔 즐겨찾기가 없다', Store.getFavorites().length === 0);
check('추가하면 added', Store.addFavorite({ id: favId, chapter: 1, startVerse: 1, endVerse: 8 }) === 'added');
check('중복 추가는 duplicate', Store.addFavorite({ id: favId, chapter: 1, startVerse: 1, endVerse: 8 }) === 'duplicate');
check('저장 후 1개', Store.getFavorites().length === 1);
check('isFavorite 가 true', Store.isFavorite(favId));
check('새로고침(재읽기) 후에도 유지된다', JSON.parse(store['revelation_favorites']).length === 1);
Store.removeFavorite(favId);
check('삭제된다', Store.getFavorites().length === 0);

group('테스트 9 — 학습 기록');
Store.clearHistory();
const rec = Store.saveAttempt({
  chapter: 1, startVerse: 1, endVerse: 8, reference: '계 1:1~8',
  score: 92, accuracy: 0.92, duration: 224, hintsUsed: 0,
  correctCount: 34, similarCount: 2, wrongCount: 1, missingCount: 2, extraCount: 0,
  totalTokens: 39, weakVerses: [3]
});
check('기록이 저장된다', !!rec && rec.score === 92);
check('날짜가 저장된다', !!rec.createdAt && !isNaN(new Date(rec.createdAt).getTime()));
check('소요시간이 저장된다', rec.duration === 224);
check('다시 읽어도 남아 있다', Store.getHistory().length === 1);
Store.saveAttempt({ chapter: 2, startVerse: 1, endVerse: 7, score: 100, accuracy: 1, duration: 120, hintsUsed: 1, weakVerses: [] });
check('여러 건이 최신순으로 쌓인다', Store.getHistory()[0].chapter === 2);

group('통계');
const hist = Store.getHistory();
const summary = RevStats.summarize(hist);
check('총 2회', summary.total === 2, summary.total);
check('최고 점수 100', summary.best === 100);
check('평균 96', summary.average === 96, summary.average);
check('오늘 학습했으므로 연속 1일', summary.streak === 1, summary.streak);
check('총 학습 시간 344초', summary.totalSeconds === 344, summary.totalSeconds);
check('범위 2개', summary.rangeCount === 2);
check('성취 "첫 암송"이 달성된다', RevStats.achievements(summary).find(a => a.id === 'first').earned);
check('성취 "100점 달성"이 달성된다', RevStats.achievements(summary).find(a => a.id === 'score100').earned);
check('성취 "30일 연속"은 아직 미달성', !RevStats.achievements(summary).find(a => a.id === 'streak30').earned);
check('약한 범위에 계 1:1~8 이 먼저 나온다', RevStats.weakestRanges(hist, 2)[0].chapter === 1);
check('자주 틀린 절에 1장 3절', RevStats.weakVerses(hist, 3)[0].verse === 3);
check('시간 표기 00:00 형식', RevStats.formatDuration(224) === '03:44', RevStats.formatDuration(224));
check('시간 표기 1시간 이상', RevStats.formatDuration(3725) === '1:02:05', RevStats.formatDuration(3725));

group('오늘의 암송');
const pick = RevStats.todayPick(hist, Store.getFavorites());
check('추천 범위가 유효하다', RevData.getPassage(pick.chapter, pick.startVerse, pick.endVerse) !== null,
  JSON.stringify(pick));
check('추천 사유가 있다', typeof pick.reason === 'string' && pick.reason.length > 0, pick.reason);
check('오늘 이미 한 범위는 피한다', !(pick.chapter === 2 && pick.startVerse === 1 && pick.endVerse === 7), JSON.stringify(pick));

group('설정 저장');
check('기본값은 힌트 감점 켜짐', Store.getSettings().hintPenalty === true);
Store.saveSettings({ hintPenalty: false });
check('설정 변경이 저장된다', Store.getSettings().hintPenalty === false);
check('알 수 없는 키는 무시된다', Store.saveSettings({ hacked: true }).hacked === undefined);
Store.saveSettings({ hintPenalty: true });

group('백업 내보내기/가져오기');
const backup = Store.exportAll();
check('백업에 즐겨찾기·기록·설정이 담긴다',
  Array.isArray(backup.favorites) && Array.isArray(backup.history) && !!backup.settings);
Store.clearHistory();
Store.importAll(backup);
check('백업을 되돌리면 기록이 복구된다', Store.getHistory().length === 2, Store.getHistory().length);
check('잘못된 백업은 무시된다', Store.importAll(null) === false);

group('본문 데이터 검증기');
check('빈 객체는 실패', RevData.validate({}).ok === false);
check('부분 데이터는 이슈를 보고한다', (() => {
  const v = RevData.validate({ chapters: { '1': { '1': '한 절만' } } });
  return v.ok === true && v.total === 1 && v.issues.length > 0;
})());

/* ============================================================
   확장 기능 — 간격 반복 / 누적 암송 / 음성 / 취합
   ============================================================ */

group('간격 반복 — 점수 → 응답 품질');
check('100점 → 5', RevSRS.qualityFromScore(100) === 5);
check('92점 → 4', RevSRS.qualityFromScore(92) === 4);
check('85점 → 3 (통과 기준)', RevSRS.qualityFromScore(85) === 3);
check('75점 → 2 (실패)', RevSRS.qualityFromScore(75) === 2);
check('30점 → 0', RevSRS.qualityFromScore(30) === 0);
check('통과 기준은 3', RevSRS.CONFIG.PASS_QUALITY === 3);

group('간격 반복 — 일정 계산');
const today = RevStats.todayKey();
let card = { id: 'rev-1-1-8', chapter: 1, startVerse: 1, endVerse: 8, ease: 2.5, interval: 0, reps: 0, lapses: 0, lastScore: 0, last: null, due: today };
const r1 = RevSRS.applyResult(card, 96, today);
check('1회 통과 → 1일 뒤', r1.intervalDays === 1, r1.intervalDays);
check('1회 통과 → 난이도가 올라간다', r1.card.ease > 2.5, r1.card.ease);
const r2 = RevSRS.applyResult(r1.card, 96, today);
check('2회 연속 통과 → 4일 뒤', r2.intervalDays === 4, r2.intervalDays);
const r3 = RevSRS.applyResult(r2.card, 92, today);
check('3회째는 간격 × 난이도', r3.intervalDays === Math.round(4 * r2.card.ease), r3.intervalDays);
const fail1 = RevSRS.applyResult(r3.card, 60, today);
check('실패하면 다음날로 되돌아온다', fail1.intervalDays === 1 && fail1.passed === false, fail1.intervalDays);
check('실패하면 연속 통과 횟수가 0', fail1.card.reps === 0);
check('실패 횟수가 기록된다', fail1.card.lapses === 1);
let hard = { id: 'x', chapter: 1, startVerse: 1, endVerse: 2, ease: 1.3, interval: 1, reps: 5, lapses: 0, lastScore: 0, last: null, due: today };
for (let i = 0; i < 5; i++) hard = RevSRS.applyResult(hard, 40, today).card;
check('난이도 계수 하한 1.3 을 지킨다', hard.ease >= 1.3, hard.ease);
check('날짜 더하기가 맞다', RevSRS.daysBetween(today, RevSRS.addDays(today, 7)) === 7);
check('최대 간격 상한이 있다', RevSRS.CONFIG.MAX_INTERVAL === 180);

group('간격 반복 — 저장소 연동');
Store.clearSrs();
const srsInfo = { id: RevData.rangeId(3, 14, 22), chapter: 3, startVerse: 14, endVerse: 22 };
const rec1 = RevSRS.record(srsInfo, 96);
check('채점 결과가 카드로 저장된다', !!rec1 && RevSRS.list().length === 1);
check('오늘은 아직 복습 대상이 아니다', RevSRS.due().length === 0, RevSRS.due().length);
check('내일은 복습 대상이 된다', RevSRS.due(RevSRS.addDays(today, 1)).length === 1);
check('예정 목록에 뜬다', RevSRS.upcoming(5).length === 1);
check('다음 복습일 문구가 "내일"', RevSRS.dueLabel(RevSRS.get(srsInfo.id)) === '내일',
  RevSRS.dueLabel(RevSRS.get(srsInfo.id)));
check('오답 연습(partial)은 일정에 반영하지 않는다',
  RevSRS.record({ id: 'rev-3-part', chapter: 3, startVerse: 14, endVerse: 15, partial: true }, 100) === null);
check('부분 연습 후에도 카드는 1개', RevSRS.list().length === 1);
const overdue = RevSRS.due(RevSRS.addDays(today, 5));
check('밀린 날짜가 계산된다', overdue[0].overdueDays === 4, overdue[0].overdueDays);
RevSRS.remove(srsInfo.id);
check('카드를 지울 수 있다', RevSRS.list().length === 0);

group('누적 암송 — 계획 진행');
Store.clearPlans();
const plan = RevPlan.start(1, 1, 4);
check('계획이 만들어진다', plan.chapter === 1 && plan.endVerse === 4 && plan.stage === 1);
check('기본 확장 폭은 4절', plan.step === 4);
check('같은 시작점으로 다시 시작해도 하나만 생긴다', RevPlan.start(1, 1, 8).endVerse === 4);
let st = RevPlan.status(RevPlan.get(1, 1));
check('1장 끝은 20절', st.chapterEnd === 20, st.chapterEnd);
check('진행률이 계산된다 (4/20 = 20%)', st.progress === 20, st.progress);
check('아직 확장할 수 없다', st.canAdvance === false);

st = RevPlan.record({ chapter: 1, startVerse: 1, endVerse: 4 }, 85);
check('85점이면 확장 불가', st.canAdvance === false, st.plan.lastScore);
st = RevPlan.record({ chapter: 1, startVerse: 1, endVerse: 4 }, 93);
check('93점이면 확장 가능', st.canAdvance === true);
check('최고 점수가 남는다', st.plan.best === 93, st.plan.best);
check('다음 범위는 1~8절', st.nextEnd === 8, st.nextEnd);
check('현재 단계와 다른 범위 결과는 무시한다',
  RevPlan.record({ chapter: 1, startVerse: 1, endVerse: 12 }, 100) === null);
check('오답 연습(partial)도 무시한다',
  RevPlan.record({ chapter: 1, startVerse: 1, endVerse: 4, partial: true }, 100) === null);

st = RevPlan.advance(1, 1);
check('확장하면 1~8절, 2단계', st.plan.endVerse === 8 && st.plan.stage === 2);
check('확장 후 점수는 초기화된다', st.plan.lastScore === 0);
for (let i = 0; i < 5; i++) {
  RevPlan.record({ chapter: 1, startVerse: 1, endVerse: RevPlan.get(1, 1).endVerse }, 95);
  st = RevPlan.advance(1, 1);
}
check('장 끝(20절)을 넘지 않는다', st.plan.endVerse === 20, st.plan.endVerse);
check('끝에 도달하면 atEnd', st.atEnd === true);
st = RevPlan.record({ chapter: 1, startVerse: 1, endVerse: 20 }, 97);
check('마지막 단계 통과 시 완주 처리', st.cleared === true);
check('진행률 100%', st.progress === 100, st.progress);
check('완주한 계획은 진행 목록에서 빠진다', RevPlan.active(5).filter(x => x.plan.chapter === 1 && x.plan.startVerse === 1).length === 0);
RevPlan.remove(1, 1);
check('계획을 삭제할 수 있다', RevPlan.get(1, 1) === null);

group('음성 암송 래퍼');
check('Node 환경에서는 미지원으로 판정', RevVoice.isSupported() === false);
check('미지원 사유 문구를 돌려준다', /지원하지 않습니다/.test(RevVoice.unavailableReason() || ''),
  RevVoice.unavailableReason());
check('사용 불가일 때 isAvailable 은 false', RevVoice.isAvailable() === false);
check('시작 시도는 조용히 실패한다', RevVoice.start({ onError: () => {} }) === false);
check('문장 잇기 — 공백 하나로', RevVoice.joinText('예수 그리스도의', '계시라') === '예수 그리스도의 계시라');
check('문장 잇기 — 앞이 비면 뒤만', RevVoice.joinText('', '계시라') === '계시라');
check('문장 잇기 — 중복 공백 제거', RevVoice.joinText('계시라   ', '   이는') === '계시라 이는');
check('정지 호출이 안전하다', (() => { RevVoice.stop(); return RevVoice.isListening() === false; })());

/* 안드로이드(갤럭시) 크롬 중복 입력 회귀 방지
   ------------------------------------------------------------
   안드로이드 크롬은 onresult 마다 resultIndex 를 0 으로 주면서 지금까지 확정된
   결과를 통째로 다시 보낸다. 예전 코드는 그것을 뒤에 계속 이어 붙여
   "또 내가 / 또 내가 몸에 / 또 내가 몸에 천사가 …" 처럼 문장이 눈덩이처럼 불었다.
   아래는 그 상황을 그대로 재현해 다시는 재발하지 않는지 확인한다. */
group('음성 인식 결과 조립 (안드로이드 중복 방지)');

function resultList(rows) {
  // rows: [[전사내용, 확정여부], ...]
  var list = rows.map(function (r) { return { 0: { transcript: r[0] }, isFinal: r[1], length: 1 }; });
  list.length = rows.length;
  return list;
}
/** 안드로이드처럼 "누적된 결과 전체"를 여러 번 흘려보낸다. */
function feed(baseText, frames) {
  var store = {};
  var out = { final: baseText, interim: '', combined: baseText };
  frames.forEach(function (rows) {
    RevVoice.absorbResults(store, resultList(rows));
    out = RevVoice.composeText(baseText, store);
  });
  return out;
}

const androidFrames = [
  [['또 내가', true]],
  [['또 내가', true], ['몸에', true]],
  [['또 내가', true], ['몸에', true], ['천사가', true]],
  [['또 내가', true], ['몸에', true], ['천사가', true], ['무저갱', true]]
];
check('누적 결과가 반복 전달돼도 중복되지 않는다',
  feed('', androidFrames).final === '또 내가 몸에 천사가 무저갱',
  feed('', androidFrames).final);

check('같은 결과를 다섯 번 다시 보내도 결과가 같다', (function () {
  var once = feed('', [androidFrames[3]]).final;
  var many = feed('', [androidFrames[3], androidFrames[3], androidFrames[3],
                       androidFrames[3], androidFrames[3]]).final;
  return once === many && once === '또 내가 몸에 천사가 무저갱';
})());

check('부분 인식이 확정으로 바뀌어도 한 번만 남는다',
  feed('', [
    [['무저갱', false]],
    [['무저갱 열쇠와', false]],
    [['무저갱 열쇠와 큰 쇠사슬을', true]]
  ]).final === '무저갱 열쇠와 큰 쇠사슬을');

check('정말 같은 어구를 두 번 말하면 두 번 다 남는다',
  feed('', [[['또 내가 보매', true], ['또 내가 보매', true]]]).final === '또 내가 보매 또 내가 보매');

check('타이핑해 둔 내용 뒤에 이어 붙는다',
  feed('먼저 친 내용', [[['음성 내용', true]]]).final === '먼저 친 내용 음성 내용');

check('확정 전 부분 인식은 interim 으로 분리된다', (function () {
  var r = feed('', [[['천사가', true], ['하늘로서', false]]]);
  return r.final === '천사가' && r.interim === '하늘로서' && r.combined === '천사가 하늘로서';
})());

check('빈 전사 내용은 무시한다',
  feed('', [[['', true], ['천사가', true], ['   ', true]]]).final === '천사가');

check('결과가 없으면 원래 입력만 남는다', feed('원래대로', []).final === '원래대로');

/* 마이크 동작 자체(시작 → 자동 재개 → 종료)는 가짜 인식기를 끼운
   별도 실행 환경에서 확인한다. 기본 sandbox 에는 음성 API 가 없기 때문이다. */
group('음성 인식 동작 — 자동 재개 / 종료');

function voiceRig() {
  const box = {
    console, setTimeout, clearTimeout, Date, Math, JSON,
    Array, Object, String, Number, Boolean, RegExp, Error,
    location: { protocol: 'https:', hostname: 'app.test' },
    isSecureContext: true
  };
  box.window = box; box.global = box;
  let live = null;
  function FakeRecognition() { live = this; }
  FakeRecognition.prototype.start = function () {};
  FakeRecognition.prototype.stop = function () { if (this.onend) this.onend(); };
  box.SpeechRecognition = FakeRecognition;
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/voice.js'), 'utf8'), box, { filename: 'voice.js' });
  return { V: box.RevVoice, rec: () => live };
}

check('보안 컨텍스트에서는 사용 가능으로 판정', voiceRig().V.isAvailable() === true);

check('안드로이드식 누적 전달을 받아도 입력이 부풀지 않는다', (function () {
  const rig = voiceRig();
  let text = '';
  rig.V.start({ onInterim: t => { text = t; }, onFinal: t => { text = t; } }, '');
  const rows = [];
  ['또 내가', '몸에', '천사가', '무저갱', '열쇠와'].forEach(function (u) {
    rows.push({ 0: { transcript: u }, isFinal: true, length: 1 });
    rig.rec().onresult({ resultIndex: 0, results: rows });   // resultIndex 가 항상 0
  });
  return text.trim() === '또 내가 몸에 천사가 무저갱 열쇠와';
})());

check('조용해서 끊기면 이어서 다시 듣는다 (앞 내용 유지)', (function () {
  const rig = voiceRig();
  let text = '', ended = 0;
  rig.V.start({ onFinal: t => { text = t; }, onEnd: () => { ended++; } }, '');
  rig.rec().onresult({ resultIndex: 0, results: [{ 0: { transcript: '첫 문장' }, isFinal: true, length: 1 }] });
  rig.rec().onend();                                          // 안드로이드가 스스로 종료
  rig.rec().onresult({ resultIndex: 0, results: [{ 0: { transcript: '둘째 문장' }, isFinal: true, length: 1 }] });
  return text.trim() === '첫 문장 둘째 문장' && ended === 0 && rig.V.isListening() === true;
})());

check('사용자가 끄면 자동 재개하지 않는다', (function () {
  const rig = voiceRig();
  let ended = 0;
  rig.V.start({ onEnd: () => { ended++; } }, '');
  rig.V.stop();
  return ended === 1 && rig.V.isListening() === false;
})());

check('계속 조용하면 무한 재시도하지 않고 스스로 끝난다', (function () {
  const rig = voiceRig();
  let ended = 0;
  rig.V.start({ onEnd: () => { ended++; } }, '');
  for (let i = 0; i < 12; i++) { if (rig.rec()) rig.rec().onend(); }
  return ended === 1 && rig.V.isListening() === false;
})());

check('마이크 거부는 재개하지 않고 사유를 알린다', (function () {
  const rig = voiceRig();
  let msg = '', ended = 0;
  rig.V.start({ onError: m => { msg = m; }, onEnd: () => { ended++; } }, '');
  rig.rec().onerror({ error: 'not-allowed' });
  rig.rec().onend();
  return /허용되지 않았습니다/.test(msg) && ended === 1 && rig.V.isListening() === false;
})());

check('잠깐 조용한 것(no-speech)은 오류로 알리지 않는다', (function () {
  const rig = voiceRig();
  let msg = '';
  rig.V.start({ onError: m => { msg = m; } }, '');
  rig.rec().onerror({ error: 'no-speech' });
  return msg === '';
})());

group('여러 명 취합');
function fakeBackup(name, rows) {
  return {
    name: name + '.json',
    data: {
      exportedAt: new Date().toISOString(),
      settings: { learnerName: name },
      favorites: [],
      history: rows.map((r, i) => ({
        id: 'a' + i, chapter: r.c, startVerse: r.s, endVerse: r.e,
        reference: '계 ' + r.c + ':' + r.s + '~' + r.e,
        score: r.score, accuracy: r.score / 100, duration: r.dur || 120,
        hintsUsed: 0, weakVerses: r.weak || [], partial: !!r.partial,
        createdAt: new Date().toISOString()
      }))
    }
  };
}

const report = RevReport.aggregate([
  fakeBackup('김성경', [{ c: 1, s: 1, e: 8, score: 96, weak: [] }, { c: 2, s: 1, e: 7, score: 70, weak: [3, 5] }]),
  fakeBackup('이말씀', [{ c: 1, s: 1, e: 8, score: 88, weak: [3] }, { c: 2, s: 1, e: 7, score: 62, weak: [5] }]),
  fakeBackup('박선교', [{ c: 1, s: 1, e: 8, score: 100, weak: [] }])
]);

check('인원 3명', report.totals.learners === 3, report.totals.learners);
check('총 암송 5회', report.totals.attempts === 5, report.totals.attempts);
check('전체 평균이 계산된다', report.totals.average === Math.round((96 + 70 + 88 + 62 + 100) / 5), report.totals.average);
check('최고 점수 100', report.totals.best === 100);
check('평균 높은 사람이 먼저 온다', report.learners[0].name === '박선교', report.learners[0].name);
check('개인별 평균이 맞다', report.learners.find(l => l.name === '김성경').average === 83,
  report.learners.find(l => l.name === '김성경').average);
check('범위는 평균 낮은 순', report.ranges[0].reference === '계 2:1~7', report.ranges[0].reference);
check('범위별 참여 인원이 집계된다', report.ranges[0].learnerCount === 2, report.ranges[0].learnerCount);
check('계 1:1~8 은 3명 참여', report.ranges.find(r => r.reference === '계 1:1~8').learnerCount === 3);
check('90점 이상 비율이 계산된다', report.ranges.find(r => r.reference === '계 1:1~8').passRate === 67,
  report.ranges.find(r => r.reference === '계 1:1~8').passRate);
check('최저 점수가 잡힌다', report.ranges[0].low === 62, report.ranges[0].low);
check('공통 취약절 1위는 2장 5절 (2명)', report.weakVerses[0].reference === '계 2:5', report.weakVerses[0].reference);
check('취약절에 인원 수가 붙는다', report.weakVerses[0].learnerCount === 2);
check('오늘 학습한 인원이 집계된다', report.totals.activeToday === 3, report.totals.activeToday);
check('이름 없는 파일은 파일명을 쓴다',
  RevReport.aggregate([{ name: '홍길동.json', data: { history: [{ chapter: 1, startVerse: 1, endVerse: 2, score: 80, createdAt: new Date().toISOString() }] } }])
    .learners[0].name === '홍길동');
check('기록 없는 파일은 건너뛴다', (() => {
  const r = RevReport.aggregate([{ name: '빈파일.json', data: { history: [] } }]);
  return r.totals.learners === 0 && r.skipped.length === 1;
})());
check('깨진 파일도 앱을 죽이지 않는다', RevReport.aggregate([{ name: 'x.json', data: null }]).skipped.length === 1);
check('빈 입력도 안전하다', RevReport.aggregate([]).totals.learners === 0);
check('오답 연습 기록은 범위 집계에서 빠진다', (() => {
  const r = RevReport.aggregate([fakeBackup('테스트', [{ c: 5, s: 1, e: 3, score: 50, partial: true }])]);
  return r.totals.attempts === 1 && r.ranges.length === 0;
})());

group('취합 CSV');
const csv = RevReport.toCSV(report);
check('BOM 으로 시작한다 (엑셀 한글 깨짐 방지)', csv.charCodeAt(0) === 0xFEFF);
check('인원별 섹션이 있다', csv.indexOf('[ 인원별 현황 ]') > 0);
check('범위별 섹션이 있다', csv.indexOf('[ 범위별 현황') > 0);
check('취약절 섹션이 있다', csv.indexOf('[ 자주 틀리는 절 ]') > 0);
check('참가자 이름이 들어 있다', csv.indexOf('김성경') > 0);
check('쉼표가 든 값은 따옴표로 감싼다', (() => {
  const r = RevReport.aggregate([fakeBackup('김,성경', [{ c: 1, s: 1, e: 2, score: 90 }])]);
  return RevReport.toCSV(r).indexOf('"김,성경"') > 0;
})());
check('줄바꿈은 CRLF', csv.indexOf('\r\n') > 0);

group('설정 확장 (이름 · 새 토글)');
check('기본 이름은 빈 문자열', Store.getSettings().learnerName === '');
check('이름을 저장할 수 있다', Store.saveSettings({ learnerName: '조영호' }).learnerName === '조영호');
check('40자를 넘지 않는다', Store.saveSettings({ learnerName: 'ㄱ'.repeat(60) }).learnerName.length === 40);
check('불리언 설정에 문자열을 넣어도 안전하다', Store.saveSettings({ srsEnabled: 'no' }).srsEnabled === true);
check('음성 입력 기본값은 켜짐', Store.getSettings().voiceInput === true);
check('간격 반복 기본값은 켜짐', Store.getSettings().srsEnabled === true);
Store.saveSettings({ learnerName: '' });

group('백업 v2 (복습·계획 포함)');
Store.clearSrs(); Store.clearPlans();
RevSRS.record({ id: RevData.rangeId(2, 1, 7), chapter: 2, startVerse: 1, endVerse: 7 }, 95);
RevPlan.start(21, 1, 4);
Store.saveSettings({ learnerName: '조영호' });
const backup2 = Store.exportAll();
check('백업에 이름이 들어간다', backup2.learnerName === '조영호');
check('백업에 복습 카드가 들어간다', Object.keys(backup2.srs).length === 1);
check('백업에 누적 계획이 들어간다', Object.keys(backup2.plans).length === 1);
check('백업 버전이 2', backup2.version === 2);
Store.clearSrs(); Store.clearPlans();
Store.importAll(backup2);
check('복원하면 복습 카드가 돌아온다', RevSRS.list().length === 1);
check('복원하면 누적 계획이 돌아온다', RevPlan.all().length === 1);
check('구버전 백업(srs 없음)도 문제없이 복원된다',
  Store.importAll({ favorites: [], history: [], settings: { hintPenalty: true } }) === true);
Store.clearSrs(); Store.clearPlans(); Store.saveSettings({ learnerName: '' });

group('통합 시나리오 — 채점 → 복습 → 확장');
Store.clearHistory(); Store.clearSrs(); Store.clearPlans();
const scenPassage = RevData.getPassage(21, 1, 4);
const scenResult = tally(scenPassage, scenPassage.fullText);
RevPlan.start(21, 1, 4);
const scenInfo = { id: RevData.rangeId(21, 1, 4), chapter: 21, startVerse: 1, endVerse: 4 };
const scenSrs = RevSRS.record(scenInfo, scenResult.score);
const scenPlan = RevPlan.record(scenInfo, scenResult.score);
check('만점이면 복습 통과', scenSrs.passed === true && scenSrs.quality === 5);
check('복습일이 잡힌다', scenSrs.intervalDays >= 1);
check('누적 계획이 확장 가능해진다', scenPlan.canAdvance === true);
const advanced = RevPlan.advance(21, 1);
check('확장된 범위가 실제 본문으로 존재한다',
  RevData.getPassage(advanced.plan.chapter, advanced.plan.startVerse, advanced.plan.endVerse) !== null,
  advanced.plan.startVerse + '-' + advanced.plan.endVerse);
check('21장은 27절이므로 1~8절로 확장', advanced.plan.endVerse === 8, advanced.plan.endVerse);
Store.clearSrs(); Store.clearPlans(); Store.clearHistory();

group('본문 읽기 — 절 선택 규칙');
check('선택이 없으면 그 절 하나만 잡힌다',
  JSON.stringify(RevRead.pickVerse(null, 5)) === JSON.stringify({ start: 5, end: 5 }));
check('두 번째 절을 누르면 범위가 된다',
  JSON.stringify(RevRead.pickVerse({ start: 3, end: 3 }, 7)) === JSON.stringify({ start: 3, end: 7 }));
check('거꾸로 눌러도 앞뒤가 정렬된다',
  JSON.stringify(RevRead.pickVerse({ start: 9, end: 9 }, 4)) === JSON.stringify({ start: 4, end: 9 }));
check('같은 절을 다시 누르면 선택이 풀린다', RevRead.pickVerse({ start: 6, end: 6 }, 6) === null);
check('범위가 잡힌 뒤 누르면 새로 시작한다',
  JSON.stringify(RevRead.pickVerse({ start: 2, end: 8 }, 12)) === JSON.stringify({ start: 12, end: 12 }));
check('0이나 빈 값은 선택을 바꾸지 않는다',
  JSON.stringify(RevRead.pickVerse({ start: 1, end: 3 }, 0)) === JSON.stringify({ start: 1, end: 3 }));
check('선택 라벨 — 단일 절', RevRead.selectionLabel({ start: 4, end: 4 }) === '4절');
check('선택 라벨 — 범위', RevRead.selectionLabel({ start: 4, end: 9 }) === '4~9절');

group('본문 읽기 — 글자 크기');
check('알 수 없는 값은 기본값으로', RevRead.normalizeFont('xl') === 'md');
check('유효한 값은 그대로', RevRead.normalizeFont('lg') === 'lg');
check('한 단계 키우기', RevRead.nextFont('sm') === 'md');
check('가장 큰 다음은 다시 가장 작게', RevRead.nextFont('lg') === 'sm');
check('설정에 글자 크기가 저장된다', Store.saveSettings({ readFontSize: 'lg' }).readFontSize === 'lg');
check('저장한 글자 크기가 다시 읽힌다', Store.getSettings().readFontSize === 'lg');
check('다른 설정을 바꿔도 글자 크기는 유지된다',
  Store.saveSettings({ showTimer: false }).readFontSize === 'lg');
Store.saveSettings({ readFontSize: 'md', showTimer: true });
check('글자 크기 기본값은 보통', Store.getSettings().readFontSize === 'md');

group('본문 읽기 — 절별 익힘 상태');
Store.clearHistory();
Store.saveAttempt({ chapter: 3, startVerse: 1, endVerse: 3, score: 95, reference: '계 3:1-3' });
Store.saveAttempt({ chapter: 3, startVerse: 5, endVerse: 6, score: 62, reference: '계 3:5-6' });
Store.saveAttempt({ chapter: 4, startVerse: 1, endVerse: 2, score: 100, reference: '계 4:1-2' });
const vstats = RevRead.verseStats(Store.getHistory(), 3);
check('범위 안의 모든 절에 기록이 반영된다', !!(vstats[1] && vstats[2] && vstats[3]));
check('90점 이상이면 익힘', vstats[2].status === 'known', vstats[2].status);
check('기준 미달이면 학습 중', vstats[5].status === 'learning', vstats[5].status);
check('시도하지 않은 절은 기록이 없다', vstats[10] === undefined);
check('다른 장의 기록은 섞이지 않는다', RevRead.verseStats(Store.getHistory(), 4)[1].best === 100);
check('최고 점수가 남는다', vstats[1].best === 95, vstats[1].best);
Store.saveAttempt({ chapter: 3, startVerse: 1, endVerse: 1, score: 70, reference: '계 3:1' });
const vstats2 = RevRead.verseStats(Store.getHistory(), 3);
check('낮은 점수를 받아도 최고 점수는 유지된다', vstats2[1].best === 95, vstats2[1].best);
check('마지막 시도 점수는 갱신된다', vstats2[1].last === 70, vstats2[1].last);
check('시도 횟수가 누적된다', vstats2[1].attempts === 2, vstats2[1].attempts);
check('빈 기록이면 빈 객체', JSON.stringify(RevRead.verseStats([], 1)) === '{}');
check('장 번호가 없으면 빈 객체', JSON.stringify(RevRead.verseStats(Store.getHistory(), 0)) === '{}');

group('본문 읽기 — 장 진도');
const prog3 = RevRead.chapterProgress(Store.getHistory(), 3, RevData.getVerseCount(3));
check('3장은 22절', prog3.total === 22, prog3.total);
check('익힘 3절 (1~3절)', prog3.known === 3, prog3.known);
check('학습 중 2절 (5~6절)', prog3.learning === 2, prog3.learning);
check('나머지는 아직', prog3.untouched === 17, prog3.untouched);
check('진도율은 익힌 절 기준', prog3.percent === Math.round((3 / 22) * 100), prog3.percent);
check('기록 없는 장은 0%', RevRead.chapterProgress(Store.getHistory(), 9, 21).percent === 0);
Store.clearHistory();

group('본문 읽기 — 실제 본문 연결');
check('모든 장의 절을 읽을 수 있다', RevData.getChapters().every(function (c) {
  const n = RevData.getVerseCount(c);
  return n > 0 && typeof RevData.getVerse(c, 1) === 'string' && typeof RevData.getVerse(c, n) === 'string';
}));
check('읽기에서 잡은 범위가 암송 본문으로 이어진다', (function () {
  const picked = RevRead.pickVerse(RevRead.pickVerse(null, 2), 5);
  const p = RevData.getPassage(1, picked.start, picked.end);
  return p !== null && p.verses.length === 4 && p.startVerse === 2 && p.endVerse === 5;
})());
check('장 끝을 넘는 절은 본문이 없다', RevData.getPassage(1, 1, 999) === null);

/* ---------- 결과 ---------- */
console.log('\n' + '─'.repeat(52));
if (fail === 0) {
  console.log(`\x1b[32m모든 테스트 통과: ${pass}개\x1b[0m`);
} else {
  console.log(`\x1b[31m실패 ${fail}개\x1b[0m / 통과 ${pass}개`);
  failures.forEach(f => console.log('  · ' + f));
  process.exitCode = 1;
}
