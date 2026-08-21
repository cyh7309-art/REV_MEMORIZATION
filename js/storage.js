/* ============================================================
   storage.js — 저장 계층 (localStorage)
   ------------------------------------------------------------
   · 즐겨찾기 / 학습기록 / 설정 / 사용자 본문 데이터
   · 모든 접근을 이 파일에 격리한다.
     나중에 Supabase·Firebase 등으로 옮길 때 이 파일만 바꾸면 된다.
   · localStorage 사용이 막힌 환경(사생활 보호 모드 등)에서도
     앱이 죽지 않도록 메모리 폴백을 둔다.
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = {
    favorites: 'revelation_favorites',
    history:   'revelation_history',
    settings:  'revelation_settings',
    data:      'revelation_custom_data',
    srs:       'revelation_srs',
    plans:     'revelation_plans'
  };

  var HISTORY_LIMIT = 500;

  var memoryFallback = {};
  var available = (function () {
    try {
      var k = '__rev_test__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  function readRaw(key) {
    try {
      return available ? global.localStorage.getItem(key) : (memoryFallback[key] || null);
    } catch (e) { return memoryFallback[key] || null; }
  }

  function writeRaw(key, value) {
    memoryFallback[key] = value;
    if (!available) return false;
    try { global.localStorage.setItem(key, value); return true; }
    catch (e) { return false; }
  }

  function readJSON(key, fallback) {
    var raw = readRaw(key);
    if (!raw) return fallback;
    try {
      var parsed = JSON.parse(raw);
      return (parsed === null || parsed === undefined) ? fallback : parsed;
    } catch (e) { return fallback; }
  }

  function writeJSON(key, value) {
    try { return writeRaw(key, JSON.stringify(value)); }
    catch (e) { return false; }
  }

  function removeKey(key) {
    delete memoryFallback[key];
    if (!available) return;
    try { global.localStorage.removeItem(key); } catch (e) { /* noop */ }
  }

  /* ---------- 설정 ---------- */

  var DEFAULT_SETTINGS = {
    hintPenalty: true,        // 힌트 사용 시 감점
    showTimer: true,          // 암송 화면 타이머 표시
    autoFocus: true,          // 암송 시작 시 입력창 자동 포커스
    strictPunctuation: false, // 문장부호까지 엄격히 비교
    voiceInput: true,         // 음성 암송 버튼 표시
    srsEnabled: true,         // 간격 반복 복습 사용
    learnerName: ''           // 백업/취합에 표시할 이름
  };

  var NAME_MAX = 40;

  function getSettings() {
    var s = readJSON(KEY.settings, {});
    var out = {};
    for (var k in DEFAULT_SETTINGS) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) continue;
      var def = DEFAULT_SETTINGS[k];
      if (typeof def === 'boolean') {
        out[k] = (typeof s[k] === 'boolean') ? s[k] : def;
      } else {
        out[k] = (typeof s[k] === 'string') ? s[k].slice(0, NAME_MAX) : def;
      }
    }
    return out;
  }

  function saveSettings(patch) {
    var next = getSettings();
    for (var k in patch) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k)) continue;
      if (typeof DEFAULT_SETTINGS[k] === 'boolean') next[k] = !!patch[k];
      else next[k] = String(patch[k] === null || patch[k] === undefined ? '' : patch[k]).slice(0, NAME_MAX);
    }
    writeJSON(KEY.settings, next);
    return next;
  }

  /* ---------- 즐겨찾기 ---------- */

  function getFavorites() {
    var list = readJSON(KEY.favorites, []);
    if (!Array.isArray(list)) return [];
    return list.filter(function (f) {
      return f && f.id && Number(f.chapter) > 0 && Number(f.startVerse) > 0 && Number(f.endVerse) > 0;
    });
  }

  function isFavorite(id) {
    return getFavorites().some(function (f) { return f.id === id; });
  }

  /** @returns {'added'|'duplicate'|'error'} */
  function addFavorite(fav) {
    var list = getFavorites();
    if (list.some(function (f) { return f.id === fav.id; })) return 'duplicate';
    list.unshift({
      id: fav.id,
      book: fav.book || '요한계시록',
      chapter: Number(fav.chapter),
      startVerse: Number(fav.startVerse),
      endVerse: Number(fav.endVerse),
      createdAt: new Date().toISOString()
    });
    return writeJSON(KEY.favorites, list) ? 'added' : 'error';
  }

  function removeFavorite(id) {
    var list = getFavorites().filter(function (f) { return f.id !== id; });
    return writeJSON(KEY.favorites, list);
  }

  /* ---------- 학습 기록 ---------- */

  function getHistory() {
    var list = readJSON(KEY.history, []);
    if (!Array.isArray(list)) return [];
    return list.filter(function (h) { return h && h.id && typeof h.score === 'number'; });
  }

  function saveAttempt(attempt) {
    var list = getHistory();
    var record = {
      id: 'attempt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      chapter: Number(attempt.chapter),
      startVerse: Number(attempt.startVerse),
      endVerse: Number(attempt.endVerse),
      reference: attempt.reference || '',
      score: Math.round(attempt.score),
      accuracy: Number(attempt.accuracy) || 0,
      duration: Math.max(0, Math.round(attempt.duration || 0)),
      hintsUsed: Number(attempt.hintsUsed) || 0,
      correctCount: Number(attempt.correctCount) || 0,
      similarCount: Number(attempt.similarCount) || 0,
      wrongCount: Number(attempt.wrongCount) || 0,
      missingCount: Number(attempt.missingCount) || 0,
      extraCount: Number(attempt.extraCount) || 0,
      totalTokens: Number(attempt.totalTokens) || 0,
      partial: !!attempt.partial,
      weakVerses: Array.isArray(attempt.weakVerses) ? attempt.weakVerses.slice(0, 30) : [],
      createdAt: new Date().toISOString()
    };
    list.unshift(record);
    if (list.length > HISTORY_LIMIT) list = list.slice(0, HISTORY_LIMIT);
    var ok = writeJSON(KEY.history, list);
    return ok ? record : null;
  }

  function clearHistory() { removeKey(KEY.history); }
  function clearFavorites() { removeKey(KEY.favorites); }

  /* ---------- 간격 반복(SRS) 카드 ---------- */

  function getSrs() {
    var obj = readJSON(KEY.srs, {});
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
  }
  function saveSrs(obj) { return writeJSON(KEY.srs, obj || {}); }
  function clearSrs() { removeKey(KEY.srs); }

  /* ---------- 누적 암송 계획 ---------- */

  function getPlans() {
    var obj = readJSON(KEY.plans, {});
    return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
  }
  function savePlans(obj) { return writeJSON(KEY.plans, obj || {}); }
  function clearPlans() { removeKey(KEY.plans); }

  /* ---------- 사용자 본문 데이터 ---------- */

  function getCustomData() { return readJSON(KEY.data, null); }
  function saveCustomData(obj) { return writeJSON(KEY.data, obj); }
  function clearCustomData() { removeKey(KEY.data); }

  /* ---------- 내보내기 / 가져오기 ---------- */

  function exportAll() {
    var settings = getSettings();
    return {
      exportedAt: new Date().toISOString(),
      app: 'revelation-memory',
      version: 2,
      learnerName: settings.learnerName || '',
      favorites: getFavorites(),
      history: getHistory(),
      settings: settings,
      srs: getSrs(),
      plans: getPlans()
    };
  }

  function importAll(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (Array.isArray(obj.favorites)) writeJSON(KEY.favorites, obj.favorites);
    if (Array.isArray(obj.history)) writeJSON(KEY.history, obj.history.slice(0, HISTORY_LIMIT));
    if (obj.settings && typeof obj.settings === 'object') saveSettings(obj.settings);
    if (obj.srs && typeof obj.srs === 'object' && !Array.isArray(obj.srs)) saveSrs(obj.srs);
    if (obj.plans && typeof obj.plans === 'object' && !Array.isArray(obj.plans)) savePlans(obj.plans);
    return true;
  }

  global.Store = {
    KEY: KEY,
    isAvailable: function () { return available; },
    getSettings: getSettings,
    saveSettings: saveSettings,
    getFavorites: getFavorites,
    isFavorite: isFavorite,
    addFavorite: addFavorite,
    removeFavorite: removeFavorite,
    clearFavorites: clearFavorites,
    getHistory: getHistory,
    saveAttempt: saveAttempt,
    clearHistory: clearHistory,
    getSrs: getSrs,
    saveSrs: saveSrs,
    clearSrs: clearSrs,
    getPlans: getPlans,
    savePlans: savePlans,
    clearPlans: clearPlans,
    getCustomData: getCustomData,
    saveCustomData: saveCustomData,
    clearCustomData: clearCustomData,
    exportAll: exportAll,
    importAll: importAll
  };
})(window);
