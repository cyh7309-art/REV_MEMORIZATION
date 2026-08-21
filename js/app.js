/* ============================================================
   app.js — 앱 전체 연결
   ------------------------------------------------------------
   · 전역 상태 / 화면 전환 / 이벤트 위임 / 타이머 / 힌트
   · 실제 계산은 data · storage · diff · scorer · statistics 가 맡는다.
   ============================================================ */
(function (global) {
  'use strict';

  var state = {
    screen: 'home',
    selected: { chapter: 1, startVerse: 1, endVerse: 8 },
    rangeError: null,
    passage: null,
    draft: '',
    hintLevel: 0,
    timer: { startedAt: null, elapsed: 0, id: null, running: false },
    result: null,
    lastUserText: '',
    lastDuration: 0,
    settings: null,
    lastSrs: null,       // 직전 채점의 복습 일정 결과
    lastPlan: null,      // 직전 채점의 누적 암송 상태
    voiceBase: '',       // 음성 인식 시작 시점의 입력창 내용
    report: null,        // 취합 결과 (메모리에만 유지)
    reportFiles: [],
    installPrompt: null  // PWA 설치 프롬프트
  };

  var SCREENS = ['home', 'select', 'memorize', 'result', 'favorites', 'history', 'settings', 'report'];

  /* ---------- 부팅 ---------- */

  function boot() {
    state.settings = global.Store.getSettings();

    global.RevData.init(global.Store.getCustomData()).then(function () {
      if (!global.RevData.isReady()) {
        document.getElementById('screen-home').innerHTML =
          '<div class="card"><h1 class="page-title">본문 데이터를 불러오지 못했습니다</h1>' +
          '<p class="page-sub">data/revelation_kor.js 파일이 index.html 과 같은 위치에 있는지 확인해주세요. ' +
          '설정 화면에서 직접 JSON 파일을 불러올 수도 있습니다.</p>' +
          '<div class="btn-row" style="margin-top:14px">' +
          '<button class="btn btn-primary" data-action="go-settings" type="button">설정으로 이동</button></div></div>';
        show('home');
        bindGlobalEvents();
        return;
      }
      updateDemoBadge();
      clampSelection();
      bindGlobalEvents();
      setupPWA();
      go(initialScreen());
    });
  }

  /** PWA 단축키(?screen=...)로 들어온 경우 해당 화면부터 연다. */
  function initialScreen() {
    try {
      var m = /[?&]screen=([a-z]+)/.exec(global.location.search || '');
      if (m && SCREENS.indexOf(m[1]) >= 0) return m[1];
    } catch (e) { /* noop */ }
    return 'home';
  }

  /* ---------- PWA ---------- */

  function setupPWA() {
    var proto = global.location.protocol;
    if ((proto === 'https:' || global.location.hostname === 'localhost') &&
        global.navigator && global.navigator.serviceWorker) {
      global.navigator.serviceWorker.register('sw.js').catch(function () { /* 등록 실패는 무시 */ });
    }
    global.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      state.installPrompt = e;
      if (state.screen === 'settings') renderSettings();
    });
    global.addEventListener('appinstalled', function () {
      state.installPrompt = null;
      global.UI.toast('앱으로 설치되었습니다.');
    });
  }

  function pwaInfo() {
    var proto = global.location.protocol;
    var standalone = !!(global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) ||
                     global.navigator.standalone === true;
    var serveable = (proto === 'https:' || global.location.hostname === 'localhost');
    var note;
    if (standalone) note = '이미 앱으로 실행 중입니다. 오프라인에서도 그대로 동작합니다.';
    else if (!serveable) note = '지금은 파일을 직접 연 상태(file://)라 설치할 수 없습니다. ' +
      '터미널에서 python3 -m http.server 8080 을 실행하고 http://localhost:8080 으로 열면 설치할 수 있습니다.';
    else if (state.installPrompt) note = '설치 준비가 끝났습니다. 아래 버튼을 누르면 홈 화면에 추가됩니다.';
    else note = '브라우저 메뉴에서 "앱 설치" 또는 "홈 화면에 추가"를 선택하세요. 설치하면 오프라인에서도 실행됩니다.';
    return { standalone: standalone, serveable: serveable, canInstall: !!state.installPrompt, note: note };
  }

  function updateDemoBadge() {
    var badge = document.getElementById('demoBadge');
    if (!badge) return;
    badge.hidden = !global.RevData.isDemo();
    if (global.RevData.isDemo()) badge.textContent = '본문 미완성';
  }

  function updateStreakBadge() {
    var el = document.getElementById('hdrStreak');
    if (!el) return;
    var n = global.RevStats.streak(global.Store.getHistory());
    el.textContent = n > 0 ? ('🔥 ' + n + '일 연속') : '';
  }

  /* ---------- 화면 전환 ---------- */

  function show(name) {
    SCREENS.forEach(function (s) {
      var el = document.getElementById('screen-' + s);
      if (el) el.hidden = (s !== name);
    });
    var navKey = name;
    if (name === 'memorize' || name === 'result') navKey = 'select';
    else if (name === 'report') navKey = 'history';
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (btn) {
      if (btn.getAttribute('data-nav') === navKey) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    state.screen = name;
    global.scrollTo(0, 0);
  }

  function paint(name, html) {
    document.getElementById('screen-' + name).innerHTML = html;
    show(name);
  }

  function go(name) {
    if (name !== 'memorize') { stopTimer(); global.RevVoice.stop(); }
    updateStreakBadge();

    if (name === 'home') return renderHome();
    if (name === 'select') return renderSelect();
    if (name === 'favorites') return renderFavorites();
    if (name === 'history') return renderHistory();
    if (name === 'settings') return renderSettings();
    if (name === 'memorize') return renderMemorize();
    if (name === 'result') return renderResult();
    if (name === 'report') return renderReport();
  }

  /* ---------- 홈 ---------- */

  function renderHome() {
    var history = global.Store.getHistory();
    var favorites = global.Store.getFavorites();
    var pick = global.RevStats.todayPick(history, favorites);
    var passage = global.RevData.getPassage(pick.chapter, pick.startVerse, pick.endVerse)
               || global.RevData.getPassage(1, 1, Math.min(8, global.RevData.getVerseCount(1) || 1));

    state.todayPick = passage ? {
      chapter: passage.chapter, startVerse: passage.startVerse, endVerse: passage.endVerse
    } : null;

    paint('home', global.UI.renderHome({
      pick: {
        reference: passage ? passage.reference : '본문 없음',
        reason: pick.reason,
        verseCount: passage ? passage.verses.length : 0,
        charCount: passage ? passage.charCount : 0
      },
      summary: global.RevStats.summarize(history),
      recent: history.slice(0, 5),
      favorites: favorites,
      weakVerses: global.RevStats.weakVerses(history, 6),
      due: state.settings.srsEnabled ? global.RevSRS.due() : [],
      plans: global.RevPlan.active(3)
    }));
  }

  /* ---------- 범위 선택 ---------- */

  function clampSelection() {
    var sel = state.selected;
    var chapters = global.RevData.getChapters();
    if (chapters.indexOf(sel.chapter) === -1) sel.chapter = chapters[0] || 1;
    var max = global.RevData.getVerseCount(sel.chapter) || 1;
    if (sel.startVerse > max) sel.startVerse = 1;
    if (sel.endVerse > max) sel.endVerse = max;
    if (sel.startVerse < 1) sel.startVerse = 1;
    if (sel.endVerse < sel.startVerse) sel.endVerse = sel.startVerse;
  }

  function renderSelect() {
    var sel = state.selected;
    var err = global.RevData.checkRange(sel.chapter, sel.startVerse, sel.endVerse);
    var passage = err ? null : global.RevData.getPassage(sel.chapter, sel.startVerse, sel.endVerse);
    var id = global.RevData.rangeId(sel.chapter, sel.startVerse, sel.endVerse);

    var lastScore = null;
    var hist = global.Store.getHistory();
    for (var i = 0; i < hist.length; i++) {
      if (hist[i].chapter === sel.chapter && hist[i].startVerse === sel.startVerse &&
          hist[i].endVerse === sel.endVerse && !hist[i].partial) { lastScore = hist[i].score; break; }
    }

    paint('select', global.UI.renderSelect({
      chapter: sel.chapter,
      startVerse: sel.startVerse,
      endVerse: sel.endVerse,
      error: err,
      preview: passage ? {
        reference: passage.reference,
        verses: passage.verses,
        charCount: passage.charCount,
        lastScore: lastScore
      } : null,
      isFavorite: global.Store.isFavorite(id),
      favorites: global.Store.getFavorites(),
      planStatus: planStatusFor(sel.chapter, sel.startVerse),
      otherPlans: global.RevPlan.active(5).filter(function (st) {
        return !(st.plan.chapter === sel.chapter && st.plan.startVerse === sel.startVerse);
      })
    }));
  }

  function planStatusFor(chapter, startVerse) {
    var plan = global.RevPlan.get(chapter, startVerse);
    return plan ? global.RevPlan.status(plan) : null;
  }

  /* ---------- 암송 ---------- */

  function buildCustomPassage(chapter, verseList) {
    var verses = [];
    for (var i = 0; i < verseList.length; i++) {
      var text = global.RevData.getVerse(chapter, verseList[i]);
      if (text) verses.push({ verse: verseList[i], text: text });
    }
    if (!verses.length) return null;
    var full = verses.map(function (v) { return v.text; }).join(' ');
    var nums = verses.map(function (v) { return v.verse; });
    return {
      id: 'rev-' + chapter + '-part-' + nums.join('.'),
      book: global.RevData.getBook(),
      chapter: chapter,
      startVerse: nums[0],
      endVerse: nums[nums.length - 1],
      partial: true,
      reference: global.RevData.getBook() + ' ' + chapter + ':' + nums.join(', ') + ' (오답 연습)',
      shortReference: '계 ' + chapter + ':' + nums.join(','),
      verses: verses,
      fullText: full,
      charCount: full.replace(/\s/g, '').length
    };
  }

  function startMemorization(passage) {
    if (!passage) { global.UI.toast('선택한 범위의 본문을 찾을 수 없습니다.', true); return; }
    state.passage = passage;
    state.draft = '';
    state.hintLevel = 0;
    state.result = null;
    renderMemorize();
    startTimer();
    if (state.settings.autoFocus) {
      var ta = document.getElementById('answerInput');
      if (ta) ta.focus();
    }
  }

  function renderMemorize() {
    if (!state.passage) { go('select'); return; }
    paint('memorize', global.UI.renderMemorize({
      passage: state.passage,
      draft: state.draft,
      hintLevel: state.hintLevel,
      showTimer: state.settings.showTimer,
      voice: {
        show: !!state.settings.voiceInput,
        available: global.RevVoice.isAvailable(),
        reason: global.RevVoice.unavailableReason(),
        listening: global.RevVoice.isListening()
      }
    }));
    updateCharCount();
    paintTimer();
  }

  function updateCharCount() {
    var ta = document.getElementById('answerInput');
    var out = document.getElementById('charCount');
    if (ta && out) out.textContent = ta.value.replace(/\s/g, '').length;
  }

  /* ---------- 타이머 ---------- */

  function startTimer() {
    stopTimer();
    state.timer.startedAt = Date.now();
    state.timer.elapsed = 0;
    state.timer.running = true;
    state.timer.id = global.setInterval(function () {
      state.timer.elapsed = Math.floor((Date.now() - state.timer.startedAt) / 1000);
      paintTimer();
    }, 1000);
  }

  function stopTimer() {
    if (state.timer.id) { global.clearInterval(state.timer.id); state.timer.id = null; }
    if (state.timer.running && state.timer.startedAt) {
      state.timer.elapsed = Math.floor((Date.now() - state.timer.startedAt) / 1000);
    }
    state.timer.running = false;
  }

  function paintTimer() {
    var box = document.getElementById('timerBox');
    if (box) box.textContent = global.RevStats.formatDuration(state.timer.elapsed);
  }

  /* ---------- 힌트 ---------- */

  function useHint() {
    if (state.hintLevel >= global.UI.HINT_MAX) return;
    state.hintLevel++;
    var ta = document.getElementById('answerInput');
    if (ta) state.draft = ta.value;
    renderMemorize();
    var msg = state.settings.hintPenalty
      ? global.UI.HINT_LABELS[state.hintLevel] + ' · 감점 3점'
      : global.UI.HINT_LABELS[state.hintLevel];
    global.UI.toast(msg);
  }

  /* ---------- 음성 암송 ---------- */

  function setVoiceText(text) {
    var ta = document.getElementById('answerInput');
    if (!ta) return;
    ta.value = text;
    state.draft = text;
    updateCharCount();
    ta.scrollTop = ta.scrollHeight;
  }

  function toggleVoice() {
    var reason = global.RevVoice.unavailableReason();
    if (reason) { global.UI.toast(reason, true); return; }

    if (global.RevVoice.isListening()) {
      global.RevVoice.stop();
      return;
    }

    var ta = document.getElementById('answerInput');
    state.voiceBase = ta ? ta.value : '';

    var started = global.RevVoice.start({
      onInterim: function (combined) { setVoiceText(combined); },
      onFinal: function (combined) { setVoiceText(combined); },
      onEnd: function (finalText) {
        setVoiceText(finalText);
        if (state.screen === 'memorize') renderMemorize();
        global.UI.toast('음성 인식을 마쳤습니다.');
      },
      onError: function (msg) {
        global.UI.toast(msg, true);
        if (state.screen === 'memorize') renderMemorize();
      }
    }, state.voiceBase);

    if (started) {
      renderMemorize();
      global.UI.toast('듣고 있습니다. 천천히 또박또박 암송해보세요.');
    }
  }

  /* ---------- 채점 ---------- */

  function submitAnswer() {
    var ta = document.getElementById('answerInput');
    if (!ta) return;
    var text = ta.value;
    if (!text || !text.trim()) {
      global.UI.toast('암송한 내용을 입력해주세요.', true);
      ta.focus();
      return;
    }
    state.draft = text;
    stopTimer();
    global.RevVoice.stop();
    global.UI.setBusy(true);

    // 채점 중 화면이 멈추지 않도록 다음 프레임으로 넘긴다.
    global.setTimeout(function () {
      var result;
      try {
        result = global.RevScorer.score(state.passage, text, {
          hintsUsed: state.hintLevel,
          hintPenalty: state.settings.hintPenalty,
          strictPunctuation: state.settings.strictPunctuation
        });
      } catch (e) {
        global.UI.setBusy(false);
        global.UI.toast('채점 중 문제가 발생했습니다. 다시 시도해주세요.', true);
        return;
      }

      state.result = result;
      state.lastUserText = text;
      state.lastDuration = state.timer.elapsed;

      var saved = global.Store.saveAttempt({
        chapter: result.chapter,
        startVerse: result.startVerse,
        endVerse: result.endVerse,
        reference: state.passage.shortReference,
        partial: !!state.passage.partial,
        score: result.score,
        accuracy: result.accuracy,
        duration: state.timer.elapsed,
        hintsUsed: result.hintsUsed,
        correctCount: result.counts.correct,
        similarCount: result.counts.similar,
        wrongCount: result.counts.wrong,
        missingCount: result.counts.missing,
        extraCount: result.counts.extra,
        totalTokens: result.totalTokens,
        weakVerses: result.weakVerses
      });

      // 간격 반복 일정과 누적 암송 계획에 결과를 반영한다.
      var info = {
        id: global.RevData.rangeId(result.chapter, result.startVerse, result.endVerse),
        chapter: result.chapter,
        startVerse: result.startVerse,
        endVerse: result.endVerse,
        partial: !!state.passage.partial
      };
      state.lastSrs = state.settings.srsEnabled ? global.RevSRS.record(info, result.score) : null;
      state.lastPlan = global.RevPlan.record(info, result.score);

      global.UI.setBusy(false);
      if (!saved) global.UI.toast('점수는 계산했지만 기록 저장에 실패했습니다.', true);
      if (result.truncated) global.UI.toast('입력이 너무 길어 앞부분만 채점했습니다.', true);

      renderResult();
      updateStreakBadge();
    }, 30);
  }

  function renderResult() {
    if (!state.result) { go('home'); return; }
    var r = state.result;
    var id = global.RevData.rangeId(r.chapter, r.startVerse, r.endVerse);
    paint('result', global.UI.renderResult({
      result: r,
      duration: state.lastDuration,
      userText: state.lastUserText,
      isFavorite: global.Store.isFavorite(id),
      srs: state.lastSrs,
      planStatus: state.lastPlan
    }));
  }

  /* ---------- 즐겨찾기 ---------- */

  function toggleFavorite(chapter, startVerse, endVerse) {
    var id = global.RevData.rangeId(chapter, startVerse, endVerse);
    if (global.Store.isFavorite(id)) {
      global.Store.removeFavorite(id);
      global.UI.toast('즐겨찾기에서 삭제했습니다.');
    } else {
      var res = global.Store.addFavorite({
        id: id, book: global.RevData.getBook(),
        chapter: chapter, startVerse: startVerse, endVerse: endVerse
      });
      if (res === 'added') global.UI.toast('즐겨찾기에 추가했습니다.');
      else if (res === 'duplicate') global.UI.toast('이미 즐겨찾기에 있습니다.');
      else global.UI.toast('즐겨찾기 저장에 실패했습니다.', true);
    }
  }

  function renderFavorites() {
    var favorites = global.Store.getFavorites();
    var history = global.Store.getHistory();
    var ranges = global.RevStats.byRange(history);
    var stats = {};
    ranges.forEach(function (r) {
      if (r.partial) return;
      stats[global.RevData.rangeId(r.chapter, r.startVerse, r.endVerse)] = r;
    });
    paint('favorites', global.UI.renderFavorites({ favorites: favorites, stats: stats }));
  }

  /* ---------- 학습 기록 ---------- */

  function renderHistory() {
    var history = global.Store.getHistory();
    var summary = global.RevStats.summarize(history);
    paint('history', global.UI.renderHistory({
      history: history,
      summary: summary,
      trend: global.RevStats.recentScores(history, 12),
      achievements: global.RevStats.achievements(summary),
      weakRanges: global.RevStats.weakestRanges(history, 4).filter(function (r) { return r.average < 95; }),
      dueCards: state.settings.srsEnabled ? global.RevSRS.due() : [],
      upcomingCards: state.settings.srsEnabled ? global.RevSRS.upcoming(8) : []
    }));
  }

  /* ---------- 설정 ---------- */

  function renderSettings() {
    paint('settings', global.UI.renderSettings({
      settings: state.settings,
      favCount: global.Store.getFavorites().length,
      historyCount: global.Store.getHistory().length,
      srsCount: global.RevSRS.list().length,
      planCount: global.RevPlan.all().length,
      pwa: pwaInfo()
    }));
  }

  /* ---------- 취합 ---------- */

  function renderReport() {
    paint('report', global.UI.renderReport({
      report: state.report,
      files: state.reportFiles
    }));
  }

  function readFiles(input, onDone) {
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.length) return;
    var results = [];
    var pending = files.length;

    files.forEach(function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        try { results.push({ name: file.name, data: JSON.parse(String(reader.result)) }); }
        catch (e) { results.push({ name: file.name, data: null }); }
        if (--pending === 0) { onDone(results); input.value = ''; }
      };
      reader.onerror = function () {
        results.push({ name: file.name, data: null });
        if (--pending === 0) { onDone(results); input.value = ''; }
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  function downloadJSON(filename, obj) {
    return downloadBlob(filename, JSON.stringify(obj, null, 2), 'application/json');
  }

  function downloadText(filename, text, mime) {
    return downloadBlob(filename, text, mime || 'text/plain;charset=utf-8');
  }

  function downloadBlob(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return true;
    } catch (e) { return false; }
  }

  function readFile(input, onDone) {
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(String(reader.result)); }
      catch (e) { global.UI.toast('JSON 형식이 아닙니다.', true); input.value = ''; return; }
      onDone(parsed);
      input.value = '';
    };
    reader.onerror = function () { global.UI.toast('파일을 읽지 못했습니다.', true); input.value = ''; };
    reader.readAsText(file, 'utf-8');
  }

  /* ---------- 이벤트 ---------- */

  function bindGlobalEvents() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'), function (btn) {
      btn.addEventListener('click', function () { go(btn.getAttribute('data-nav')); });
    });
    document.getElementById('brandBtn').addEventListener('click', function () { go('home'); });
    document.getElementById('modalClose').addEventListener('click', global.UI.closeModal);
    document.getElementById('modalBack').addEventListener('click', function (e) {
      if (e.target === this) global.UI.closeModal();
    });

    var main = document.getElementById('main');
    main.addEventListener('click', onMainClick);
    main.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-action') === 'explain' &&
          (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onMainClick({ target: t, preventDefault: function () {} });
      }
    });
    main.addEventListener('change', onMainChange);
    main.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'answerInput') {
        state.draft = e.target.value;
        updateCharCount();
      }
    });

    document.addEventListener('keydown', onKeyDown);
  }

  function closestAction(node) {
    while (node && node !== document) {
      if (node.getAttribute && node.getAttribute('data-action')) return node;
      node = node.parentNode;
    }
    return null;
  }

  function onMainClick(e) {
    var el = closestAction(e.target);
    if (!el) return;
    var action = el.getAttribute('data-action');
    var sel = state.selected;

    switch (action) {
      case 'go-select': go('select'); break;
      case 'go-history': go('history'); break;
      case 'go-favorites': go('favorites'); break;
      case 'go-settings': go('settings'); break;
      case 'go-report': go('report'); break;

      /* ---- 누적 암송 ---- */
      case 'plan-start': {
        var np = global.RevPlan.start(sel.chapter, sel.startVerse, sel.endVerse);
        global.UI.toast('누적 암송을 시작합니다. ' +
          global.RevData.shortRef(np.chapter, np.startVerse, np.endVerse) + '부터 ' + np.step + '절씩 넓힙니다.');
        renderSelect();
        break;
      }
      case 'plan-advance': {
        var pc = Number(el.getAttribute('data-c')), ps = Number(el.getAttribute('data-s'));
        var st2 = global.RevPlan.advance(pc, ps);
        if (!st2) { global.UI.toast('계획을 찾지 못했습니다.', true); break; }
        if (st2.cleared) {
          global.UI.toast(pc + '장을 끝까지 완주했습니다.');
          renderSelect();
          break;
        }
        sel.chapter = st2.plan.chapter;
        sel.startVerse = st2.plan.startVerse;
        sel.endVerse = st2.plan.endVerse;
        global.UI.toast(st2.plan.stage + '단계 · ' +
          global.RevData.shortRef(sel.chapter, sel.startVerse, sel.endVerse) + '로 넓혔습니다.');
        startMemorization(global.RevData.getPassage(sel.chapter, sel.startVerse, sel.endVerse));
        break;
      }
      case 'plan-load': {
        var lc = Number(el.getAttribute('data-c')), ls = Number(el.getAttribute('data-s'));
        var lp = global.RevPlan.get(lc, ls);
        if (lp) startMemorization(global.RevData.getPassage(lp.chapter, lp.startVerse, lp.endVerse));
        break;
      }
      case 'plan-remove': {
        if (global.confirm('이 누적 암송 계획을 삭제할까요? 학습 기록은 그대로 남습니다.')) {
          global.RevPlan.remove(Number(el.getAttribute('data-c')), Number(el.getAttribute('data-s')));
          global.UI.toast('계획을 삭제했습니다.');
          renderSelect();
        }
        break;
      }
      case 'plan-reset':
        if (global.confirm('누적 암송 계획을 모두 지웁니다. 계속할까요?')) {
          global.Store.clearPlans();
          global.UI.toast('누적 계획을 초기화했습니다.');
          renderSettings();
        }
        break;

      /* ---- 간격 반복 ---- */
      case 'srs-reset':
        if (global.confirm('복습 일정을 모두 초기화합니다. 학습 기록은 그대로 남습니다. 계속할까요?')) {
          global.Store.clearSrs();
          state.lastSrs = null;
          global.UI.toast('복습 일정을 초기화했습니다.');
          go(state.screen === 'settings' ? 'settings' : 'history');
        }
        break;

      /* ---- 음성 암송 ---- */
      case 'voice': toggleVoice(); break;

      /* ---- PWA ---- */
      case 'pwa-install':
        if (state.installPrompt) {
          state.installPrompt.prompt();
          state.installPrompt = null;
          renderSettings();
        } else {
          global.UI.toast('브라우저 메뉴에서 "홈 화면에 추가"를 선택해주세요.');
        }
        break;

      /* ---- 취합 ---- */
      case 'report-csv':
        if (state.report && downloadText('계시록암송_취합_' + global.RevStats.todayKey() + '.csv',
              global.RevReport.toCSV(state.report), 'text/csv;charset=utf-8')) {
          global.UI.toast('CSV 파일을 내려받았습니다.');
        } else {
          global.UI.toast('내려받기에 실패했습니다.', true);
        }
        break;
      case 'report-clear':
        state.report = null;
        state.reportFiles = [];
        renderReport();
        break;

      case 'start-today':
        if (state.todayPick) {
          sel.chapter = state.todayPick.chapter;
          sel.startVerse = state.todayPick.startVerse;
          sel.endVerse = state.todayPick.endVerse;
          startMemorization(global.RevData.getPassage(sel.chapter, sel.startVerse, sel.endVerse));
        }
        break;

      case 'open-range':
        sel.chapter = Number(el.getAttribute('data-c'));
        sel.startVerse = Number(el.getAttribute('data-s'));
        sel.endVerse = Number(el.getAttribute('data-e'));
        clampSelection();
        startMemorization(global.RevData.getPassage(sel.chapter, sel.startVerse, sel.endVerse));
        break;

      case 'pick-range':
        sel.chapter = Number(el.getAttribute('data-c'));
        sel.startVerse = Number(el.getAttribute('data-s'));
        sel.endVerse = Number(el.getAttribute('data-e'));
        clampSelection();
        renderSelect();
        break;

      case 'whole-chapter':
        sel.startVerse = 1;
        sel.endVerse = global.RevData.getVerseCount(sel.chapter) || 1;
        renderSelect();
        break;

      case 'start':
        startMemorization(global.RevData.getPassage(sel.chapter, sel.startVerse, sel.endVerse));
        break;

      case 'toggle-fav':
        if (state.screen === 'result' && state.result) {
          toggleFavorite(state.result.chapter, state.result.startVerse, state.result.endVerse);
          renderResult();
        } else {
          toggleFavorite(sel.chapter, sel.startVerse, sel.endVerse);
          renderSelect();
        }
        break;

      case 'del-fav':
        global.Store.removeFavorite(el.getAttribute('data-id'));
        global.UI.toast('즐겨찾기에서 삭제했습니다.');
        renderFavorites();
        break;

      case 'hint': useHint(); break;
      case 'submit': submitAnswer(); break;

      case 'give-up':
        stopTimer();
        go('select');
        break;

      case 'retry':
        startMemorization(state.result.passage);
        break;

      case 'retry-weak':
        var p = buildCustomPassage(state.result.chapter, state.result.weakVerses);
        if (p) startMemorization(p);
        else global.UI.toast('연습할 절을 찾지 못했습니다.', true);
        break;

      case 'practice-verse':
        var c = Number(el.getAttribute('data-c'));
        var v = Number(el.getAttribute('data-v'));
        startMemorization(global.RevData.getPassage(c, v, v));
        break;

      case 'explain':
        var key = (el.getAttribute('data-key') || '').split('-');
        var verse = state.result && state.result.verses[Number(key[0])];
        var op = verse && verse.ops[Number(key[1])];
        if (op) global.UI.openModal(verse.verse + '절 · 어절 비교', global.UI.explainHtml(op));
        break;

      case 'clear-history':
        if (global.confirm('학습 기록을 모두 지웁니다. 되돌릴 수 없습니다. 계속할까요?')) {
          global.Store.clearHistory();
          global.UI.toast('학습 기록을 비웠습니다.');
          go(state.screen === 'settings' ? 'settings' : 'history');
          updateStreakBadge();
        }
        break;

      case 'clear-favs':
        if (global.confirm('즐겨찾기를 모두 지웁니다. 계속할까요?')) {
          global.Store.clearFavorites();
          global.UI.toast('즐겨찾기를 비웠습니다.');
          renderSettings();
        }
        break;

      case 'export':
        if (downloadJSON('계시록암송_백업.json', global.Store.exportAll())) global.UI.toast('백업 파일을 내려받았습니다.');
        else global.UI.toast('내려받기에 실패했습니다.', true);
        break;

      case 'reset-data':
        global.Store.clearCustomData();
        global.UI.toast('기본 본문으로 되돌립니다. 새로고침합니다.');
        setTimeout(function () { global.location.reload(); }, 700);
        break;

      default: break;
    }
  }

  function onMainChange(e) {
    var t = e.target;
    if (!t) return;

    var role = t.getAttribute && t.getAttribute('data-role');
    if (role) {
      var sel = state.selected;
      var value = Number(t.value);
      if (role === 'chapter') {
        sel.chapter = value;
        var max = global.RevData.getVerseCount(value) || 1;
        if (sel.startVerse > max) sel.startVerse = 1;
        if (sel.endVerse > max) sel.endVerse = max;
      } else if (role === 'start') {
        sel.startVerse = value;
      } else if (role === 'end') {
        sel.endVerse = value;
      }
      renderSelect();
      return;
    }

    var setting = t.getAttribute && t.getAttribute('data-setting');
    if (setting) {
      var patch = {};
      patch[setting] = t.checked;
      state.settings = global.Store.saveSettings(patch);
      renderSettings();
      global.UI.toast('설정을 저장했습니다.');
      return;
    }

    var textSetting = t.getAttribute && t.getAttribute('data-setting-text');
    if (textSetting) {
      var tp = {};
      tp[textSetting] = t.value;
      state.settings = global.Store.saveSettings(tp);
      global.UI.toast(state.settings.learnerName
        ? '이름을 "' + state.settings.learnerName + '"(으)로 저장했습니다.'
        : '이름을 비웠습니다.');
      return;
    }

    var action = t.getAttribute && t.getAttribute('data-action');
    if (action === 'import-data') {
      readFile(t, function (parsed) {
        var check = global.RevData.validate(parsed);
        if (!check.ok) { global.UI.toast('본문 데이터 형식이 올바르지 않습니다.', true); return; }
        global.Store.saveCustomData(parsed);
        global.UI.toast('본문 ' + check.total + '절을 불러왔습니다. 새로고침합니다.');
        setTimeout(function () { global.location.reload(); }, 900);
      });
    } else if (action === 'import-report') {
      readFiles(t, function (files) {
        var usable = files.filter(function (f) { return !!f.data; });
        if (!usable.length) {
          global.UI.toast('읽을 수 있는 백업 파일이 없습니다.', true);
          return;
        }
        state.report = global.RevReport.aggregate(usable);
        state.reportFiles = files.map(function (f) { return f.name; });
        renderReport();
        global.UI.toast(state.report.totals.learners + '명 / ' +
          state.report.totals.attempts + '회 기록을 취합했습니다.');
      });
    } else if (action === 'import-backup') {
      readFile(t, function (parsed) {
        if (global.Store.importAll(parsed)) {
          state.settings = global.Store.getSettings();
          global.UI.toast('백업을 불러왔습니다.');
          renderSettings();
          updateStreakBadge();
        } else {
          global.UI.toast('백업 파일을 인식하지 못했습니다.', true);
        }
      });
    }
  }

  function onKeyDown(e) {
    if (!document.getElementById('modalBack').hidden && e.key === 'Escape') {
      global.UI.closeModal();
      return;
    }
    if (state.screen === 'memorize') {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitAnswer(); return; }
      if (e.altKey && (e.key === 'h' || e.key === 'H' || e.key === '˙')) { e.preventDefault(); useHint(); return; }
      if (e.altKey && (e.key === 'v' || e.key === 'V' || e.key === '√')) { e.preventDefault(); toggleVoice(); return; }
      if (e.key === 'Escape') { e.preventDefault(); stopTimer(); global.RevVoice.stop(); go('select'); return; }
    }
    if (state.screen === 'result' && e.key === 'Escape') { e.preventDefault(); go('select'); }
    if (state.screen === 'report' && e.key === 'Escape') { e.preventDefault(); go('history'); }
  }

  /* ---------- 시작 ---------- */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.RevApp = { state: state, go: go };
})(window);
