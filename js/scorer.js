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
    spacing: 0.9,
    // 말은 맞게 알고 있었고 자리만 바꿔 쓴 경우.
    // 본문 자리 쪽은 대부분 인정하고, 잘못 쓴 자리 쪽은 깎지 않는다(이중 감점 방지).
    moved: 0.8,
    movedExtra: 0
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

  /* ---------- 오답 유형 요약 ----------
     "몇 개 틀렸다"보다 "어떤 식으로 틀렸다"가 다음 암송에 도움이 된다.
     조사만 계속 틀리는 사람과 통째로 빠뜨리는 사람은 처방이 다르다. */

  var ISSUE_KINDS = [
    { key: 'spacing',  label: '띄어쓰기',   hint: '내용은 맞지만 어절을 붙이거나 나눠 썼습니다. 감점은 거의 없습니다.' },
    { key: 'moved',    label: '순서 바뀜',  hint: '말은 맞게 알고 있는데 놓은 자리가 다릅니다.' },
    { key: 'particle', label: '조사·어미',  hint: '단어는 맞는데 끝이 다릅니다. (…을/…를, …하시니/…하시매)' },
    { key: 'typo',     label: '오타',       hint: '거의 맞았고 글자 하나 정도가 다릅니다.' },
    { key: 'missing',  label: '빠뜨림',     hint: '본문에 있는 말을 쓰지 않았습니다.' },
    { key: 'extra',    label: '잘못 넣음',  hint: '본문에 없는 말을 넣었습니다.' },
    { key: 'other',    label: '다른 표현',  hint: '본문과 다른 말을 썼습니다. 뜻은 비슷해도 표현이 다릅니다.' }
  ];

  /** 어절 하나가 어떤 종류의 실수인지 가른다. */
  function issueKind(op) {
    if (!op || op.type === 'correct') return null;
    if (op.spacing) return 'spacing';
    if (op.moved) return 'moved';
    if (op.type === 'missing') return 'missing';
    if (op.type === 'extra') return 'extra';
    var issue = op.issue || '';
    if (issue.indexOf('조사') >= 0) return 'particle';
    if (issue.indexOf('오타') >= 0) return 'typo';
    return 'other';
  }

  /**
   * 틀린 어절들을 유형별로 세어 많은 순으로 돌려준다.
   * @returns {Array<{key,label,hint,count}>}
   */
  function issueSummary(ops) {
    if (!Array.isArray(ops)) return [];
    var tally = {};
    for (var i = 0; i < ops.length; i++) {
      var k = issueKind(ops[i]);
      if (!k) continue;
      tally[k] = (tally[k] || 0) + 1;
    }
    return ISSUE_KINDS
      .filter(function (d) { return tally[d.key] > 0; })
      .map(function (d) {
        return { key: d.key, label: d.label, hint: d.hint, count: tally[d.key] };
      })
      .sort(function (a, b) { return b.count - a.count; });
  }

  /**
   * 정답 토큰 인덱스 → 절 번호 매핑을 만든다.
   * fullText 는 각 절을 공백으로 이은 것이므로 절별 토큰 수의 합과 일치한다.
   */
  function buildVerseMap(passage, strict, keepNums) {
    var map = [];
    var verseInfo = [];
    for (var i = 0; i < passage.verses.length; i++) {
      var v = passage.verses[i];
      var tokens = global.RevDiff.tokenize(v.text, strict, keepNums);
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
    // 기본값은 "절 번호를 세지 않음". 설정에서 켜면 숫자도 본문처럼 채점한다.
    var keepNums = !!opts.countVerseNumbers;

    var diff = global.RevDiff.compare(passage.fullText, userText, {
      strictPunctuation: strict,
      countVerseNumbers: keepNums
    });
    var vm = buildVerseMap(passage, strict, keepNums);

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

      var w;
      if (op.spacing) w = WEIGHTS.spacing;
      else if (op.moved) w = (op.type === 'extra') ? WEIGHTS.movedExtra : WEIGHTS.moved;
      else w = WEIGHTS[op.type] || 0;
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
      issues: issueSummary(diff.ops),
      verses: perVerse,
      weakVerses: weakVerses
    };
  }

  global.RevScorer = {
    WEIGHTS: WEIGHTS,
    HINT_PENALTY: HINT_PENALTY,
    ISSUE_KINDS: ISSUE_KINDS,
    messageFor: messageFor,
    issueKind: issueKind,
    issueSummary: issueSummary,
    score: score
  };
})(window);
