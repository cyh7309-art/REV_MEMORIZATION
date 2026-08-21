/* ============================================================
   statistics.js — 학습 통계
   ------------------------------------------------------------
   · 학습 기록 배열을 받아 홈/학습기록 화면에 필요한 수치를 만든다.
   · 저장소나 DOM에 의존하지 않는 순수 계산 모듈.
   ============================================================ */
(function (global) {
  'use strict';

  function dayKey(dateLike) {
    var d = new Date(dateLike);
    if (isNaN(d.getTime())) return null;
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function todayKey() { return dayKey(new Date()); }

  function shiftDay(key, delta) {
    var p = key.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + delta);
    return dayKey(d);
  }

  /** 로컬 시간 기준 연속 학습일 (오늘 또는 어제부터 이어진 날짜 수) */
  function streak(history) {
    if (!history.length) return 0;
    var days = {};
    history.forEach(function (h) {
      var k = dayKey(h.createdAt);
      if (k) days[k] = true;
    });
    var today = todayKey();
    var cursor = days[today] ? today : shiftDay(today, -1);
    if (!days[cursor]) return 0;
    var count = 0;
    while (days[cursor]) { count++; cursor = shiftDay(cursor, -1); }
    return count;
  }

  function formatDuration(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return h > 0 ? (h + ':' + p(m) + ':' + p(s)) : (p(m) + ':' + p(s));
  }

  function formatDurationKo(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    if (h > 0) return h + '시간 ' + m + '분';
    if (m > 0) return m + '분';
    return sec + '초';
  }

  function formatDate(dateLike) {
    var d = new Date(dateLike);
    if (isNaN(d.getTime())) return '';
    var m = d.getMonth() + 1, day = d.getDate();
    var hh = d.getHours(), mm = d.getMinutes();
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return m + '월 ' + day + '일 ' + p(hh) + ':' + p(mm);
  }

  /** 홈/기록 화면용 요약 통계 */
  function summarize(history) {
    var total = history.length;
    if (!total) {
      return {
        total: 0, best: 0, average: 0, latest: 0,
        totalSeconds: 0, streak: 0, todayCount: 0,
        rangeCount: 0, perfectCount: 0
      };
    }
    var sum = 0, best = 0, seconds = 0, perfect = 0;
    var ranges = {};
    var today = todayKey(), todayCount = 0;

    history.forEach(function (h) {
      sum += h.score;
      if (h.score > best) best = h.score;
      seconds += h.duration || 0;
      if (h.score === 100) perfect++;
      ranges[h.chapter + '-' + h.startVerse + '-' + h.endVerse] = true;
      if (dayKey(h.createdAt) === today) todayCount++;
    });

    return {
      total: total,
      best: best,
      average: Math.round(sum / total),
      latest: history[0].score,
      totalSeconds: seconds,
      streak: streak(history),
      todayCount: todayCount,
      rangeCount: Object.keys(ranges).length,
      perfectCount: perfect
    };
  }

  /** 범위별 집계 — 자주 틀리는 구간을 찾기 위한 것 */
  function byRange(history) {
    var map = {};
    history.forEach(function (h) {
      var key = h.chapter + '-' + h.startVerse + '-' + h.endVerse + (h.partial ? '-p' : '');
      if (!map[key]) {
        map[key] = {
          key: key,
          chapter: h.chapter, startVerse: h.startVerse, endVerse: h.endVerse, partial: !!h.partial,
          reference: h.reference || ('계 ' + h.chapter + ':' + h.startVerse + '~' + h.endVerse),
          count: 0, sum: 0, best: 0, last: h.createdAt, lastScore: h.score
        };
      }
      var r = map[key];
      r.count++;
      r.sum += h.score;
      if (h.score > r.best) r.best = h.score;
      if (new Date(h.createdAt) > new Date(r.last)) { r.last = h.createdAt; r.lastScore = h.score; }
    });
    return Object.keys(map).map(function (k) {
      var r = map[k];
      r.average = Math.round(r.sum / r.count);
      return r;
    }).sort(function (a, b) { return a.average - b.average; });
  }

  /** 가장 약한 범위 (2회 이상 시도한 것 우선, 오답 연습 기록은 제외) */
  function weakestRanges(history, limit) {
    var list = byRange(history).filter(function (r) { return !r.partial; });
    var tried = list.filter(function (r) { return r.count >= 2; });
    var pool = tried.length ? tried : list;
    return pool.slice(0, limit || 3);
  }

  /** 절 단위로 자주 틀린 곳 */
  function weakVerses(history, limit) {
    var map = {};
    history.forEach(function (h) {
      (h.weakVerses || []).forEach(function (v) {
        var key = h.chapter + ':' + v;
        if (!map[key]) map[key] = { chapter: h.chapter, verse: v, count: 0 };
        map[key].count++;
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, limit || 5);
  }

  /** 최근 N회의 점수 추이 (오래된 것 → 최근 순) */
  function recentScores(history, n) {
    return history.slice(0, n || 10).map(function (h) {
      return { score: h.score, at: h.createdAt, reference: h.reference };
    }).reverse();
  }

  /* ---------- 성취 ---------- */

  var ACHIEVEMENTS = [
    { id: 'first',     icon: '🌱', name: '첫 암송',      desc: '처음 암송을 마쳤습니다',  test: function (s) { return s.total >= 1; } },
    { id: 'ten',       icon: '🌿', name: '10회 암송',    desc: '10회 이상 암송',          test: function (s) { return s.total >= 10; } },
    { id: 'hundred',   icon: '🌳', name: '100회 암송',   desc: '100회 이상 암송',         test: function (s) { return s.total >= 100; } },
    { id: 'score90',   icon: '🎯', name: '90점 달성',    desc: '한 번이라도 90점 이상',   test: function (s) { return s.best >= 90; } },
    { id: 'score100',  icon: '🏆', name: '100점 달성',   desc: '완전한 암송 1회',         test: function (s) { return s.best >= 100; } },
    { id: 'streak7',   icon: '🔥', name: '7일 연속',     desc: '7일 연속 학습',           test: function (s) { return s.streak >= 7; } },
    { id: 'streak30',  icon: '☀️', name: '30일 연속',    desc: '30일 연속 학습',          test: function (s) { return s.streak >= 30; } },
    { id: 'range10',   icon: '🗺️', name: '10개 범위',    desc: '서로 다른 10개 범위 암송', test: function (s) { return s.rangeCount >= 10; } }
  ];

  function achievements(summary) {
    return ACHIEVEMENTS.map(function (a) {
      return { id: a.id, icon: a.icon, name: a.name, desc: a.desc, earned: !!a.test(summary) };
    });
  }

  /* ---------- 오늘의 암송 추천 ---------- */

  var DEFAULT_PICKS = [
    { chapter: 1, startVerse: 1, endVerse: 8 },
    { chapter: 2, startVerse: 1, endVerse: 7 },
    { chapter: 3, startVerse: 14, endVerse: 22 },
    { chapter: 12, startVerse: 1, endVerse: 6 },
    { chapter: 21, startVerse: 1, endVerse: 8 },
    { chapter: 22, startVerse: 12, endVerse: 21 }
  ];

  /**
   * 오늘의 암송을 고른다.
   *  1순위: 최근에 80점 미만이었던 범위 (복습이 필요한 곳)
   *  2순위: 즐겨찾기 중 오늘 아직 하지 않은 범위
   *  3순위: 기본 추천 목록 중 날짜 기반으로 회전
   * 같은 범위가 계속 나오지 않도록 오늘 이미 한 범위는 뒤로 미룬다.
   */
  function todayPick(history, favorites) {
    var today = todayKey();
    var doneToday = {};
    history.forEach(function (h) {
      if (dayKey(h.createdAt) === today) {
        doneToday[h.chapter + '-' + h.startVerse + '-' + h.endVerse] = true;
      }
    });
    function fresh(item) {
      return !doneToday[item.chapter + '-' + item.startVerse + '-' + item.endVerse];
    }

    var weak = weakestRanges(history, 5).filter(function (r) { return r.average < 85; }).filter(fresh);
    if (weak.length) {
      return { chapter: weak[0].chapter, startVerse: weak[0].startVerse, endVerse: weak[0].endVerse, reason: '복습이 필요한 범위' };
    }

    var favs = (favorites || []).filter(fresh);
    if (favs.length) {
      var idx = new Date().getDate() % favs.length;
      var f = favs[idx];
      return { chapter: f.chapter, startVerse: f.startVerse, endVerse: f.endVerse, reason: '즐겨찾기에서 추천' };
    }

    var pool = DEFAULT_PICKS.filter(fresh);
    if (!pool.length) pool = DEFAULT_PICKS;
    var seed = Math.floor(new Date(today).getTime() / 86400000);
    var pick = pool[Math.abs(seed) % pool.length];
    return { chapter: pick.chapter, startVerse: pick.startVerse, endVerse: pick.endVerse, reason: '오늘의 추천 범위' };
  }

  global.RevStats = {
    dayKey: dayKey,
    todayKey: todayKey,
    streak: streak,
    summarize: summarize,
    byRange: byRange,
    weakestRanges: weakestRanges,
    weakVerses: weakVerses,
    recentScores: recentScores,
    achievements: achievements,
    todayPick: todayPick,
    formatDuration: formatDuration,
    formatDurationKo: formatDurationKo,
    formatDate: formatDate,
    DEFAULT_PICKS: DEFAULT_PICKS
  };
})(window);
