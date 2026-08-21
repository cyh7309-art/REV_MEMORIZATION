/* ============================================================
   report.js — 여러 명 학습 현황 취합
   ------------------------------------------------------------
   · 수강생들이 [설정 > 백업 파일 내려받기]로 만든 JSON을 모아
     인원별 / 범위별 / 절별로 집계한다.
   · 순수 계산 모듈. 파일 읽기와 화면 표시는 app.js·ui.js가 맡는다.
   · 집계 결과는 저장하지 않는다(메모리에만 유지).
   ============================================================ */
(function (global) {
  'use strict';

  function safeArray(v) { return Array.isArray(v) ? v : []; }

  /** 백업 파일 하나를 학습자 한 명의 기록으로 정리한다. */
  function normalizeSource(source, fallbackName) {
    var obj = source && source.data ? source.data : source;
    if (!obj || typeof obj !== 'object') return null;

    var history = safeArray(obj.history).filter(function (h) {
      return h && typeof h.score === 'number' && Number(h.chapter) > 0;
    });
    var name = (obj.settings && obj.settings.learnerName) ||
               obj.learnerName || obj.name ||
               (source && source.name) || fallbackName || '이름 없음';

    return {
      name: String(name).replace(/\.json$/i, '').trim() || '이름 없음',
      history: history,
      favorites: safeArray(obj.favorites),
      exportedAt: obj.exportedAt || null
    };
  }

  function learnerSummary(entry) {
    var h = entry.history;
    var summary = global.RevStats.summarize(h);
    var last = h.length ? h[0].createdAt : null;
    var full = h.filter(function (x) { return !x.partial; });
    return {
      name: entry.name,
      attempts: summary.total,
      average: summary.average,
      best: summary.best,
      streak: summary.streak,
      seconds: summary.totalSeconds,
      rangeCount: summary.rangeCount,
      perfect: summary.perfectCount,
      lastAt: last,
      lastScore: h.length ? h[0].score : 0,
      fullAttempts: full.length,
      exportedAt: entry.exportedAt
    };
  }

  /**
   * 여러 백업을 하나의 보고서로 합친다.
   * @param {Array<{name:string, data:object}>} sources
   */
  function aggregate(sources) {
    var entries = [];
    var skipped = [];

    safeArray(sources).forEach(function (src, i) {
      var e = normalizeSource(src, '참가자 ' + (i + 1));
      if (!e) { skipped.push((src && src.name) || '알 수 없는 파일'); return; }
      if (!e.history.length) { skipped.push(e.name + ' (기록 없음)'); return; }
      entries.push(e);
    });

    var learners = entries.map(learnerSummary)
      .sort(function (a, b) { return b.average - a.average; });

    /* ---- 전체 합계 ---- */
    var attempts = 0, scoreSum = 0, seconds = 0, best = 0;
    entries.forEach(function (e) {
      e.history.forEach(function (h) {
        attempts++;
        scoreSum += h.score;
        seconds += h.duration || 0;
        if (h.score > best) best = h.score;
      });
    });

    /* ---- 범위별 집계 ---- */
    var rangeMap = {};
    entries.forEach(function (e) {
      e.history.forEach(function (h) {
        if (h.partial) return;
        var key = h.chapter + '-' + h.startVerse + '-' + h.endVerse;
        if (!rangeMap[key]) {
          rangeMap[key] = {
            key: key,
            chapter: Number(h.chapter),
            startVerse: Number(h.startVerse),
            endVerse: Number(h.endVerse),
            attempts: 0, sum: 0, best: 0, low: 100,
            learners: {}, passed: 0
          };
        }
        var r = rangeMap[key];
        r.attempts++;
        r.sum += h.score;
        if (h.score > r.best) r.best = h.score;
        if (h.score < r.low) r.low = h.score;
        if (h.score >= 90) r.passed++;
        r.learners[e.name] = true;
      });
    });

    var ranges = Object.keys(rangeMap).map(function (k) {
      var r = rangeMap[k];
      r.learnerCount = Object.keys(r.learners).length;
      r.average = Math.round(r.sum / r.attempts);
      r.passRate = Math.round((r.passed / r.attempts) * 100);
      r.reference = '계 ' + r.chapter + ':' + r.startVerse +
        (r.startVerse === r.endVerse ? '' : '~' + r.endVerse);
      delete r.learners;
      delete r.sum;
      return r;
    }).sort(function (a, b) { return a.average - b.average; });

    /* ---- 절별 취약 집계 ---- */
    var verseMap = {};
    entries.forEach(function (e) {
      e.history.forEach(function (h) {
        safeArray(h.weakVerses).forEach(function (v) {
          var key = h.chapter + ':' + v;
          if (!verseMap[key]) {
            verseMap[key] = { chapter: Number(h.chapter), verse: Number(v), count: 0, learners: {} };
          }
          verseMap[key].count++;
          verseMap[key].learners[e.name] = true;
        });
      });
    });

    var weakVerses = Object.keys(verseMap).map(function (k) {
      var v = verseMap[k];
      v.learnerCount = Object.keys(v.learners).length;
      v.reference = '계 ' + v.chapter + ':' + v.verse;
      delete v.learners;
      return v;
    }).sort(function (a, b) {
      if (b.learnerCount !== a.learnerCount) return b.learnerCount - a.learnerCount;
      return b.count - a.count;
    });

    /* ---- 참여도 ---- */
    var today = global.RevStats.todayKey();
    var activeToday = learners.filter(function (l) {
      return l.lastAt && global.RevStats.dayKey(l.lastAt) === today;
    }).length;
    var inactive = learners.filter(function (l) {
      if (!l.lastAt) return true;
      var d = global.RevStats.dayKey(l.lastAt);
      return daysAgo(d, today) >= 7;
    });

    return {
      generatedAt: new Date().toISOString(),
      skipped: skipped,
      totals: {
        learners: learners.length,
        attempts: attempts,
        average: attempts ? Math.round(scoreSum / attempts) : 0,
        best: best,
        seconds: seconds,
        activeToday: activeToday,
        inactiveCount: inactive.length,
        rangeCount: ranges.length
      },
      learners: learners,
      inactive: inactive,
      ranges: ranges,
      weakVerses: weakVerses
    };
  }

  function daysAgo(fromKey, toKey) {
    if (!fromKey || !toKey) return 999;
    var a = String(fromKey).split('-'), b = String(toKey).split('-');
    var da = new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2]));
    var db = new Date(Number(b[0]), Number(b[1]) - 1, Number(b[2]));
    return Math.round((db - da) / 86400000);
  }

  /* ---------- CSV ---------- */

  function csvCell(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function csvRows(rows) {
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  /**
   * 엑셀에서 바로 열리도록 BOM 을 붙인 CSV 문자열을 만든다.
   */
  function toCSV(report) {
    var rows = [];
    rows.push(['계시록 암송 학습 현황 취합']);
    rows.push(['생성 시각', global.RevStats.formatDate(report.generatedAt)]);
    rows.push(['인원', report.totals.learners, '총 암송', report.totals.attempts,
               '전체 평균', report.totals.average, '오늘 학습', report.totals.activeToday]);
    rows.push([]);

    rows.push(['[ 인원별 현황 ]']);
    rows.push(['이름', '암송 횟수', '평균 점수', '최고 점수', '연속 학습일', '총 학습 시간(분)', '암송 범위 수', '최근 학습일', '최근 점수']);
    report.learners.forEach(function (l) {
      rows.push([l.name, l.attempts, l.average, l.best, l.streak,
                 Math.round(l.seconds / 60), l.rangeCount,
                 l.lastAt ? global.RevStats.dayKey(l.lastAt) : '', l.lastScore]);
    });
    rows.push([]);

    rows.push(['[ 범위별 현황 — 평균 낮은 순 ]']);
    rows.push(['범위', '참여 인원', '시도 횟수', '평균 점수', '최고', '최저', '90점 이상 비율(%)']);
    report.ranges.forEach(function (r) {
      rows.push([r.reference, r.learnerCount, r.attempts, r.average, r.best, r.low, r.passRate]);
    });
    rows.push([]);

    rows.push(['[ 자주 틀리는 절 ]']);
    rows.push(['절', '틀린 인원', '누적 횟수']);
    report.weakVerses.slice(0, 40).forEach(function (v) {
      rows.push([v.reference, v.learnerCount, v.count]);
    });

    if (report.inactive.length) {
      rows.push([]);
      rows.push(['[ 7일 이상 미학습 ]']);
      rows.push(['이름', '최근 학습일']);
      report.inactive.forEach(function (l) {
        rows.push([l.name, l.lastAt ? global.RevStats.dayKey(l.lastAt) : '기록 없음']);
      });
    }

    return '﻿' + csvRows(rows);
  }

  global.RevReport = {
    normalizeSource: normalizeSource,
    aggregate: aggregate,
    toCSV: toCSV
  };
})(window);
