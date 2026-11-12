/* ============================================================
   puzzle.js — 암송 퍼즐 엔진
   ------------------------------------------------------------
   한 절을 가져와 난이도에 따라 몇 개의 어절을 지우고, 지운 말을
   섞어서 보기로 내놓는다. 외운 것을 "써 보기" 전에 "맞춰 보는"
   단계로, 부담 없이 반복하기 좋은 연습이다.

   같은 절·같은 난이도면 **언제나 같은 문제**가 나온다.
   (무작위이되 절·난이도에서 수를 뽑아내는 방식 — 그래야
    이어하기로 돌아왔을 때 풀던 문제가 그대로 남아 있다)

   채점·기록은 암송(scorer.js)과 완전히 분리되어 있다.
   퍼즐 점수는 학습 기록·복습 일정에 섞이지 않는다.
   ============================================================ */
(function (global) {
  'use strict';

  /* 난이도 — 지울 어절의 비율 */
  var LEVELS = [
    { key: 'easy',    label: '초급', ratio: 0.25, hint: '네 어절 중 하나를 지웁니다.' },
    { key: 'normal',  label: '중급', ratio: 0.45, hint: '절반 가까이 지웁니다.' },
    { key: 'hard',    label: '고급', ratio: 0.65, hint: '대부분을 지웁니다.' },
    { key: 'perfect', label: '완벽', ratio: 1.00, hint: '전부 지웁니다. 순서까지 맞춰야 합니다.' }
  ];

  var DEFAULT_LEVEL = 'normal';
  var MODES = ['pick', 'type'];     // 보기에서 고르기 / 직접 입력
  var DEFAULT_MODE = 'pick';

  function levelOf(key) {
    for (var i = 0; i < LEVELS.length; i++) {
      if (LEVELS[i].key === key) return LEVELS[i];
    }
    return levelOf(DEFAULT_LEVEL);
  }
  function normalizeLevel(key) { return levelOf(key).key; }
  function normalizeMode(m) { return MODES.indexOf(m) >= 0 ? m : DEFAULT_MODE; }

  /* ---------- 되풀이 가능한 난수 ----------
     같은 씨앗이면 같은 순서가 나온다. (mulberry32) */

  function seedFrom(chapter, verse, levelKey) {
    var s = 'rev-' + chapter + '-' + verse + '-' + levelKey;
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** 제자리 섞기 (Fisher–Yates) — 주어진 난수만 쓴다. */
  function shuffle(list, rand) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  /* ---------- 문제 만들기 ---------- */

  /**
   * 한 절로 퍼즐을 만든다.
   * @param {number} chapter
   * @param {number} verse
   * @param {string} levelKey
   * @returns {?object} {chapter, verse, level, words, blanks, bank, text}
   */
  function build(chapter, verse, levelKey) {
    var c = Number(chapter), v = Number(verse);
    var text = global.RevData.getVerse(c, v);
    if (!text) return null;

    var lv = levelOf(levelKey);
    var words = String(text).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return null;

    // 지울 개수 — 적어도 하나, 전체를 넘지 않게
    var want = Math.round(words.length * lv.ratio);
    want = Math.max(1, Math.min(words.length, want));

    var rand = rng(seedFrom(c, v, lv.key));
    var order = shuffle(words.map(function (_, i) { return i; }), rand);
    var blanks = order.slice(0, want).sort(function (a, b) { return a - b; });

    // 보기는 지운 말들을 섞어서 (같은 말이 두 번 나와도 그대로 둔다)
    var bank = shuffle(blanks.map(function (i) {
      return { word: words[i], from: i };
    }), rand).map(function (x, i) {
      return { id: i, word: x.word };
    });

    return {
      chapter: c,
      verse: v,
      level: lv.key,
      levelLabel: lv.label,
      text: text,
      words: words,
      blanks: blanks,          // 지운 자리의 어절 번호 (오름차순)
      bank: bank,              // 섞인 보기 [{id, word}]
      total: blanks.length
    };
  }

  /* ---------- 채점 ---------- */

  /** 비교용 키 — 문장부호와 대소문자를 무시한다. (diff.js 와 같은 규칙) */
  function keyOf(word) {
    if (!word) return '';
    if (global.RevDiff && global.RevDiff.tokenKey) {
      return global.RevDiff.tokenKey(String(word).trim(), false);
    }
    return String(word).trim().toLowerCase();
  }

  /**
   * 빈칸에 채워 넣은 답을 매긴다.
   * @param {object} puzzle build() 결과
   * @param {Object} filled {어절번호: 사용자가 넣은 말}
   * @returns {{results:Array, correct:number, total:number, score:number, cleared:boolean}}
   */
  function check(puzzle, filled) {
    var answers = filled || {};
    var results = [];
    var correct = 0;

    for (var i = 0; i < puzzle.blanks.length; i++) {
      var idx = puzzle.blanks[i];
      var want = puzzle.words[idx];
      var got = answers[idx];
      var ok = !!got && keyOf(got) === keyOf(want);
      if (ok) correct++;
      results.push({
        index: idx,
        answer: want,
        user: got || '',
        correct: ok,
        empty: !got
      });
    }

    var total = puzzle.blanks.length;
    return {
      results: results,
      correct: correct,
      total: total,
      score: total ? Math.round((correct / total) * 100) : 0,
      cleared: correct === total
    };
  }

  /** 아직 쓰지 않은 보기만 남긴다.
      쓴 자리는 어절 번호로 기록되는데 첫 어절은 0이라 거짓값이다.
      값으로 판단하면 첫 칸에 넣은 보기가 목록에 그대로 남는다. 키가 있는지로 판단한다. */
  function remainingBank(puzzle, filledIds) {
    var used = filledIds || {};
    return puzzle.bank.filter(function (b) {
      return !Object.prototype.hasOwnProperty.call(used, b.id);
    });
  }

  /* ---------- 진도 저장 ----------
     퍼즐은 학습 기록과 섞지 않는다. 자기 저장소만 쓴다. */

  var BEST_LIMIT = 600;

  function progressKey(chapter, verse, levelKey) {
    return chapter + '-' + verse + '-' + normalizeLevel(levelKey);
  }

  function load() {
    var raw = global.Store.getPuzzle();
    return {
      chapter: Number(raw.chapter) || 1,
      verse: Number(raw.verse) || 1,
      level: normalizeLevel(raw.level),
      mode: normalizeMode(raw.mode),
      best: (raw.best && typeof raw.best === 'object') ? raw.best : {}
    };
  }

  /** 지금 보고 있는 자리를 기억해 둔다. (이어하기) */
  function savePosition(chapter, verse, levelKey, mode) {
    var st = load();
    st.chapter = Number(chapter) || st.chapter;
    st.verse = Number(verse) || st.verse;
    st.level = normalizeLevel(levelKey);
    st.mode = normalizeMode(mode);
    global.Store.savePuzzle(st);
    return st;
  }

  /** 푼 결과를 남긴다. 더 잘 푼 경우에만 점수를 갱신한다. */
  function record(puzzle, outcome) {
    var st = load();
    var k = progressKey(puzzle.chapter, puzzle.verse, puzzle.level);
    var prev = st.best[k] || { score: 0, tries: 0, cleared: false };

    st.best[k] = {
      score: Math.max(Number(prev.score) || 0, outcome.score),
      tries: (Number(prev.tries) || 0) + 1,
      cleared: !!prev.cleared || !!outcome.cleared,
      at: new Date().toISOString()
    };

    // 너무 많이 쌓이면 오래된 것부터 버린다.
    var keys = Object.keys(st.best);
    if (keys.length > BEST_LIMIT) {
      keys.sort(function (a, b) {
        return String(st.best[a].at || '').localeCompare(String(st.best[b].at || ''));
      });
      for (var i = 0; i < keys.length - BEST_LIMIT; i++) delete st.best[keys[i]];
    }

    st.chapter = puzzle.chapter;
    st.verse = puzzle.verse;
    st.level = puzzle.level;
    global.Store.savePuzzle(st);
    return st.best[k];
  }

  function bestOf(chapter, verse, levelKey) {
    var st = load();
    return st.best[progressKey(chapter, verse, levelKey)] || null;
  }

  /** 한 장에서 몇 절을 깼는지 — 진도 표시용 */
  function chapterProgress(chapter, levelKey) {
    var st = load();
    var n = global.RevData.getVerseCount(chapter) || 0;
    var cleared = 0;
    for (var v = 1; v <= n; v++) {
      var b = st.best[progressKey(chapter, v, levelKey)];
      if (b && b.cleared) cleared++;
    }
    return { total: n, cleared: cleared, percent: n ? Math.round((cleared / n) * 100) : 0 };
  }

  /* ---------- 절 이동 ---------- */

  /**
   * 다음/이전 절로 옮긴다. 장의 끝을 넘으면 이웃 장으로 넘어간다.
   * @returns {?{chapter,verse}} 더 갈 곳이 없으면 null
   */
  function step(chapter, verse, delta) {
    var c = Number(chapter), v = Number(verse) + (delta > 0 ? 1 : -1);
    var chapters = global.RevData.getChapters();
    if (!chapters.length) return null;

    if (v < 1) {
      var prev = c - 1;
      if (chapters.indexOf(prev) < 0) return null;
      return { chapter: prev, verse: global.RevData.getVerseCount(prev) || 1 };
    }
    if (v > (global.RevData.getVerseCount(c) || 0)) {
      var next = c + 1;
      if (chapters.indexOf(next) < 0) return null;
      return { chapter: next, verse: 1 };
    }
    return { chapter: c, verse: v };
  }

  global.RevPuzzle = {
    LEVELS: LEVELS,
    MODES: MODES,
    DEFAULT_LEVEL: DEFAULT_LEVEL,
    DEFAULT_MODE: DEFAULT_MODE,
    levelOf: levelOf,
    normalizeLevel: normalizeLevel,
    normalizeMode: normalizeMode,
    shuffle: shuffle,
    seedFrom: seedFrom,
    build: build,
    check: check,
    keyOf: keyOf,
    remainingBank: remainingBank,
    load: load,
    savePosition: savePosition,
    record: record,
    bestOf: bestOf,
    chapterProgress: chapterProgress,
    progressKey: progressKey,
    step: step
  };
})(window);
