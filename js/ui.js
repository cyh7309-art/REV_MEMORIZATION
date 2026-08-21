/* ============================================================
   ui.js — 화면 렌더링
   ------------------------------------------------------------
   · 각 화면의 HTML 문자열을 만든다. 이벤트 연결은 app.js가 담당.
   · 사용자 입력은 반드시 escapeHtml()을 거쳐 삽입한다. (XSS 방지)
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 기본 유틸 ---------- */

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function scoreClass(n) { return n >= 90 ? 's-good' : (n >= 70 ? 's-mid' : 's-low'); }
  function barColor(n) { return n >= 90 ? 'var(--ok)' : (n >= 70 ? 'var(--warn)' : 'var(--bad)'); }

  /* ---------- 토스트 / 모달 ---------- */

  function toast(message, isError) {
    var wrap = document.getElementById('toastWrap');
    if (!wrap) return;
    // 안내가 겹쳐 쌓이지 않도록 최대 3개까지만 유지한다.
    while (wrap.children.length >= 3) wrap.removeChild(wrap.firstChild);
    var el = document.createElement('div');
    el.className = 'toast' + (isError ? ' bad' : '');
    el.textContent = message;
    wrap.appendChild(el);
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2600);
  }

  function openModal(title, bodyHtml) {
    var back = document.getElementById('modalBack');
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHtml;
    back.hidden = false;
    document.getElementById('modalClose').focus();
  }
  function closeModal() { document.getElementById('modalBack').hidden = true; }

  function setBusy(on) { document.getElementById('busy').hidden = !on; }

  /* ---------- 힌트 텍스트 ---------- */

  var CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

  function toChosung(text) {
    var out = '';
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (code >= 0xAC00 && code <= 0xD7A3) out += CHO[((code - 0xAC00) / 588) | 0];
      else out += text.charAt(i);
    }
    return out;
  }

  function maskWords(text) {
    return text.split(' ').map(function (w) {
      if (w.length <= 1) return w;
      return w.charAt(0) + new Array(w.length).join('_');
    }).join(' ');
  }

  function firstWords(text, n) {
    var parts = text.split(' ');
    var head = parts.slice(0, n).join(' ');
    var rest = parts.slice(n).map(function (w) { return new Array(w.length + 1).join('_'); }).join(' ');
    return rest ? (head + ' ' + rest) : head;
  }

  var HINT_LABELS = ['', '1단계 · 첫 자음(초성)', '2단계 · 첫 글자만 공개', '3단계 · 각 절의 앞부분 공개'];
  var HINT_MAX = 3;

  function buildHint(passage, level) {
    if (!level) return '';
    return passage.verses.map(function (v) {
      var body;
      if (level === 1) body = toChosung(v.text);
      else if (level === 2) body = maskWords(v.text);
      else body = firstWords(v.text, 3);
      return '<span class="hint-verse"><i>' + v.verse + '</i>' + escapeHtml(body) + '</span>';
    }).join('');
  }

  /* ---------- 홈 ---------- */

  function renderHome(ctx) {
    var s = ctx.summary;
    var html = '';

    html += '<div class="hero">' +
      '<div class="hero-label">🔥 오늘의 암송</div>' +
      '<div class="hero-ref">' + escapeHtml(ctx.pick.reference) + '</div>' +
      '<p class="hero-meta">' + escapeHtml(ctx.pick.reason) + ' · ' + ctx.pick.verseCount + '절 · ' + ctx.pick.charCount + '자</p>' +
      '<div class="btn-row">' +
        '<button class="btn btn-gold" data-action="start-today" type="button">암송 시작</button>' +
        '<button class="btn btn-ghost" data-action="go-select" type="button">다른 범위 고르기</button>' +
      '</div>' +
    '</div>';

    if (ctx.due && ctx.due.length) {
      html += '<div class="card card-accent" style="margin-top:16px">' +
        '<div class="card-head"><h2 class="card-title"><span class="lead">🔁</span>오늘 복습할 범위 ' +
          '<span class="pill">' + ctx.due.length + '</span></h2>' +
          '<button class="card-link" data-action="go-history" type="button">일정 보기</button></div>' +
        '<ul class="list">' + ctx.due.slice(0, 4).map(function (c) {
          return '<li class="row"><button class="row-main" data-action="open-range" data-c="' + c.chapter +
            '" data-s="' + c.startVerse + '" data-e="' + c.endVerse + '" type="button">' +
            '<span class="row-ref">' + escapeHtml(global.RevData.shortRef(c.chapter, c.startVerse, c.endVerse)) + '</span>' +
            '<span class="row-meta">' + (c.overdueDays > 0 ? c.overdueDays + '일 밀림' : '오늘이 복습일') +
            ' · 지난 점수 ' + c.lastScore + '점 · ' + c.reps + '회 통과</span></button>' +
            '<span class="row-score ' + (c.overdueDays > 2 ? 's-low' : 's-mid') + '">복습</span></li>';
        }).join('') + '</ul>' +
        '<p class="muted" style="margin:10px 0 0">점수에 따라 다음 복습일이 자동으로 조정됩니다. (간격 반복)</p>' +
        '</div>';
    }

    if (ctx.plans && ctx.plans.length) {
      html += '<div class="card" style="margin-top:16px">' +
        '<div class="card-head"><h2 class="card-title"><span class="lead">🧱</span>누적 암송 진행</h2>' +
        '<button class="card-link" data-action="go-select" type="button">계획 관리</button></div>' +
        '<ul class="list">' + ctx.plans.map(planRow).join('') + '</ul></div>';
    }

    html += '<div class="card" style="margin-top:16px">' +
      '<div class="card-head"><h2 class="card-title"><span class="lead">📈</span>나의 학습 현황</h2>' +
      (s.total ? '<button class="card-link" data-action="go-history" type="button">자세히 보기</button>' : '') + '</div>' +
      '<div class="stat-grid">' +
        stat(s.total, '회', '총 암송 횟수') +
        stat(s.best, '점', '최고 점수') +
        stat(s.average, '점', '평균 점수') +
        stat(s.streak, '일', '연속 학습') +
      '</div>' +
      (s.total ? '<p class="muted" style="margin:12px 0 0">총 학습 시간 ' +
        escapeHtml(global.RevStats.formatDurationKo(s.totalSeconds)) +
        ' · 오늘 ' + s.todayCount + '회 · 암송한 범위 ' + s.rangeCount + '개</p>' : '') +
    '</div>';

    html += '<div class="grid-2" style="margin-top:16px">';

    html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">🕘</span>최근 암송</h2>' +
      (ctx.recent.length ? '<button class="card-link" data-action="go-history" type="button">전체</button>' : '') + '</div>';
    html += ctx.recent.length ? ('<ul class="list">' + ctx.recent.map(historyRow).join('') + '</ul>')
                              : '<p class="empty">아직 암송 기록이 없습니다.<br>오늘의 암송으로 시작해보세요.</p>';
    html += '</div>';

    html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">⭐</span>즐겨찾기</h2>' +
      (ctx.favorites.length ? '<button class="card-link" data-action="go-favorites" type="button">관리</button>' : '') + '</div>';
    html += ctx.favorites.length ? ('<ul class="list">' + ctx.favorites.slice(0, 5).map(function (f) {
        return '<li class="row"><button class="row-main" data-action="open-range" data-c="' + f.chapter +
          '" data-s="' + f.startVerse + '" data-e="' + f.endVerse + '" type="button">' +
          '<span class="row-ref">⭐ ' + escapeHtml(global.RevData.shortRef(f.chapter, f.startVerse, f.endVerse)) + '</span>' +
          '<span class="row-meta">' + (f.endVerse - f.startVerse + 1) + '절</span></button></li>';
      }).join('') + '</ul>')
      : '<p class="empty">자주 암송하는 범위를 즐겨찾기에 담아두면<br>여기서 바로 시작할 수 있습니다.</p>';
    html += '</div>';

    html += '</div>';

    if (ctx.weakVerses.length) {
      html += '<div class="card" style="margin-top:16px">' +
        '<div class="card-head"><h2 class="card-title"><span class="lead">🩹</span>자주 틀리는 절</h2></div>' +
        '<div class="chips">' + ctx.weakVerses.map(function (w) {
          return '<button class="chip" data-action="open-range" data-c="' + w.chapter + '" data-s="' + w.verse +
            '" data-e="' + w.verse + '" type="button">계 ' + w.chapter + ':' + w.verse + ' · ' + w.count + '회</button>';
        }).join('') + '</div></div>';
    }

    return html;
  }

  function planRow(st) {
    var p = st.plan;
    return '<li class="row">' +
      '<button class="row-main" data-action="open-range" data-c="' + p.chapter +
      '" data-s="' + p.startVerse + '" data-e="' + p.endVerse + '" type="button">' +
      '<span class="row-ref">' + escapeHtml(global.RevData.shortRef(p.chapter, p.startVerse, p.endVerse)) +
      ' <span class="pill">' + p.stage + '단계</span></span>' +
      '<span class="row-meta">' + p.chapter + '장 ' + st.doneVerses + '/' + st.totalVerses + '절' +
      (p.lastScore ? ' · 최근 ' + p.lastScore + '점' : ' · 아직 채점 전') +
      (st.canAdvance ? ' · <b>확장 가능</b>' : '') + '</span>' +
      '<span class="bar" style="margin-top:6px"><i style="width:' + st.progress + '%;background:var(--gold)"></i></span>' +
      '</button>' +
      (st.canAdvance
        ? '<button class="btn btn-sm btn-gold" data-action="plan-advance" data-c="' + p.chapter +
          '" data-s="' + p.startVerse + '" type="button">확장</button>'
        : '') +
      '</li>';
  }

  function stat(num, unit, label) {
    return '<div class="stat"><div class="stat-num">' + num + '<small>' + unit + '</small></div>' +
           '<div class="stat-label">' + label + '</div></div>';
  }

  function historyRow(h) {
    return '<li class="row">' +
      '<button class="row-main" data-action="open-range" data-c="' + h.chapter + '" data-s="' + h.startVerse +
      '" data-e="' + h.endVerse + '" type="button">' +
      '<span class="row-ref">' + escapeHtml(global.RevData.shortRef(h.chapter, h.startVerse, h.endVerse)) + '</span>' +
      '<span class="row-meta">' + escapeHtml(global.RevStats.formatDate(h.createdAt)) +
      ' · ' + escapeHtml(global.RevStats.formatDuration(h.duration)) +
      (h.hintsUsed ? ' · 힌트 ' + h.hintsUsed : '') + '</span></button>' +
      '<span class="row-score ' + scoreClass(h.score) + '">' + h.score + '점</span></li>';
  }

  /* ---------- 범위 선택 ---------- */

  function renderSelect(ctx) {
    var chapters = global.RevData.getChapters();
    var maxVerse = global.RevData.getVerseCount(ctx.chapter) || 1;

    function options(list, selected) {
      return list.map(function (n) {
        return '<option value="' + n + '"' + (Number(n) === Number(selected) ? ' selected' : '') + '>' + n + '</option>';
      }).join('');
    }
    var verses = [];
    for (var v = 1; v <= maxVerse; v++) verses.push(v);

    var html = '<div class="page-head"><h1 class="page-title">암송 범위 선택</h1>' +
      '<p class="page-sub">' + escapeHtml(global.RevData.getBook()) + ' · ' + escapeHtml(global.RevData.getVersion()) + '</p></div>';

    html += '<div class="card">' +
      '<div class="selector">' +
        '<div class="field"><label for="selChapter">장</label>' +
          '<select id="selChapter" data-role="chapter">' + options(chapters, ctx.chapter) + '</select></div>' +
        '<div class="field"><label for="selStart">시작 절</label>' +
          '<select id="selStart" data-role="start">' + options(verses, ctx.startVerse) + '</select></div>' +
        '<div class="field"><label for="selEnd">종료 절</label>' +
          '<select id="selEnd" data-role="end">' + options(verses, ctx.endVerse) + '</select></div>' +
      '</div>';

    if (ctx.error) {
      html += '<p class="err" role="alert">' + escapeHtml(ctx.error) + '</p>';
    } else if (ctx.preview) {
      html += '<div class="preview"><b>' + escapeHtml(ctx.preview.reference) + '</b> · ' +
        ctx.preview.verses.length + '절 · 약 ' + ctx.preview.charCount + '자' +
        (ctx.preview.lastScore !== null ? ' · 최근 점수 ' + ctx.preview.lastScore + '점' : '') + '</div>';
    }

    html += '<div class="btn-row" style="margin-top:16px">' +
      '<button class="btn btn-primary" data-action="start" type="button"' + (ctx.error ? ' disabled' : '') + '>암송 시작</button>' +
      '<button class="btn btn-ghost" data-action="toggle-fav" type="button"' + (ctx.error ? ' disabled' : '') + '>' +
        (ctx.isFavorite ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기에 추가') + '</button>' +
      '<button class="btn btn-ghost" data-action="whole-chapter" type="button">' + ctx.chapter + '장 전체</button>' +
    '</div></div>';

    /* 누적 암송 */
    html += '<div class="card"><div class="card-head">' +
      '<h2 class="card-title"><span class="lead">🧱</span>누적 암송</h2></div>' +
      '<p class="muted" style="margin:-4px 0 12px">짧은 범위부터 시작해 통과할 때마다 뒤로 넓혀갑니다. ' +
      '한 장을 통째로 외울 때 가장 효과가 좋은 방식입니다.</p>';

    if (ctx.planStatus) {
      var st = ctx.planStatus, pp = st.plan;
      html += '<div class="preview" style="background:var(--gold-tint);border-color:#E7D6A8;color:#4A3A10">' +
        '<b>' + escapeHtml(global.RevData.shortRef(pp.chapter, pp.startVerse, pp.endVerse)) + '</b> · ' +
        pp.stage + '단계 · ' + pp.chapter + '장 ' + st.doneVerses + '/' + st.totalVerses + '절 (' + st.progress + '%)' +
        (pp.best ? ' · 최고 ' + pp.best + '점' : '') +
        (st.atEnd ? ' · 장 끝까지 도달' : ' · 다음 단계 ' + pp.startVerse + '~' + st.nextEnd + '절') +
        '</div>' +
        '<div class="btn-row" style="margin-top:12px">' +
          (st.canAdvance ? '<button class="btn btn-gold" data-action="plan-advance" data-c="' + pp.chapter +
            '" data-s="' + pp.startVerse + '" type="button">다음 단계로 확장 (~' + st.nextEnd + '절)</button>' : '') +
          '<button class="btn btn-ghost" data-action="plan-load" data-c="' + pp.chapter +
            '" data-s="' + pp.startVerse + '" type="button">현재 단계 불러오기</button>' +
          '<button class="btn btn-ghost" data-action="plan-remove" data-c="' + pp.chapter +
            '" data-s="' + pp.startVerse + '" type="button">계획 삭제</button>' +
        '</div>';
    } else if (!ctx.error) {
      html += '<div class="btn-row">' +
        '<button class="btn btn-ghost" data-action="plan-start" type="button">이 범위로 누적 암송 시작</button>' +
        '</div>' +
        '<p class="muted" style="margin:10px 0 0">' + ctx.chapter + '장 ' + ctx.startVerse + '절부터 시작해 ' +
        global.RevPlan.CONFIG.DEFAULT_STEP + '절씩 넓혀 ' + (global.RevData.getVerseCount(ctx.chapter) || 0) +
        '절까지 진행합니다. 90점 이상이면 다음 단계로 넘어갑니다.</p>';
    }

    if (ctx.otherPlans && ctx.otherPlans.length) {
      html += '<ul class="list" style="margin-top:14px">' + ctx.otherPlans.map(planRow).join('') + '</ul>';
    }
    html += '</div>';

    if (ctx.favorites.length) {
      html += '<div class="card"><p class="quick-title">즐겨찾기에서 바로 선택</p><div class="chips">' +
        ctx.favorites.map(function (f) {
          return '<button class="chip" data-action="pick-range" data-c="' + f.chapter + '" data-s="' + f.startVerse +
            '" data-e="' + f.endVerse + '" type="button">⭐ ' +
            escapeHtml(global.RevData.shortRef(f.chapter, f.startVerse, f.endVerse)) + '</button>';
        }).join('') + '</div></div>';
    }

    html += '<div class="card"><p class="quick-title">추천 범위</p><div class="chips">' +
      global.RevStats.DEFAULT_PICKS.map(function (p) {
        return '<button class="chip" data-action="pick-range" data-c="' + p.chapter + '" data-s="' + p.startVerse +
          '" data-e="' + p.endVerse + '" type="button">' +
          escapeHtml(global.RevData.shortRef(p.chapter, p.startVerse, p.endVerse)) + '</button>';
      }).join('') + '</div></div>';

    return html;
  }

  /* ---------- 암송 화면 ---------- */

  function renderMemorize(ctx) {
    var p = ctx.passage;
    var html = '<div class="card">' +
      '<div class="mem-top">' +
        '<div><h1 class="mem-ref">' + escapeHtml(p.reference) + '</h1>' +
        '<p class="muted" style="margin:2px 0 0">' + p.verses.length + '절 · 약 ' + p.charCount + '자</p></div>' +
        (ctx.showTimer ? '<div class="timer" id="timerBox" aria-label="경과 시간">00:00</div>' : '') +
      '</div>' +
      '<p class="mem-guide">준비가 되었다면 외운 내용을 그대로 입력하세요. 본문은 채점 후에 보여드립니다.</p>' +
      '<label class="sr-only" for="answerInput" style="position:absolute;left:-9999px">암송한 내용 입력</label>' +
      '<textarea class="answer-area" id="answerInput" placeholder="외운 내용을 입력하세요…&#10;절이 바뀌면 줄을 바꿔도 됩니다. 줄바꿈과 띄어쓰기는 채점에 불이익을 주지 않습니다." ' +
        'spellcheck="false" autocomplete="off" autocapitalize="off">' + escapeHtml(ctx.draft || '') + '</textarea>' +
      '<div class="count-bar">' +
        '<span>입력 글자 수 <b id="charCount">0</b></span>' +
        '<span>예상 본문 글자 수 <b>' + p.charCount + '</b></span>' +
      '</div>';

    if (ctx.hintLevel > 0) {
      html += '<div class="hint-box"><div class="hint-label">' + escapeHtml(HINT_LABELS[ctx.hintLevel]) + '</div>' +
        '<p class="hint-text">' + buildHint(p, ctx.hintLevel) + '</p></div>';
    }

    if (ctx.voice && ctx.voice.show) {
      html += '<div class="voice-bar' + (ctx.voice.listening ? ' on' : '') + '" id="voiceBar">' +
        '<button class="btn btn-ghost mic-btn" data-action="voice" type="button"' +
          (ctx.voice.available ? '' : ' disabled') +
          ' aria-pressed="' + (ctx.voice.listening ? 'true' : 'false') + '">' +
          '<span class="mic-dot" aria-hidden="true"></span>' +
          (ctx.voice.listening ? '음성 인식 중 · 누르면 정지' : '🎤 음성으로 암송') +
        '</button>' +
        '<span class="voice-note" id="voiceNote">' +
          escapeHtml(ctx.voice.available
            ? (ctx.voice.listening ? '말한 내용이 입력창에 이어서 들어갑니다.' : '입력창에 직접 타이핑해도 됩니다.')
            : (ctx.voice.reason || '')) +
        '</span></div>';
    }

    html += '<div class="mem-actions">' +
      '<button class="btn btn-primary" data-action="submit" type="button">채점하기</button>' +
      '<button class="btn btn-ghost" data-action="hint" type="button"' + (ctx.hintLevel >= HINT_MAX ? ' disabled' : '') + '>' +
        (ctx.hintLevel >= HINT_MAX ? '힌트 모두 사용' : '힌트 (' + ctx.hintLevel + '/' + HINT_MAX + ')') + '</button>' +
      '<button class="btn btn-ghost" data-action="give-up" type="button">범위 변경</button>' +
    '</div>' +
    '<p class="kbd-tip"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> 채점 · <kbd>Alt</kbd>+<kbd>H</kbd> 힌트 · ' +
      '<kbd>Alt</kbd>+<kbd>V</kbd> 음성 · <kbd>Esc</kbd> 뒤로</p>' +
    '</div>';

    return html;
  }

  /* ---------- 채점 결과 ---------- */

  function renderResult(ctx) {
    var r = ctx.result;
    var c = r.counts;

    var html = '<div class="card score-card">' +
      '<div class="muted">' + escapeHtml(r.reference) + '</div>' +
      '<div class="score-num ' + scoreClass(r.score) + '">' + r.score + '<span>점</span></div>' +
      '<p class="score-msg">' + escapeHtml(r.message) + '</p>' +
      '<p class="score-sub">정확도 ' + Math.round(r.accuracy * 100) + '% · 소요 시간 ' +
        escapeHtml(global.RevStats.formatDuration(ctx.duration)) +
        (r.hintsUsed ? ' · 힌트 ' + r.hintsUsed + '단계 사용' : ' · 힌트 없음') +
        (r.penalty ? ' (−' + r.penalty + '점)' : '') + '</p>' +
      '<div class="tally">' +
        tally('t-correct', c.correct, '🟢 정확') +
        tally('t-similar', c.similar, '🟡 유사') +
        tally('t-wrong', c.wrong, '🔴 오답') +
        tally('t-missing', c.missing, '⚪ 누락') +
        tally('t-extra', c.extra, '🔵 추가') +
      '</div>' +
      (ctx.srs ? '<p class="next-review">🔁 다음 복습 <b>' +
        escapeHtml(global.RevSRS.dueLabel(ctx.srs.card)) + '</b>' +
        ' (' + ctx.srs.intervalDays + '일 뒤 · ' +
        (ctx.srs.passed ? '통과, 간격을 늘렸습니다' : '기준 미달, 내일 다시 봅니다') + ')</p>' : '') +
      (ctx.planStatus ? '<p class="next-review">🧱 누적 암송 ' + ctx.planStatus.plan.stage + '단계 · ' +
        (ctx.planStatus.cleared ? '<b>' + ctx.planStatus.plan.chapter + '장 완주</b>'
          : (ctx.planStatus.canAdvance
              ? '<b>다음 단계로 확장할 수 있습니다</b>'
              : '90점 이상이면 ' + ctx.planStatus.plan.startVerse + '~' + ctx.planStatus.nextEnd + '절로 넓어집니다')) +
        '</p>' : '') +
      '<div class="btn-row" style="margin-top:20px;justify-content:center">' +
        (ctx.planStatus && ctx.planStatus.canAdvance
          ? '<button class="btn btn-gold" data-action="plan-advance" data-c="' + ctx.planStatus.plan.chapter +
            '" data-s="' + ctx.planStatus.plan.startVerse + '" type="button">다음 단계 (~' +
            ctx.planStatus.nextEnd + '절) 암송</button>' : '') +
        '<button class="btn btn-primary" data-action="retry" type="button">다시 암송</button>' +
        (r.weakVerses.length ? '<button class="btn btn-gold" data-action="retry-weak" type="button">오답만 연습 (' + r.weakVerses.length + '절)</button>' : '') +
        '<button class="btn btn-ghost" data-action="go-select" type="button">범위 변경</button>' +
        '<button class="btn btn-ghost" data-action="toggle-fav" type="button">' + (ctx.isFavorite ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기') + '</button>' +
      '</div>' +
    '</div>';

    /* 상세 비교 */
    html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">🔍</span>상세 비교</h2></div>' +
      '<div class="legend">' +
        '<span class="lg lg-correct">🟢 정확</span><span class="lg lg-similar">🟡 유사</span>' +
        '<span class="lg lg-wrong">🔴 오답</span><span class="lg lg-missing">⚪ 누락</span><span class="lg lg-extra">🔵 추가 입력</span>' +
      '</div>' +
      '<p class="muted" style="margin:-6px 0 12px">색이 있는 어절을 누르면 정답과 입력을 비교해 보여줍니다.</p>';

    r.verses.forEach(function (v, idx) {
      html += '<div class="diff-verse">' +
        '<div class="diff-vhead"><span class="diff-vno">' + v.verse + '절</span>' +
        '<span class="vscore ' + scoreClass(v.score) + '">' + v.score + '점</span>' +
        '<span>정확 ' + v.correct + ' · 유사 ' + v.similar + ' · 오답 ' + v.wrong + ' · 누락 ' + v.missing + ' · 추가 ' + v.extra + '</span>' +
        (v.score < 80 ? '<button class="btn btn-sm btn-ghost" data-action="practice-verse" data-c="' + r.chapter +
          '" data-v="' + v.verse + '" type="button">이 절만 다시</button>' : '') +
        '</div><div class="diff-flow">' +
        v.ops.map(function (op, i) { return tokenHtml(op, idx + '-' + i); }).join('') +
        '</div></div>';
    });
    html += '</div>';

    /* 절별 점수 */
    html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">📋</span>절별 점수</h2></div><ul class="vlist">' +
      r.verses.map(function (v) {
        return '<li class="vrow"><span class="vrow-no">' + v.verse + '절</span>' +
          '<span class="bar"><i style="width:' + v.score + '%;background:' + barColor(v.score) + '"></i></span>' +
          '<span class="vrow-score ' + scoreClass(v.score) + '">' + v.score + '점</span></li>';
      }).join('') + '</ul></div>';

    /* 정답 본문 */
    html += '<details class="fold" style="margin-top:16px"><summary>정답 본문 보기 (' + escapeHtml(r.reference) + ')</summary><div>' +
      '<div class="answer-box">' + r.passage.verses.map(function (v) {
        return '<span class="v"><span class="vn">' + v.verse + '</span>' + escapeHtml(v.text) + '</span>';
      }).join('') + '</div></div></details>';

    html += '<details class="fold"><summary>내가 입력한 내용 보기</summary><div>' +
      '<div class="answer-box" style="font-family:var(--font);font-size:15px">' +
      (ctx.userText ? escapeHtml(ctx.userText).replace(/\n/g, '<br>') : '<span class="muted">입력 없음</span>') +
      '</div></div></details>';

    return html;
  }

  function tally(cls, n, label) {
    return '<div class="tally-item ' + cls + '"><div class="tally-num">' + n + '</div>' +
           '<div class="tally-label">' + label + '</div></div>';
  }

  var MARK = { correct: '', similar: '≈', wrong: '✕', missing: '⊘', extra: '+' };

  function tokenHtml(op, key) {
    var text = (op.type === 'extra') ? op.user : op.answer;
    var cls = 'tk tk-' + op.type;
    var attrs = '';
    if (op.type !== 'correct') {
      attrs = ' data-action="explain" data-key="' + escapeHtml(key) + '" role="button" tabindex="0"' +
        ' aria-label="' + escapeHtml(labelOf(op)) + '"';
    }
    var mark = MARK[op.type] ? '<span class="tk-mark" aria-hidden="true">' + MARK[op.type] + '</span>' : '';
    return '<span class="' + cls + '"' + attrs + '>' + mark + escapeHtml(text) + '</span>';
  }

  function labelOf(op) {
    if (op.type === 'correct') return '정확: ' + op.answer;
    if (op.type === 'similar') return '유사: 정답 ' + op.answer + ', 입력 ' + (op.user || '없음');
    if (op.type === 'wrong') return '오답: 정답 ' + op.answer + ', 입력 ' + (op.user || '없음');
    if (op.type === 'missing') return '누락: ' + op.answer;
    return '추가 입력: ' + op.user;
  }

  var TYPE_KO = { correct: '정확', similar: '유사', wrong: '오답', missing: '누락', extra: '추가 입력' };

  function explainHtml(op) {
    var rows = '';
    rows += '<dt>구분</dt><dd>' + TYPE_KO[op.type] + '</dd>';
    rows += '<dt>정답</dt><dd>' + (op.answerSpan ? escapeHtml(op.answerSpan) : (op.answer ? escapeHtml(op.answer) : '<span class="muted">없음</span>')) + '</dd>';
    rows += '<dt>입력</dt><dd>' + (op.userSpan ? escapeHtml(op.userSpan) : (op.user ? escapeHtml(op.user) : '<span class="muted">없음</span>')) + '</dd>';
    if (op.similarity > 0 && op.type !== 'correct') {
      rows += '<dt>유사도</dt><dd>' + Math.round(op.similarity * 100) + '%</dd>';
    }
    rows += '<dt>진단</dt><dd>' + escapeHtml(op.issue || defaultIssue(op)) + '</dd>';
    return '<dl>' + rows + '</dl>';
  }

  function defaultIssue(op) {
    if (op.type === 'missing') return '이 어절이 입력에서 빠졌습니다.';
    if (op.type === 'extra') return '정답에 없는 어절을 입력했습니다.';
    return '';
  }

  /* ---------- 즐겨찾기 ---------- */

  function renderFavorites(ctx) {
    var html = '<div class="page-head"><h1 class="page-title">즐겨찾기</h1>' +
      '<p class="page-sub">자주 암송하는 범위를 담아두면 홈과 선택 화면에서 바로 시작할 수 있습니다.</p></div>';

    html += '<div class="card">';
    if (!ctx.favorites.length) {
      html += '<p class="empty">아직 즐겨찾기가 없습니다.<br>범위 선택 화면에서 ☆ 버튼으로 추가하세요.</p>' +
        '<div class="btn-row" style="margin-top:14px"><button class="btn btn-primary" data-action="go-select" type="button">범위 선택으로</button></div>';
    } else {
      html += '<ul class="list">' + ctx.favorites.map(function (f) {
        var st = ctx.stats[f.id];
        return '<li class="row">' +
          '<button class="row-main" data-action="open-range" data-c="' + f.chapter + '" data-s="' + f.startVerse +
          '" data-e="' + f.endVerse + '" type="button">' +
          '<span class="row-ref">⭐ ' + escapeHtml(global.RevData.shortRef(f.chapter, f.startVerse, f.endVerse)) + '</span>' +
          '<span class="row-meta">' + (f.endVerse - f.startVerse + 1) + '절' +
          (st ? ' · ' + st.count + '회 · 평균 ' + st.average + '점 · 최고 ' + st.best + '점' : ' · 아직 기록 없음') +
          '</span></button>' +
          '<button class="icon-btn" data-action="del-fav" data-id="' + escapeHtml(f.id) + '" type="button" ' +
          'aria-label="' + escapeHtml(global.RevData.shortRef(f.chapter, f.startVerse, f.endVerse)) + ' 즐겨찾기 삭제">🗑</button></li>';
      }).join('') + '</ul>';
    }
    html += '</div>';
    return html;
  }

  /* ---------- 학습 기록 ---------- */

  function renderHistory(ctx) {
    var s = ctx.summary;
    var html = '<div class="page-head"><h1 class="page-title">학습 기록</h1>' +
      '<p class="page-sub">채점한 모든 암송이 이 기기에 저장됩니다.</p></div>';

    html += '<div class="card"><div class="stat-grid">' +
      stat(s.total, '회', '총 암송') +
      stat(s.average, '점', '평균 점수') +
      stat(s.best, '점', '최고 점수') +
      stat(s.streak, '일', '연속 학습') +
    '</div>' +
    (s.total ? '<p class="muted" style="margin:12px 0 0">총 학습 시간 ' +
      escapeHtml(global.RevStats.formatDurationKo(s.totalSeconds)) + ' · 100점 ' + s.perfectCount + '회</p>' : '') +
    '</div>';

    if (ctx.trend.length > 1) {
      html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">📈</span>최근 점수 추이</h2></div>' +
        '<div class="spark">' + ctx.trend.map(function (t) {
          return '<div class="spark-col" title="' + escapeHtml((t.reference || '') + ' ' + t.score + '점') + '">' +
            '<div class="spark-bar" style="height:' + Math.max(6, t.score * 0.82) + 'px;background:' + barColor(t.score) + '"></div>' +
            '<div class="spark-lab">' + t.score + '</div></div>';
        }).join('') + '</div></div>';
    }

    if (ctx.dueCards.length || ctx.upcomingCards.length) {
      html += '<div class="card"><div class="card-head">' +
        '<h2 class="card-title"><span class="lead">🔁</span>복습 일정 (간격 반복)</h2>' +
        '<button class="card-link" data-action="srs-reset" type="button">일정 초기화</button></div>';

      if (ctx.dueCards.length) {
        html += '<p class="quick-title">오늘 복습</p><ul class="list" style="margin-bottom:14px">' +
          ctx.dueCards.slice(0, 8).map(function (c) {
            return '<li class="row"><button class="row-main" data-action="open-range" data-c="' + c.chapter +
              '" data-s="' + c.startVerse + '" data-e="' + c.endVerse + '" type="button">' +
              '<span class="row-ref">' + escapeHtml(global.RevData.shortRef(c.chapter, c.startVerse, c.endVerse)) + '</span>' +
              '<span class="row-meta">' + (c.overdueDays > 0 ? c.overdueDays + '일 밀림' : '오늘') +
              ' · 지난 점수 ' + c.lastScore + '점 · 난이도 ' + c.ease.toFixed(2) + '</span></button>' +
              '<span class="row-score ' + (c.overdueDays > 2 ? 's-low' : 's-mid') + '">복습</span></li>';
          }).join('') + '</ul>';
      }
      if (ctx.upcomingCards.length) {
        html += '<p class="quick-title">예정</p><div class="chips">' +
          ctx.upcomingCards.map(function (c) {
            return '<span class="chip chip-static">' +
              escapeHtml(global.RevData.shortRef(c.chapter, c.startVerse, c.endVerse)) +
              ' · ' + escapeHtml(global.RevSRS.dueLabel(c)) + '</span>';
          }).join('') + '</div>';
      }
      html += '</div>';
    }

    html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">🏅</span>성취</h2></div>' +
      '<div class="ach-grid">' + ctx.achievements.map(function (a) {
        return '<div class="ach' + (a.earned ? ' on' : '') + '"><span class="ach-ico">' + a.icon + '</span>' +
          '<span><span class="ach-name">' + escapeHtml(a.name) + '</span><br>' +
          '<span class="ach-desc">' + escapeHtml(a.desc) + '</span></span></div>';
      }).join('') + '</div></div>';

    if (ctx.weakRanges.length) {
      html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">🎯</span>보완이 필요한 범위</h2></div>' +
        '<ul class="list">' + ctx.weakRanges.map(function (r) {
          return '<li class="row"><button class="row-main" data-action="open-range" data-c="' + r.chapter +
            '" data-s="' + r.startVerse + '" data-e="' + r.endVerse + '" type="button">' +
            '<span class="row-ref">' + escapeHtml(global.RevData.shortRef(r.chapter, r.startVerse, r.endVerse)) + '</span>' +
            '<span class="row-meta">' + r.count + '회 시도 · 최고 ' + r.best + '점</span></button>' +
            '<span class="row-score ' + scoreClass(r.average) + '">평균 ' + r.average + '점</span></li>';
        }).join('') + '</ul></div>';
    }

    html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">🗂</span>전체 기록</h2>' +
      (ctx.history.length ? '<button class="card-link" data-action="clear-history" type="button">기록 비우기</button>' : '') + '</div>';
    if (!ctx.history.length) {
      html += '<p class="empty">아직 기록이 없습니다.</p>';
    } else {
      html += '<div class="table-wrap"><table class="table"><thead><tr>' +
        '<th>날짜</th><th>범위</th><th class="num">점수</th><th class="num">정확도</th><th class="num">시간</th><th class="num">힌트</th>' +
        '</tr></thead><tbody>' +
        ctx.history.slice(0, 100).map(function (h) {
          return '<tr><td>' + escapeHtml(global.RevStats.formatDate(h.createdAt)) + '</td>' +
            '<td>' + escapeHtml(global.RevData.shortRef(h.chapter, h.startVerse, h.endVerse)) + '</td>' +
            '<td class="num ' + scoreClass(h.score) + '"><b>' + h.score + '</b></td>' +
            '<td class="num">' + Math.round((h.accuracy || 0) * 100) + '%</td>' +
            '<td class="num">' + escapeHtml(global.RevStats.formatDuration(h.duration)) + '</td>' +
            '<td class="num">' + (h.hintsUsed || 0) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      if (ctx.history.length > 100) {
        html += '<p class="muted" style="margin-top:10px">최근 100회만 표시합니다. (저장된 기록 ' + ctx.history.length + '회)</p>';
      }
    }
    html += '</div>';

    html += '<div class="card"><div class="card-head">' +
      '<h2 class="card-title"><span class="lead">👥</span>여러 명 학습 현황 취합</h2></div>' +
      '<p class="muted" style="margin:0 0 12px">수강생들이 [설정 → 백업 파일 내려받기]로 보낸 JSON을 모아 ' +
      '인원별·범위별·절별 현황을 한 번에 집계하고 CSV로 내보냅니다.</p>' +
      '<div class="btn-row"><button class="btn btn-primary" data-action="go-report" type="button">취합 화면 열기</button></div></div>';

    return html;
  }

  /* ---------- 설정 ---------- */

  function renderSettings(ctx) {
    var s = ctx.settings;
    function row(key, name, desc) {
      return '<div class="set-row"><div><div class="set-name">' + name + '</div>' +
        '<div class="set-desc">' + desc + '</div></div>' +
        '<label class="switch"><input type="checkbox" data-setting="' + key + '"' + (s[key] ? ' checked' : '') + '>' +
        '<span>' + (s[key] ? '켜짐' : '꺼짐') + '</span></label></div>';
    }

    var html = '<div class="page-head"><h1 class="page-title">설정</h1>' +
      '<p class="page-sub">모든 데이터는 이 브라우저에만 저장되며 외부로 전송되지 않습니다.</p></div>';

    html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">🙋</span>학습자 이름</h2></div>' +
      '<div class="set-row"><div><div class="set-name">이름 또는 별칭</div>' +
      '<div class="set-desc">백업 파일과 취합 보고서에 표시됩니다. 비워두면 파일 이름을 대신 사용합니다. ' +
      '이 값도 이 브라우저 안에만 저장됩니다.</div></div>' +
      '<input class="text-input" type="text" maxlength="40" data-setting-text="learnerName" ' +
      'value="' + escapeHtml(s.learnerName || '') + '" placeholder="예: 김성경" aria-label="학습자 이름"></div></div>';

    html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">⚙️</span>채점 · 학습</h2></div>' +
      row('hintPenalty', '힌트 사용 시 감점', '힌트를 한 단계 볼 때마다 3점씩, 최대 10점까지 감점합니다.') +
      row('strictPunctuation', '문장부호까지 엄격하게 채점', '끄면 쉼표·마침표 차이는 오답으로 보지 않습니다. (기본: 꺼짐)') +
      row('srsEnabled', '간격 반복 복습 사용', '점수에 따라 다음 복습일을 자동 계산해 홈 화면에 띄웁니다. (SM-2)') +
      row('voiceInput', '음성 암송 버튼 표시', '마이크로 암송하면 인식된 문장이 입력창에 들어갑니다. https 또는 localhost 필요.') +
      row('showTimer', '암송 화면에 타이머 표시', '끄더라도 소요 시간은 기록에 남습니다.') +
      row('autoFocus', '암송 시작 시 입력창에 자동 포커스', '모바일에서 키보드가 바로 올라오는 것이 불편하면 끄세요.') +
      '</div>';

    html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">📖</span>본문 데이터</h2></div>' +
      '<div class="src-note"><b>' + escapeHtml(global.RevData.getBook()) + ' · ' + escapeHtml(global.RevData.getVersion()) + '</b><br>' +
      '수록: ' + global.RevData.getTotalVerses() + '절 / 22장' +
      ' · 출처 구분: ' + escapeHtml(originLabel(global.RevData.getOrigin())) + '<br>' +
      escapeHtml(global.RevData.getSourceNote()) + '</div>';

    if (global.RevData.isDemo()) {
      html += '<p class="err" style="margin-top:12px">현재 본문이 완전하지 않습니다. ' +
        escapeHtml(global.RevData.getIssues().slice(0, 4).join(' / ')) + '</p>';
    }

    html += '<div class="btn-row" style="margin-top:14px">' +
      '<span class="btn btn-ghost file-btn">본문 JSON 불러오기<input type="file" accept="application/json,.json" data-action="import-data"></span>' +
      (global.RevData.getOrigin() === 'custom' ?
        '<button class="btn btn-ghost" data-action="reset-data" type="button">기본 본문으로 되돌리기</button>' : '') +
      '</div>' +
      '<p class="muted" style="margin-top:10px">형식: <code>{ "book": "...", "version": "...", "chapters": { "1": { "1": "본문", ... } } }</code></p>' +
      '</div>';

    html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">💾</span>내 학습 데이터</h2></div>' +
      '<p class="muted" style="margin:0 0 12px">즐겨찾기 ' + ctx.favCount + '개 · 학습 기록 ' + ctx.historyCount + '회 · ' +
      '복습 카드 ' + ctx.srsCount + '개 · 누적 계획 ' + ctx.planCount + '개' +
      (global.Store.isAvailable() ? '' : ' · <b style="color:var(--bad)">이 브라우저에서는 저장이 제한되어 새로고침 시 사라집니다.</b>') + '</p>' +
      '<div class="btn-row">' +
        '<button class="btn btn-ghost" data-action="export" type="button">백업 파일 내려받기</button>' +
        '<span class="btn btn-ghost file-btn">백업 불러오기<input type="file" accept="application/json,.json" data-action="import-backup"></span>' +
        '<button class="btn btn-ghost" data-action="clear-history" type="button">학습 기록 비우기</button>' +
        '<button class="btn btn-ghost" data-action="clear-favs" type="button">즐겨찾기 비우기</button>' +
        '<button class="btn btn-ghost" data-action="srs-reset" type="button">복습 일정 초기화</button>' +
        '<button class="btn btn-ghost" data-action="plan-reset" type="button">누적 계획 초기화</button>' +
      '</div></div>';

    html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">👥</span>여러 명 취합</h2></div>' +
      '<p class="muted" style="margin:0 0 12px">수강생 백업 파일을 모아 인원별·범위별 현황을 집계하고 CSV로 내보냅니다.</p>' +
      '<div class="btn-row"><button class="btn btn-ghost" data-action="go-report" type="button">취합 화면 열기</button></div></div>';

    html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">📱</span>앱으로 설치 (PWA)</h2></div>' +
      '<div class="src-note">' + escapeHtml(ctx.pwa.note) + '</div>' +
      (ctx.pwa.canInstall
        ? '<div class="btn-row" style="margin-top:12px"><button class="btn btn-primary" data-action="pwa-install" type="button">홈 화면에 설치</button></div>'
        : '') +
      '<p class="muted" style="margin-top:10px">iPhone Safari 에서는 공유 → <b>홈 화면에 추가</b>, ' +
      'Android Chrome 에서는 메뉴 → <b>앱 설치</b>를 누르면 됩니다. 설치 후에는 인터넷 없이도 실행됩니다.</p></div>';

    html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">ℹ️</span>채점 방식</h2></div>' +
      '<p class="muted" style="margin:0">어절(띄어쓰기) 단위로 나눈 뒤 LCS로 정답과 입력을 정렬하고, ' +
      '짝지어진 어절은 한글 자모 단위 편집거리로 유사도를 계산합니다. ' +
      '유사도 60% 이상은 <b>유사</b>(0.5점), 미만은 <b>오답</b>(0점), 빠진 어절은 <b>누락</b>(0점), ' +
      '정답에 없는 어절은 <b>추가</b>(−0.2점)로 계산해 100점 만점으로 환산합니다.</p></div>';

    return html;
  }

  /* ---------- 여러 명 취합 ---------- */

  function renderReport(ctx) {
    var html = '<div class="page-head"><h1 class="page-title">여러 명 학습 현황 취합</h1>' +
      '<p class="page-sub">수강생이 [설정 → 백업 파일 내려받기]로 만든 JSON을 한꺼번에 선택하면 ' +
      '인원별·범위별·절별 현황을 집계합니다. 파일은 이 기기 안에서만 처리되며 어디에도 전송되지 않습니다.</p></div>';

    html += '<div class="card"><div class="btn-row">' +
      '<span class="btn btn-primary file-btn">백업 파일 선택 (여러 개 가능)' +
      '<input type="file" accept="application/json,.json" multiple data-action="import-report"></span>' +
      (ctx.report ? '<button class="btn btn-ghost" data-action="report-csv" type="button">CSV로 내보내기</button>' +
                    '<button class="btn btn-ghost" data-action="report-clear" type="button">지우기</button>' : '') +
      '<button class="btn btn-ghost" data-action="go-history" type="button">학습 기록으로</button>' +
      '</div>';

    if (ctx.files && ctx.files.length) {
      html += '<p class="muted" style="margin:12px 0 0">불러온 파일 ' + ctx.files.length + '개: ' +
        escapeHtml(ctx.files.join(', ')) + '</p>';
    }
    html += '</div>';

    if (!ctx.report) {
      html += '<div class="card"><p class="empty">아직 불러온 파일이 없습니다.<br>' +
        '백업 JSON을 선택하면 여기에 집계 결과가 나타납니다.</p></div>';
      return html;
    }

    var t = ctx.report.totals;

    if (ctx.report.skipped.length) {
      html += '<p class="err" role="alert">건너뛴 파일 ' + ctx.report.skipped.length + '개: ' +
        escapeHtml(ctx.report.skipped.join(', ')) + '</p>';
    }

    html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">📊</span>전체 현황</h2>' +
      '<span class="muted">' + escapeHtml(global.RevStats.formatDate(ctx.report.generatedAt)) + ' 기준</span></div>' +
      '<div class="stat-grid">' +
        stat(t.learners, '명', '참여 인원') +
        stat(t.attempts, '회', '총 암송') +
        stat(t.average, '점', '전체 평균') +
        stat(t.activeToday, '명', '오늘 학습') +
      '</div>' +
      '<p class="muted" style="margin:12px 0 0">최고 점수 ' + t.best + '점 · 총 학습 시간 ' +
      escapeHtml(global.RevStats.formatDurationKo(t.seconds)) + ' · 암송된 범위 ' + t.rangeCount + '개' +
      (t.inactiveCount ? ' · <b style="color:var(--bad)">7일 이상 미학습 ' + t.inactiveCount + '명</b>' : '') + '</p></div>';

    html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">🙋</span>인원별 현황</h2></div>' +
      '<div class="table-wrap"><table class="table"><thead><tr>' +
      '<th>이름</th><th class="num">횟수</th><th class="num">평균</th><th class="num">최고</th>' +
      '<th class="num">연속</th><th class="num">범위</th><th class="num">학습시간</th><th>최근 학습</th>' +
      '</tr></thead><tbody>' +
      ctx.report.learners.map(function (l) {
        return '<tr><td><b>' + escapeHtml(l.name) + '</b></td>' +
          '<td class="num">' + l.attempts + '</td>' +
          '<td class="num ' + scoreClass(l.average) + '"><b>' + l.average + '</b></td>' +
          '<td class="num">' + l.best + '</td>' +
          '<td class="num">' + l.streak + '일</td>' +
          '<td class="num">' + l.rangeCount + '</td>' +
          '<td class="num">' + escapeHtml(global.RevStats.formatDurationKo(l.seconds)) + '</td>' +
          '<td>' + (l.lastAt ? escapeHtml(global.RevStats.formatDate(l.lastAt)) : '-') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';

    html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">🎯</span>범위별 현황 · 평균 낮은 순</h2></div>' +
      '<div class="table-wrap"><table class="table"><thead><tr>' +
      '<th>범위</th><th class="num">인원</th><th class="num">시도</th><th class="num">평균</th>' +
      '<th class="num">최고</th><th class="num">최저</th><th class="num">90점 이상</th>' +
      '</tr></thead><tbody>' +
      ctx.report.ranges.slice(0, 40).map(function (r) {
        return '<tr><td><b>' + escapeHtml(r.reference) + '</b></td>' +
          '<td class="num">' + r.learnerCount + '</td>' +
          '<td class="num">' + r.attempts + '</td>' +
          '<td class="num ' + scoreClass(r.average) + '"><b>' + r.average + '</b></td>' +
          '<td class="num">' + r.best + '</td>' +
          '<td class="num">' + r.low + '</td>' +
          '<td class="num">' + r.passRate + '%</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (ctx.report.ranges.length > 40 ? '<p class="muted" style="margin-top:10px">상위 40개 범위만 표시합니다.</p>' : '') +
      '</div>';

    if (ctx.report.weakVerses.length) {
      html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">🩹</span>공통으로 자주 틀리는 절</h2></div>' +
        '<p class="muted" style="margin:-4px 0 12px">여러 사람이 함께 틀리는 절은 교육 자료를 보완할 지점입니다.</p>' +
        '<div class="chips">' + ctx.report.weakVerses.slice(0, 24).map(function (v) {
          return '<button class="chip" data-action="open-range" data-c="' + v.chapter + '" data-s="' + v.verse +
            '" data-e="' + v.verse + '" type="button">' + escapeHtml(v.reference) +
            ' · ' + v.learnerCount + '명 / ' + v.count + '회</button>';
        }).join('') + '</div></div>';
    }

    if (ctx.report.inactive.length) {
      html += '<div class="card"><div class="card-head"><h2 class="card-title"><span class="lead">🔔</span>7일 이상 미학습</h2></div>' +
        '<ul class="list">' + ctx.report.inactive.map(function (l) {
          return '<li class="row"><span class="row-main" style="cursor:default">' +
            '<span class="row-ref">' + escapeHtml(l.name) + '</span>' +
            '<span class="row-meta">최근 학습 ' +
            (l.lastAt ? escapeHtml(global.RevStats.formatDate(l.lastAt)) : '기록 없음') + '</span></span></li>';
        }).join('') + '</ul></div>';
    }

    return html;
  }

  function originLabel(origin) {
    if (origin === 'custom') return '사용자가 불러온 파일';
    if (origin === 'fetched') return 'data/revelation_kor.json';
    if (origin === 'bundled') return '앱에 포함된 기본 데이터';
    return '없음';
  }

  global.UI = {
    escapeHtml: escapeHtml,
    scoreClass: scoreClass,
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    setBusy: setBusy,
    toChosung: toChosung,
    buildHint: buildHint,
    HINT_MAX: HINT_MAX,
    HINT_LABELS: HINT_LABELS,
    explainHtml: explainHtml,
    renderHome: renderHome,
    renderSelect: renderSelect,
    renderMemorize: renderMemorize,
    renderResult: renderResult,
    renderFavorites: renderFavorites,
    renderHistory: renderHistory,
    renderSettings: renderSettings,
    renderReport: renderReport
  };
})(window);
