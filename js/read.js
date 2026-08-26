/* ============================================================
   read.js — 본문 읽기(공부) 화면의 계산 담당
   ------------------------------------------------------------
   책임
     · 학습 기록으로부터 "절별 익힘 상태" 계산
     · 읽기 화면에서의 범위 선택(첫 번째 절 → 두 번째 절) 정규화
     · 글자 크기 설정값 검증
   화면 그리기는 ui.js, 상태 보관은 app.js 가 맡는다.
   ============================================================ */
(function (global) {
  'use strict';

  /* 절 하나의 익힘 상태를 가르는 기준 점수 */
  var CONFIG = {
    KNOWN_SCORE: 90,   // 이 점수 이상으로 암송한 적이 있으면 '익힘'
    LEARNING_SCORE: 1  // 시도한 적은 있으나 아직 기준 미달이면 '학습 중'
  };

  var FONT_SIZES = ['sm', 'md', 'lg'];
  var DEFAULT_FONT = 'md';

  function normalizeFont(value) {
    return FONT_SIZES.indexOf(value) >= 0 ? value : DEFAULT_FONT;
  }

  /** 글자 크기를 한 단계 키운다(가장 큰 상태면 다시 가장 작게). */
  function nextFont(value) {
    var i = FONT_SIZES.indexOf(normalizeFont(value));
    return FONT_SIZES[(i + 1) % FONT_SIZES.length];
  }

  /**
   * 한 장의 절별 학습 현황을 집계한다.
   * 암송 기록은 범위(시작절~종료절) 단위이므로, 범위에 포함된 모든 절에 점수를 반영한다.
   * @param {Array} history Store.getHistory()
   * @param {number} chapter
   * @returns {Object} { 절번호: {attempts, best, last, status} }
   */
  function verseStats(history, chapter) {
    var c = Number(chapter);
    var out = {};
    if (!Array.isArray(history) || !c) return out;

    // 최신 기록이 앞에 오므로 뒤에서부터 훑어야 last 가 진짜 마지막 시도가 된다.
    for (var i = history.length - 1; i >= 0; i--) {
      var h = history[i];
      if (!h || Number(h.chapter) !== c) continue;
      var s = Number(h.startVerse), e = Number(h.endVerse);
      if (!s || !e || s > e) continue;
      var score = Number(h.score) || 0;

      for (var v = s; v <= e; v++) {
        var cur = out[v];
        if (!cur) { cur = out[v] = { attempts: 0, best: 0, last: 0 }; }
        cur.attempts++;
        if (score > cur.best) cur.best = score;
        cur.last = score;
      }
    }

    for (var k in out) {
      if (!Object.prototype.hasOwnProperty.call(out, k)) continue;
      out[k].status = statusOf(out[k]);
    }
    return out;
  }

  /** @returns {'known'|'learning'|'none'} */
  function statusOf(stat) {
    if (!stat || !stat.attempts) return 'none';
    if (stat.best >= CONFIG.KNOWN_SCORE) return 'known';
    return 'learning';
  }

  /** 한 장의 진도(익힌 절 수 / 전체 절 수)를 요약한다. */
  function chapterProgress(history, chapter, verseCount) {
    var stats = verseStats(history, chapter);
    var total = Number(verseCount) || 0;
    var known = 0, learning = 0;
    for (var v = 1; v <= total; v++) {
      var st = stats[v];
      if (!st) continue;
      if (st.status === 'known') known++;
      else if (st.status === 'learning') learning++;
    }
    return {
      total: total,
      known: known,
      learning: learning,
      untouched: Math.max(0, total - known - learning),
      percent: total ? Math.round((known / total) * 100) : 0
    };
  }

  /**
   * 읽기 화면에서 절을 눌러 범위를 잡는 규칙.
   *  · 선택이 없으면       → 그 절 하나만 선택
   *  · 시작만 있으면       → 두 절을 잇는 범위로 확정(순서 무관)
   *  · 이미 범위가 있으면  → 처음부터 다시 그 절 하나만 선택
   *  · 선택된 단일 절을 다시 누르면 → 선택 해제
   * @param {?{start:number,end:number}} current
   * @param {number} verse
   * @returns {?{start:number,end:number}} null 이면 선택 없음
   */
  function pickVerse(current, verse) {
    var v = Number(verse);
    if (!v) return current || null;

    if (!current) return { start: v, end: v };

    var isSingle = current.start === current.end;
    if (isSingle) {
      if (current.start === v) return null;                     // 같은 절 재클릭 → 해제
      return { start: Math.min(current.start, v), end: Math.max(current.start, v) };
    }
    return { start: v, end: v };                                 // 범위 확정 상태 → 새로 시작
  }

  function selectionLabel(sel) {
    if (!sel) return '';
    return (sel.start === sel.end) ? (sel.start + '절') : (sel.start + '~' + sel.end + '절');
  }

  global.RevRead = {
    CONFIG: CONFIG,
    FONT_SIZES: FONT_SIZES,
    DEFAULT_FONT: DEFAULT_FONT,
    normalizeFont: normalizeFont,
    nextFont: nextFont,
    verseStats: verseStats,
    statusOf: statusOf,
    chapterProgress: chapterProgress,
    pickVerse: pickVerse,
    selectionLabel: selectionLabel
  };
})(window);
