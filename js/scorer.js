/* ============================================================
   scorer.js — 채점 엔진
   ------------------------------------------------------------
   · diff 결과를 점수와 절별 통계로 환산한다.
   · 입력 방식과 무관하다. (타이핑이든 음성인식 결과든 문자열만 받는다)
   ============================================================ */
(function (global) {
  'use strict';

  /* 어절 1개당 가중치 — 실제 훈련 결과를 보며 조정할 수 있도록 분리해 둔다. */
  var WEIGHTS = {
    correct: 1.0,
    similar: 0.5,
    wrong: 0.0,
    missing: 0.0,
    extra: -0.2,
    // 내용은 같고 띄어쓰기만 다른 경우는 '유사'로 표시하되 거의 감점하지 않는다.
    // (명세 18항: 띄어쓰기 차이로 지나치게 엄격하게 오답 처리하지 않는다)
    spacing: 0.9
  };

  var HINT_PENALTY = {
    perLevel: 3,   // 힌트 단계마다 감점
    max: 10        // 최대 감점
  };

  var MESSAGES = [
    { min: 95, text: '완벽에 가까운 암송입니다. 이 범위는 몸에 익었습니다.' },
    { min: 90, text: '아주 좋습니다. 조금만 더 다듬으면 완전해집니다.' },
    { min: 80, text: '좋습니다. 틀린 부분을 다시 확인해보세요.' },
    { min: 70, text: '핵심 내용은 잘 기억하고 있습니다. 세부 표현을 손보면 됩니다.' },
    { min: 0,  text: '틀린 부분을 중심으로 한 번 더 암송해보세요. 반복이 실력을 만듭니다.' }
  ];

  function messageFor(score) {
    for (var i = 0; i < MESSAGES.length; i++) {
      if (score >= MESSAGES[i].min) return MESSAGES[i].text;
    }
    return MESSAGES[MESSAGES.length - 1].text;
  }

  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }

  /**
   * 정답 토큰 인덱스 → 절 번호 매핑을 만든다.
   * fullText 는 각 절을 공백으로 이은 것이므로 절별 토큰 수의 합과 일치한다.
   */
  function buildVerseMap(passage, strict) {
    var map = [];
    var verseInfo = [];
    for (var i = 0; i < passage.verses.length; i++) {
      var v = passage.verses[i];
      var tokens = global.RevDiff.tokenize(v.text, strict);
      verseInfo.push({
        verse: v.verse,
        text: v.text,
        tokenCount: tokens.length,
        startIndex: map.length
      });
      for (var j = 0; j < tokens.length; j++) map.push(i);
    }
    return { map: map, verses: verseInfo };
  }

  /**
   * 채점한다.
   * @param {object} passage RevData.getPassage() 결과
   * @param {string} userText 사용자가 입력한 암송문
   * @param {object} options {hintsUsed, hintPenalty, strictPunctuation}
   */
  function score(passage, userText, options) {
    var opts = options || {};
    var strict = !!opts.strictPunctuation;

    var diff = global.RevDiff.compare(passage.fullText, userText, { strictPunctuation: strict });
    var vm = buildVerseMap(passage, strict);

    var counts = { correct: 0, similar: 0, wrong: 0, missing: 0, extra: 0 };
    var totalAnswer = diff.answerTokens.length;

    // 절별 집계 그릇
    var perVerse = vm.verses.map(function (info) {
      return {
        verse: info.verse,
        text: info.text,
        tokenCount: info.tokenCount,
        correct: 0, similar: 0, wrong: 0, missing: 0, extra: 0,
        earned: 0,
        score: 0,
        ops: []
      };
    });

    var lastVerseIdx = 0;
    var earned = 0;

    for (var i = 0; i < diff.ops.length; i++) {
      var op = diff.ops[i];
      counts[op.type]++;

      var vIdx;
      if (op.answerIndex >= 0) {
        vIdx = vm.map[op.answerIndex];
        if (vIdx === undefined) vIdx = lastVerseIdx;
        lastVerseIdx = vIdx;
      } else {
        vIdx = lastVerseIdx; // 추가 입력은 직전 절에 붙인다
      }

      var w = op.spacing ? WEIGHTS.spacing : (WEIGHTS[op.type] || 0);
      earned += w;

      var pv = perVerse[vIdx];
      if (pv) {
        pv[op.type]++;
        pv.earned += w;
        op.verse = pv.verse;
        pv.ops.push(op);
      }
    }

    for (var k = 0; k < perVerse.length; k++) {
      var v = perVerse[k];
      v.score = v.tokenCount > 0
        ? Math.round(clamp(v.earned / v.tokenCount, 0, 1) * 100)
        : 0;
    }

    var rawScore = totalAnswer > 0 ? (earned / totalAnswer) * 100 : 0;

    var hintsUsed = Number(opts.hintsUsed) || 0;
    var penalty = 0;
    if (opts.hintPenalty && hintsUsed > 0) {
      penalty = Math.min(HINT_PENALTY.max, hintsUsed * HINT_PENALTY.perLevel);
    }

    var finalScore = clamp(Math.round(rawScore - penalty), 0, 100);
    var accuracy = totalAnswer > 0 ? counts.correct / totalAnswer : 0;

    var weakVerses = perVerse
      .filter(function (v) { return v.tokenCount > 0 && v.score < 80; })
      .map(function (v) { return v.verse; });

    return {
      passage: passage,
      reference: passage.reference,
      shortReference: passage.shortReference,
      chapter: passage.chapter,
      startVerse: passage.startVerse,
      endVerse: passage.endVerse,

      score: finalScore,
      rawScore: Math.round(rawScore),
      penalty: penalty,
      hintsUsed: hintsUsed,
      accuracy: accuracy,
      message: messageFor(finalScore),

      counts: counts,
      totalTokens: totalAnswer,
      userTokens: diff.userTokens.length,
      truncated: diff.truncated,

      ops: diff.ops,
      verses: perVerse,
      weakVerses: weakVerses
    };
  }

  global.RevScorer = {
    WEIGHTS: WEIGHTS,
    HINT_PENALTY: HINT_PENALTY,
    messageFor: messageFor,
    score: score
  };
})(window);
