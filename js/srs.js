/* ============================================================
   srs.js — 간격 반복 복습 스케줄러 (SM-2)
   ------------------------------------------------------------
   · 암송 범위마다 "다음에 언제 다시 볼지"를 계산한다.
   · SuperMemo-2 알고리즘을 암송 점수에 맞게 조정해 사용한다.
   · 저장은 storage.js 를 통해서만 한다. DOM 의존 없음.
   ============================================================ */
(function (global) {
  'use strict';

  var CONFIG = {
    MIN_EASE: 1.3,       // 난이도 계수 하한
    START_EASE: 2.5,     // 처음 시작 계수
    PASS_QUALITY: 3,     // 이 값 미만이면 처음부터 다시
    FIRST_INTERVAL: 1,   // 1회 통과 후 (일)
    SECOND_INTERVAL: 4,  // 2회 연속 통과 후 (일)
    MAX_INTERVAL: 180    // 너무 멀어지지 않도록 상한 (일)
  };

  /**
   * 암송 점수(0~100)를 SM-2 의 응답 품질(0~5)로 환산한다.
   *   95+ 완벽 / 90+ 아주 좋음 / 80+ 통과 / 70+ 아슬아슬 / 60+ 실패 / 그 미만 완전 실패
   */
  function qualityFromScore(score) {
    var s = Number(score) || 0;
    if (s >= 95) return 5;
    if (s >= 90) return 4;
    if (s >= 80) return 3;
    if (s >= 70) return 2;
    if (s >= 60) return 1;
    return 0;
  }

  function clampEase(e) { return e < CONFIG.MIN_EASE ? CONFIG.MIN_EASE : e; }

  function newCard(info) {
    return {
      id: info.id,
      chapter: Number(info.chapter),
      startVerse: Number(info.startVerse),
      endVerse: Number(info.endVerse),
      ease: CONFIG.START_EASE,
      interval: 0,
      reps: 0,
      lapses: 0,
      lastScore: 0,
      last: null,
      due: global.RevStats.todayKey()
    };
  }

  /**
   * 한 번의 암송 결과를 반영해 다음 복습일을 계산한다.
   * @returns {{card:object, quality:number, passed:boolean, intervalDays:number}}
   */
  function applyResult(card, score, todayKey) {
    var q = qualityFromScore(score);
    var passed = q >= CONFIG.PASS_QUALITY;
    var next = {
      id: card.id,
      chapter: card.chapter,
      startVerse: card.startVerse,
      endVerse: card.endVerse,
      ease: card.ease,
      interval: card.interval,
      reps: card.reps,
      lapses: card.lapses,
      lastScore: Math.round(Number(score) || 0),
      last: todayKey,
      due: card.due
    };

    if (!passed) {
      next.reps = 0;
      next.lapses = card.lapses + 1;
      next.interval = CONFIG.FIRST_INTERVAL;
    } else {
      next.reps = card.reps + 1;
      if (next.reps === 1) next.interval = CONFIG.FIRST_INTERVAL;
      else if (next.reps === 2) next.interval = CONFIG.SECOND_INTERVAL;
      else next.interval = Math.round(card.interval * card.ease);
    }

    // SM-2 난이도 계수 갱신
    next.ease = clampEase(card.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    next.ease = Math.round(next.ease * 1000) / 1000;

    if (next.interval < 1) next.interval = 1;
    if (next.interval > CONFIG.MAX_INTERVAL) next.interval = CONFIG.MAX_INTERVAL;

    next.due = addDays(todayKey, next.interval);
    return { card: next, quality: q, passed: passed, intervalDays: next.interval };
  }

  function addDays(dayKey, days) {
    var p = String(dayKey).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + days);
    return global.RevStats.dayKey(d);
  }

  function daysBetween(fromKey, toKey) {
    var a = String(fromKey).split('-'), b = String(toKey).split('-');
    var da = new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2]));
    var db = new Date(Number(b[0]), Number(b[1]) - 1, Number(b[2]));
    return Math.round((db - da) / 86400000);
  }

  /* ---------- 저장소와 연결된 API ---------- */

  /**
   * 채점 결과를 복습 일정에 반영한다. (오답 연습 같은 부분 범위는 제외)
   */
  function record(info, score) {
    if (!info || info.partial) return null;
    var all = global.Store.getSrs();
    var card = all[info.id] || newCard(info);
    var today = global.RevStats.todayKey();
    var out = applyResult(card, score, today);
    all[info.id] = out.card;
    global.Store.saveSrs(all);
    return out;
  }

  function list() {
    var all = global.Store.getSrs();
    return Object.keys(all).map(function (k) { return all[k]; })
      .filter(function (c) { return c && c.id && c.due; });
  }

  /** 오늘(또는 그 전)이 복습일인 범위 — 밀린 순서대로 */
  function due(todayKey) {
    var today = todayKey || global.RevStats.todayKey();
    return list()
      .filter(function (c) { return daysBetween(c.due, today) >= 0; })
      .map(function (c) {
        c.overdueDays = daysBetween(c.due, today);
        return c;
      })
      .sort(function (a, b) {
        if (b.overdueDays !== a.overdueDays) return b.overdueDays - a.overdueDays;
        return a.lastScore - b.lastScore;
      });
  }

  /** 앞으로 다가올 복습 일정 */
  function upcoming(limit, todayKey) {
    var today = todayKey || global.RevStats.todayKey();
    return list()
      .filter(function (c) { return daysBetween(c.due, today) < 0; })
      .map(function (c) { c.inDays = daysBetween(today, c.due); return c; })
      .sort(function (a, b) { return a.inDays - b.inDays; })
      .slice(0, limit || 5);
  }

  function get(id) { return global.Store.getSrs()[id] || null; }

  function remove(id) {
    var all = global.Store.getSrs();
    if (all[id]) { delete all[id]; global.Store.saveSrs(all); }
  }

  /** 사람이 읽을 수 있는 다음 복습일 문구 */
  function dueLabel(card, todayKey) {
    var today = todayKey || global.RevStats.todayKey();
    var diff = daysBetween(today, card.due);
    if (diff < 0) return (-diff) + '일 지남';
    if (diff === 0) return '오늘';
    if (diff === 1) return '내일';
    return diff + '일 뒤';
  }

  global.RevSRS = {
    CONFIG: CONFIG,
    qualityFromScore: qualityFromScore,
    applyResult: applyResult,
    addDays: addDays,
    daysBetween: daysBetween,
    record: record,
    list: list,
    due: due,
    upcoming: upcoming,
    get: get,
    remove: remove,
    dueLabel: dueLabel
  };
})(window);
