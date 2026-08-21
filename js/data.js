/* ============================================================
   data.js — 성경 본문 데이터 접근 계층
   ------------------------------------------------------------
   책임
     · 본문 데이터 로딩 (사용자 업로드 > fetch(JSON) > 내장 JS)
     · 데이터 유효성 검증
     · 장/절 메타데이터 제공
     · 범위(장, 시작절, 종료절) → 본문 추출
   이 파일 밖에서는 본문 데이터의 저장 형태를 알 필요가 없다.
   ============================================================ */
(function (global) {
  'use strict';

  /* 요한계시록의 실제 장별 절 수 (검증용 기준표) */
  var REFERENCE_VERSE_COUNT = {
    1: 20, 2: 29, 3: 22, 4: 11, 5: 14, 6: 17, 7: 17, 8: 13,
    9: 21, 10: 11, 11: 19, 12: 17, 13: 18, 14: 20, 15: 8, 16: 21,
    17: 18, 18: 24, 19: 21, 20: 15, 21: 27, 22: 21
  };

  var CHAPTER_COUNT = 22;

  var state = {
    data: null,
    origin: 'none',   // 'custom' | 'bundled' | 'fetched' | 'none'
    demo: true,
    issues: []
  };

  /* ---------- 검증 ---------- */

  function validate(raw) {
    var issues = [];
    if (!raw || typeof raw !== 'object') {
      return { ok: false, issues: ['본문 데이터가 객체 형식이 아닙니다.'], verseCounts: {}, total: 0 };
    }
    if (!raw.chapters || typeof raw.chapters !== 'object') {
      return { ok: false, issues: ['chapters 항목이 없습니다.'], verseCounts: {}, total: 0 };
    }

    var counts = {};
    var total = 0;

    for (var c = 1; c <= CHAPTER_COUNT; c++) {
      var ch = raw.chapters[String(c)];
      if (!ch || typeof ch !== 'object') { counts[c] = 0; continue; }
      var n = 0;
      // 1절부터 연속으로 존재하는 절만 유효한 것으로 본다.
      while (typeof ch[String(n + 1)] === 'string' && ch[String(n + 1)].trim() !== '') { n++; }
      counts[c] = n;
      total += n;
      var expected = REFERENCE_VERSE_COUNT[c];
      if (n !== expected) {
        issues.push(c + '장: ' + n + '절 (실제 요한계시록은 ' + expected + '절)');
      }
    }

    return { ok: total > 0, issues: issues, verseCounts: counts, total: total };
  }

  /* ---------- 로딩 ---------- */

  function adopt(raw, origin) {
    var v = validate(raw);
    if (!v.ok) return false;
    state.data = raw;
    state.origin = origin;
    state.issues = v.issues;
    state.verseCounts = v.verseCounts;
    state.total = v.total;
    // 22장 404절이 모두 갖춰졌을 때만 정식 데이터로 간주한다.
    state.demo = (v.issues.length > 0) || raw.demo === true;
    return true;
  }

  /**
   * 본문 데이터를 준비한다.
   * 우선순위: 사용자가 업로드한 데이터 → 내장 데이터 → fetch로 읽은 JSON
   * (file:// 로 열면 fetch가 막히므로 내장 JS 데이터가 기본 경로다.)
   */
  function init(customData) {
    if (customData && adopt(customData, 'custom')) return Promise.resolve(state);
    if (global.REVELATION_DATA && adopt(global.REVELATION_DATA, 'bundled')) return Promise.resolve(state);

    if (typeof fetch === 'function') {
      return fetch('data/revelation_kor.json')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (json) { if (json) adopt(json, 'fetched'); return state; })
        .catch(function () { return state; });
    }
    return Promise.resolve(state);
  }

  /* ---------- 조회 ---------- */

  function isReady() { return !!state.data; }
  function isDemo() { return state.demo; }
  function getIssues() { return state.issues.slice(); }
  function getOrigin() { return state.origin; }
  function getVersion() { return (state.data && state.data.version) || '알 수 없음'; }
  function getBook() { return (state.data && state.data.book) || '요한계시록'; }
  function getSourceNote() { return (state.data && state.data.source) || ''; }
  function getTotalVerses() { return state.total || 0; }
  function getChapters() {
    var out = [];
    for (var c = 1; c <= CHAPTER_COUNT; c++) { if (getVerseCount(c) > 0) out.push(c); }
    return out;
  }
  function getVerseCount(chapter) {
    var c = Number(chapter);
    if (!state.verseCounts) return 0;
    return state.verseCounts[c] || 0;
  }
  function getVerse(chapter, verse) {
    if (!state.data) return null;
    var ch = state.data.chapters[String(chapter)];
    if (!ch) return null;
    var t = ch[String(verse)];
    return (typeof t === 'string' && t.trim()) ? t.trim() : null;
  }

  function formatRef(chapter, startVerse, endVerse) {
    var base = getBook() + ' ' + chapter + ':' + startVerse;
    return (Number(startVerse) === Number(endVerse)) ? base : base + '-' + endVerse;
  }
  function shortRef(chapter, startVerse, endVerse) {
    var base = '계 ' + chapter + ':' + startVerse;
    return (Number(startVerse) === Number(endVerse)) ? base : base + '~' + endVerse;
  }
  function rangeId(chapter, startVerse, endVerse) {
    return 'rev-' + chapter + '-' + startVerse + '-' + endVerse;
  }

  /**
   * 범위 검증. 문제가 없으면 null, 있으면 사용자에게 보여줄 메시지를 돌려준다.
   */
  function checkRange(chapter, startVerse, endVerse) {
    var c = Number(chapter), s = Number(startVerse), e = Number(endVerse);
    if (!isReady()) return '본문 데이터가 아직 준비되지 않았습니다.';
    if (!c || !s || !e) return '장과 절을 모두 선택해주세요.';
    var max = getVerseCount(c);
    if (!max) return '선택한 범위의 본문을 찾을 수 없습니다. (' + c + '장)';
    if (s > e) return '시작 절은 종료 절보다 클 수 없습니다.';
    if (s < 1 || e > max) return c + '장은 1절부터 ' + max + '절까지 있습니다.';
    return null;
  }

  /**
   * 범위의 본문을 추출한다.
   * @returns {{reference,shortReference,chapter,startVerse,endVerse,verses,fullText,charCount,id}}
   */
  function getPassage(chapter, startVerse, endVerse) {
    var err = checkRange(chapter, startVerse, endVerse);
    if (err) return null;

    var c = Number(chapter), s = Number(startVerse), e = Number(endVerse);
    var verses = [];
    for (var v = s; v <= e; v++) {
      var text = getVerse(c, v);
      if (text === null) return null;
      verses.push({ verse: v, text: text });
    }
    var full = verses.map(function (x) { return x.text; }).join(' ');

    return {
      id: rangeId(c, s, e),
      book: getBook(),
      chapter: c,
      startVerse: s,
      endVerse: e,
      reference: formatRef(c, s, e),
      shortReference: shortRef(c, s, e),
      verses: verses,
      fullText: full,
      charCount: full.replace(/\s/g, '').length
    };
  }

  global.RevData = {
    CHAPTER_COUNT: CHAPTER_COUNT,
    REFERENCE_VERSE_COUNT: REFERENCE_VERSE_COUNT,
    init: init,
    validate: validate,
    isReady: isReady,
    isDemo: isDemo,
    getIssues: getIssues,
    getOrigin: getOrigin,
    getVersion: getVersion,
    getBook: getBook,
    getSourceNote: getSourceNote,
    getTotalVerses: getTotalVerses,
    getChapters: getChapters,
    getVerseCount: getVerseCount,
    getVerse: getVerse,
    getPassage: getPassage,
    checkRange: checkRange,
    formatRef: formatRef,
    shortRef: shortRef,
    rangeId: rangeId
  };
})(window);
