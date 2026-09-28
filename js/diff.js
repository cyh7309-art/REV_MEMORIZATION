/* ============================================================
   diff.js — 텍스트 비교 엔진
   ------------------------------------------------------------
   · 정규화 → 어절 토큰화 → LCS diff → 오류 유형 판정
   · 한국어 특성을 고려해 유사도를 "자모 단위" 레벤슈타인으로 계산한다.
     (속히 / 속이 는 글자 단위로는 0.5지만 자모 단위로는 0.83)
   · 입력 방식(타이핑·음성)에 의존하지 않는 순수 함수 모음이다.
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 조정 가능한 상수 ---------- */
  var CONFIG = {
    SIMILAR_MIN: 0.60,   // 이 값 이상이면 '유사', 미만이면 '오답'
    NEAR_EXACT: 0.85,    // 이 값 이상이면 단순 오타로 안내
    MAX_INPUT_RATIO: 3   // 정답 대비 입력이 지나치게 길면 잘라서 비교
  };

  /* 비교 시 무시할 문장부호 */
  var PUNCT = /[.,!?;:'"“”‘’`´()\[\]{}<>·…–—\-~]/g;

  /* 절 번호 표시로 보이는 어절.
     시험지처럼 "1 예수 그리스도의 … 2 요한은 …" 으로 절을 나눠 적는 경우를 위해
     숫자만으로 된 어절은 본문이 아니라 절 번호로 보고 채점에서 제외한다.
     개역한글 요한계시록 본문에는 아라비아 숫자가 한 글자도 없으므로
     (수는 모두 '십사만 사천' 처럼 한글로 적혀 있다) 본문과 충돌할 여지가 없다.
     인식 예: 1  1.  1)  (1)  [1]  1:  1절  제1절  20:1  １ */
  var VERSE_NUMBER = /^(?:제)?[0-9０-９]{1,4}(?:절|장)?$/;

  function isVerseNumber(token) {
    if (!token) return false;
    var bare = String(token).replace(PUNCT, '').replace(/\s/g, '');
    if (!bare) return false;
    return VERSE_NUMBER.test(bare);
  }

  /* ---------- 정규화 ---------- */

  function normalizeText(text) {
    if (typeof text !== 'string') return '';
    var s = text;
    try { s = s.normalize('NFC'); } catch (e) { /* 구형 브라우저 */ }
    return s.replace(/\s+/g, ' ').trim();
  }

  /** 토큰 비교용 키. strict가 아니면 문장부호를 무시한다. */
  function tokenKey(token, strict) {
    var t = token;
    if (!strict) t = t.replace(PUNCT, '');
    return t.toLowerCase();
  }

  /**
   * 어절 단위 토큰화.
   * @param {string} text
   * @param {boolean} strict 문장부호까지 엄격히 비교할지
   * @param {boolean} [keepVerseNumbers] true 면 절 번호 어절도 채점에 포함한다
   * @returns {Array<{raw:string, key:string}>}
   */
  function tokenize(text, strict, keepVerseNumbers) {
    var norm = normalizeText(text);
    if (!norm) return [];
    var parts = norm.split(' ');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var raw = parts[i];
      if (!raw) continue;
      if (!keepVerseNumbers && isVerseNumber(raw)) continue;   // 절 번호는 채점 대상이 아니다
      var key = tokenKey(raw, strict);
      if (!key) continue;          // 문장부호만 있는 토큰은 버린다
      out.push({ raw: raw, key: key });
    }
    return out;
  }

  /* ---------- 한글 자모 분해 ---------- */

  var BASE = 0xAC00, LAST = 0xD7A3;

  function toJamo(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code >= BASE && code <= LAST) {
        var idx = code - BASE;
        out.push(0x1100 + ((idx / 588) | 0));            // 초성
        out.push(0x1161 + ((((idx % 588)) / 28) | 0));   // 중성
        var jong = idx % 28;
        if (jong > 0) out.push(0x11A7 + jong);           // 종성
      } else {
        out.push(code);
      }
    }
    return out;
  }

  /* ---------- 레벤슈타인 거리 ---------- */

  function levenshtein(a, b) {
    var n = a.length, m = b.length;
    if (n === 0) return m;
    if (m === 0) return n;
    var prev = new Array(m + 1), cur = new Array(m + 1), i, j;
    for (j = 0; j <= m; j++) prev[j] = j;
    for (i = 1; i <= n; i++) {
      cur[0] = i;
      for (j = 1; j <= m; j++) {
        var cost = (a[i - 1] === b[j - 1]) ? 0 : 1;
        var d = prev[j] + 1;
        var ins = cur[j - 1] + 1;
        var sub = prev[j - 1] + cost;
        cur[j] = d < ins ? (d < sub ? d : sub) : (ins < sub ? ins : sub);
      }
      var t = prev; prev = cur; cur = t;
    }
    return prev[m];
  }

  /**
   * 두 어절의 유사도 (0~1). 자모 단위로 비교한다.
   */
  function similarity(a, b) {
    if (a === b) return 1;
    if (!a || !b) return 0;
    var ja = toJamo(a), jb = toJamo(b);
    var max = Math.max(ja.length, jb.length);
    if (!max) return 0;
    return 1 - (levenshtein(ja, jb) / max);
  }

  /* ---------- 오류 유형 진단 ---------- */

  function diagnose(answer, user, sim) {
    if (!answer) return '입력에만 있는 단어입니다.';
    if (!user) return '입력에서 빠졌습니다.';
    var a = answer, u = user;
    if (a.indexOf(u) === 0 || u.indexOf(a) === 0) {
      return '조사·어미 차이로 보입니다.';
    }
    if (sim >= CONFIG.NEAR_EXACT) return '오타로 보입니다.';
    if (sim >= CONFIG.SIMILAR_MIN) return '비슷하지만 정확히 일치하지 않습니다.';
    return '다른 단어입니다.';
  }

  /* ---------- LCS ---------- */

  /**
   * 두 토큰 배열의 공통 부분 수열을 찾아 블록 목록으로 돌려준다.
   * @returns {Array<{type:'equal'|'replace', a:number[], b:number[]}>} 인덱스 블록
   */
  function lcsBlocks(aKeys, bKeys) {
    var n = aKeys.length, m = bKeys.length;
    var i, j;

    // 앞뒤로 동일한 부분은 DP 없이 빠르게 처리한다.
    var head = 0;
    while (head < n && head < m && aKeys[head] === bKeys[head]) head++;
    var tail = 0;
    while (tail < (n - head) && tail < (m - head) &&
           aKeys[n - 1 - tail] === bKeys[m - 1 - tail]) tail++;

    var aMid = aKeys.slice(head, n - tail);
    var bMid = bKeys.slice(head, m - tail);
    var nn = aMid.length, mm = bMid.length;

    var blocks = [];
    function pushEqual(aIdx, bIdx) {
      var last = blocks[blocks.length - 1];
      if (last && last.type === 'equal') { last.a.push(aIdx); last.b.push(bIdx); }
      else blocks.push({ type: 'equal', a: [aIdx], b: [bIdx] });
    }
    function pushDel(aIdx) {
      var last = blocks[blocks.length - 1];
      if (last && last.type === 'replace') { last.a.push(aIdx); }
      else blocks.push({ type: 'replace', a: [aIdx], b: [] });
    }
    function pushIns(bIdx) {
      var last = blocks[blocks.length - 1];
      if (last && last.type === 'replace') { last.b.push(bIdx); }
      else blocks.push({ type: 'replace', a: [], b: [bIdx] });
    }

    for (i = 0; i < head; i++) pushEqual(i, i);

    if (nn === 0 || mm === 0) {
      for (i = 0; i < nn; i++) pushDel(head + i);
      for (j = 0; j < mm; j++) pushIns(head + j);
    } else {
      // 메모리 보호: 지나치게 큰 비교는 정방향 정렬로 대체한다.
      if (nn * mm > 6000000) {
        var len = Math.max(nn, mm);
        for (var k = 0; k < len; k++) {
          if (k < nn && k < mm && aMid[k] === bMid[k]) pushEqual(head + k, head + k);
          else {
            if (k < nn) pushDel(head + k);
            if (k < mm) pushIns(head + k);
          }
        }
      } else {
        var w = mm + 1;
        var dp = new Uint32Array((nn + 1) * w);
        for (i = nn - 1; i >= 0; i--) {
          for (j = mm - 1; j >= 0; j--) {
            dp[i * w + j] = (aMid[i] === bMid[j])
              ? dp[(i + 1) * w + (j + 1)] + 1
              : Math.max(dp[(i + 1) * w + j], dp[i * w + (j + 1)]);
          }
        }
        i = 0; j = 0;
        while (i < nn && j < mm) {
          if (aMid[i] === bMid[j]) { pushEqual(head + i, head + j); i++; j++; }
          else if (dp[(i + 1) * w + j] >= dp[i * w + (j + 1)]) { pushDel(head + i); i++; }
          else { pushIns(head + j); j++; }
        }
        while (i < nn) { pushDel(head + i); i++; }
        while (j < mm) { pushIns(head + j); j++; }
      }
    }

    for (i = 0; i < tail; i++) pushEqual(n - tail + i, m - tail + i);
    return blocks;
  }

  /* ---------- 블록 내부 정렬 ---------- */

  function joinKeys(tokens, idxList) {
    var s = '';
    for (var i = 0; i < idxList.length; i++) s += tokens[idxList[i]].key;
    return s;
  }

  /**
   * replace 블록(정답 쪽 누락 후보 + 입력 쪽 추가 후보)을 짝지어
   * similar / wrong / missing / extra 로 분류한다.
   */
  function resolveBlock(aTokens, bTokens, aIdx, bIdx, out) {
    var i, j;

    if (aIdx.length === 0) {
      for (j = 0; j < bIdx.length; j++) {
        out.push(makeOp('extra', null, bTokens[bIdx[j]], -1, bIdx[j], 0));
      }
      return;
    }
    if (bIdx.length === 0) {
      for (i = 0; i < aIdx.length; i++) {
        out.push(makeOp('missing', aTokens[aIdx[i]], null, aIdx[i], -1, 0));
      }
      return;
    }

    // (1) 띄어쓰기 오류: 붙여 쓰거나 잘라 쓴 경우 — 내용은 같다.
    if ((aIdx.length > 1 || bIdx.length > 1) &&
        joinKeys(aTokens, aIdx) === joinKeys(bTokens, bIdx)) {
      var span = aIdx.map(function (x) { return aTokens[x].raw; }).join(' ');
      var uspan = bIdx.map(function (x) { return bTokens[x].raw; }).join(' ');
      for (i = 0; i < aIdx.length; i++) {
        var op = makeOp('similar', aTokens[aIdx[i]], (i === 0 ? bTokens[bIdx[0]] : null), aIdx[i], (i === 0 ? bIdx[0] : -1), 0.95);
        op.issue = '띄어쓰기(어절 구분) 오류입니다.';
        op.answerSpan = span;
        op.userSpan = uspan;
        op.spacing = true;
        out.push(op);
      }
      return;
    }

    // (2) 일반적인 경우: 유사도 기반 정렬(Needleman-Wunsch)
    var n = aIdx.length, m = bIdx.length;
    var pairs;
    if (n * m > 40000) {
      pairs = [];
      var len = Math.max(n, m);
      for (i = 0; i < len; i++) pairs.push([i < n ? i : -1, i < m ? i : -1]);
    } else {
      pairs = alignBySimilarity(aTokens, bTokens, aIdx, bIdx);
    }

    for (var p = 0; p < pairs.length; p++) {
      var ai = pairs[p][0], bi = pairs[p][1];
      if (ai >= 0 && bi >= 0) {
        var at = aTokens[aIdx[ai]], bt = bTokens[bIdx[bi]];
        var sim = similarity(at.key, bt.key);
        var type = (sim >= CONFIG.SIMILAR_MIN) ? 'similar' : 'wrong';
        var o = makeOp(type, at, bt, aIdx[ai], bIdx[bi], sim);
        o.issue = diagnose(at.raw, bt.raw, sim);
        out.push(o);
      } else if (ai >= 0) {
        out.push(makeOp('missing', aTokens[aIdx[ai]], null, aIdx[ai], -1, 0));
      } else if (bi >= 0) {
        out.push(makeOp('extra', null, bTokens[bIdx[bi]], -1, bIdx[bi], 0));
      }
    }
  }

  var GAP = -0.35; // 짝을 짓지 않고 건너뛸 때의 비용

  function alignBySimilarity(aTokens, bTokens, aIdx, bIdx) {
    var n = aIdx.length, m = bIdx.length, i, j;
    var w = m + 1;
    var score = new Float32Array((n + 1) * w);
    var back = new Uint8Array((n + 1) * w); // 1=대각, 2=위(정답 건너뜀), 3=왼(입력 건너뜀)

    for (i = 1; i <= n; i++) { score[i * w] = score[(i - 1) * w] + GAP; back[i * w] = 2; }
    for (j = 1; j <= m; j++) { score[j] = score[j - 1] + GAP; back[j] = 3; }

    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        var sim = similarity(aTokens[aIdx[i - 1]].key, bTokens[bIdx[j - 1]].key);
        var diag = score[(i - 1) * w + (j - 1)] + (sim - 0.25); // 유사할수록 짝짓기가 이득
        var up = score[(i - 1) * w + j] + GAP;
        var left = score[i * w + (j - 1)] + GAP;
        var best = diag, dir = 1;
        if (up > best) { best = up; dir = 2; }
        if (left > best) { best = left; dir = 3; }
        score[i * w + j] = best;
        back[i * w + j] = dir;
      }
    }

    var pairs = [];
    i = n; j = m;
    while (i > 0 || j > 0) {
      var d = back[i * w + j];
      if (i > 0 && j > 0 && d === 1) { pairs.push([i - 1, j - 1]); i--; j--; }
      else if (i > 0 && (d === 2 || j === 0)) { pairs.push([i - 1, -1]); i--; }
      else { pairs.push([-1, j - 1]); j--; }
    }
    pairs.reverse();
    return pairs;
  }

  function makeOp(type, aTok, bTok, aIndex, bIndex, sim) {
    return {
      type: type,
      answer: aTok ? aTok.raw : '',
      user: bTok ? bTok.raw : '',
      answerIndex: (typeof aIndex === 'number') ? aIndex : -1,
      userIndex: (typeof bIndex === 'number') ? bIndex : -1,
      similarity: Math.round((sim || 0) * 1000) / 1000,
      issue: null,
      spacing: false,
      moved: false
    };
  }

  /* ============================================================
     다듬기 단계 — 정렬이 끝난 뒤 사람이 보기에 억울한 판정을 바로잡는다.
     ============================================================ */

  /* 띄어쓰기 한 덩어리로 묶어볼 어절 수의 상한 (계산량 보호) */
  var SPACING_WINDOW = 4;
  /* 순서가 바뀐 어절을 찾아볼 거리 (어절 수) */
  var MOVE_WINDOW = 10;

  function opAnswerKey(op, strict) {
    return op.answer ? tokenKey(op.answer, strict) : '';
  }
  function opUserKey(op, strict) {
    return op.user ? tokenKey(op.user, strict) : '';
  }

  /**
   * (1) 한 낱말을 둘로 나눠 썼거나 두 낱말을 붙여 쓴 경우를 띄어쓰기로 되돌린다.
   *
   * 블록 전체가 정확히 들어맞을 때만 잡던 기존 검사는, 같은 블록에 다른 실수가
   * 섞여 있으면 놓쳤다. (예: "증거하였느니라" → "증거 하였느니라" 를 쓰면서
   * 뒤에 군말을 덧붙인 경우 → '잘못 넣음' + '비슷함' 으로 두 번 깎였다)
   * 그래서 정렬이 끝난 뒤 이어진 몇 개의 어절을 묶어 다시 한 번 살핀다.
   */
  function mergeSpacingOps(ops, strict) {
    var out = [];
    var i = 0;

    while (i < ops.length) {
      var matched = 0;

      for (var size = 2; size <= SPACING_WINDOW && i + size <= ops.length; size++) {
        var aStr = '', uStr = '', aCount = 0, uCount = 0, hasDiff = false, already = false;

        for (var k = i; k < i + size; k++) {
          var op = ops[k];
          if (op.spacing) { already = true; break; }   // 이미 띄어쓰기로 처리된 구간
          var ak = opAnswerKey(op, strict), uk = opUserKey(op, strict);
          if (ak) { aStr += ak; aCount++; }
          if (uk) { uStr += uk; uCount++; }
          if (op.type !== 'correct') hasDiff = true;
        }
        if (already) break;

        // 붙였거나 나눠 쓴 경우만 (어절 수가 같으면 단순 오타이므로 그대로 둔다)
        if (hasDiff && aStr && aStr === uStr && aCount !== uCount && aCount > 0) {
          var answerSpan = [], userSpan = [], answerOps = [];
          for (var q = i; q < i + size; q++) {
            if (ops[q].answer) { answerSpan.push(ops[q].answer); answerOps.push(ops[q]); }
            if (ops[q].user) userSpan.push(ops[q].user);
          }
          var aSpan = answerSpan.join(' '), uSpan = userSpan.join(' ');

          for (var r = 0; r < answerOps.length; r++) {
            var src = answerOps[r];
            var made = {
              type: 'similar',
              answer: src.answer,
              user: (r === 0 ? uSpan : ''),
              answerIndex: src.answerIndex,
              userIndex: (r === 0 ? src.userIndex : -1),
              similarity: 0.95,
              issue: '띄어쓰기(어절 구분) 오류입니다.',
              spacing: true,
              answerSpan: aSpan,
              userSpan: uSpan
            };
            out.push(made);
          }
          matched = size;
          break;
        }
      }

      if (matched) { i += matched; }
      else { out.push(ops[i]); i++; }
    }
    return out;
  }

  /**
   * (2) 같은 말을 자리만 바꿔 쓴 경우를 찾아 "순서 바뀜"으로 표시한다.
   *
   * 예전에는 원래 자리에서 '빠뜨림', 엉뚱한 자리에서 '잘못 넣음' 으로
   * 한 번의 실수가 두 번 깎였다. 말 자체는 알고 있었으므로 그만큼은 인정한다.
   */
  function markMovedOps(ops, strict) {
    for (var i = 0; i < ops.length; i++) {
      var a = ops[i];
      if (a.moved) continue;
      if (a.type !== 'missing' && a.type !== 'extra') continue;

      var wantType = (a.type === 'missing') ? 'extra' : 'missing';
      var aKey = (a.type === 'missing') ? opAnswerKey(a, strict) : opUserKey(a, strict);
      if (!aKey) continue;

      var limit = Math.min(ops.length, i + 1 + MOVE_WINDOW);
      for (var j = i + 1; j < limit; j++) {
        var b = ops[j];
        if (b.moved || b.type !== wantType) continue;
        var bKey = (b.type === 'missing') ? opAnswerKey(b, strict) : opUserKey(b, strict);
        if (bKey !== aKey) continue;

        // 짝을 찾았다 — 본문 자리 쪽과 잘못 쓴 자리 쪽을 각각 표시한다.
        var slot = (a.type === 'missing') ? a : b;   // 본문에 있어야 할 자리
        var wrote = (a.type === 'missing') ? b : a;  // 실제로 쓴 자리

        slot.type = 'similar';
        slot.moved = true;
        slot.similarity = 1;
        slot.user = wrote.user;
        slot.issue = '순서가 바뀌었습니다. 이 말은 다른 자리에 쓰셨습니다.';

        wrote.moved = true;
        wrote.issue = '순서가 바뀌었습니다. 본문에서는 이 자리가 아닙니다.';
        break;
      }
    }
    return ops;
  }

  /**
   * 정답 텍스트와 사용자 입력을 비교한다.
   * @returns {{ops:Array, answerTokens:Array, userTokens:Array}}
   */
  function compare(answerText, userText, options) {
    var opts = options || {};
    var strict = !!opts.strictPunctuation;
    var keepNums = !!opts.countVerseNumbers;

    var aTokens = tokenize(answerText, strict, keepNums);
    var bTokens = tokenize(userText, strict, keepNums);

    // 비정상적으로 긴 입력은 잘라서 비교한다(브라우저 보호).
    var cap = Math.max(50, aTokens.length * CONFIG.MAX_INPUT_RATIO);
    var truncated = false;
    if (bTokens.length > cap) { bTokens = bTokens.slice(0, cap); truncated = true; }

    var aKeys = aTokens.map(function (t) { return t.key; });
    var bKeys = bTokens.map(function (t) { return t.key; });

    var blocks = lcsBlocks(aKeys, bKeys);
    var ops = [];

    for (var k = 0; k < blocks.length; k++) {
      var blk = blocks[k];
      if (blk.type === 'equal') {
        for (var x = 0; x < blk.a.length; x++) {
          ops.push(makeOp('correct', aTokens[blk.a[x]], bTokens[blk.b[x]], blk.a[x], blk.b[x], 1));
        }
      } else {
        resolveBlock(aTokens, bTokens, blk.a, blk.b, ops);
      }
    }

    // 정렬이 끝난 뒤, 사람이 보기에 억울한 판정을 바로잡는다.
    ops = mergeSpacingOps(ops, strict);
    ops = markMovedOps(ops, strict);

    return {
      ops: ops,
      answerTokens: aTokens,
      userTokens: bTokens,
      truncated: truncated
    };
  }

  global.RevDiff = {
    CONFIG: CONFIG,
    normalizeText: normalizeText,
    tokenize: tokenize,
    isVerseNumber: isVerseNumber,
    tokenKey: tokenKey,
    toJamo: toJamo,
    levenshtein: levenshtein,
    similarity: similarity,
    diagnose: diagnose,
    mergeSpacingOps: mergeSpacingOps,
    markMovedOps: markMovedOps,
    compare: compare
  };
})(window);
