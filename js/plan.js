/* ============================================================
   plan.js — 누적 암송 계획
   ------------------------------------------------------------
   · 짧은 범위를 외운 뒤 조금씩 뒤로 넓혀가며 한 장을 통째로 쌓아가는 방식.
     계 1:1~4 → 1:1~8 → 1:1~12 → … → 1:1~20
   · 통과 기준 점수를 넘으면 다음 단계로 확장할 수 있다.
   ============================================================ */
(function (global) {
  'use strict';

  var CONFIG = {
    PASS_SCORE: 90,   // 이 점수 이상이면 다음 단계로 확장 가능
    DEFAULT_STEP: 4,  // 한 단계에 늘리는 절 수
    MIN_STEP: 1,
    MAX_STEP: 10
  };

  function planId(chapter, startVerse) { return 'plan-' + chapter + '-' + startVerse; }

  function normalize(p) {
    if (!p || !p.id) return null;
    return {
      id: p.id,
      chapter: Number(p.chapter),
      startVerse: Number(p.startVerse),
      endVerse: Number(p.endVerse),
      step: Math.min(CONFIG.MAX_STEP, Math.max(CONFIG.MIN_STEP, Number(p.step) || CONFIG.DEFAULT_STEP)),
      stage: Number(p.stage) || 1,
      best: Number(p.best) || 0,
      lastScore: Number(p.lastScore) || 0,
      cleared: !!p.cleared,
      createdAt: p.createdAt || new Date().toISOString(),
      updatedAt: p.updatedAt || new Date().toISOString()
    };
  }

  function all() {
    var raw = global.Store.getPlans();
    var out = [];
    Object.keys(raw).forEach(function (k) {
      var p = normalize(raw[k]);
      if (p) out.push(p);
    });
    return out.sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });
  }

  function get(chapter, startVerse) {
    return global.Store.getPlans()[planId(chapter, startVerse)] || null;
  }

  function save(plan) {
    var raw = global.Store.getPlans();
    plan.updatedAt = new Date().toISOString();
    raw[plan.id] = plan;
    global.Store.savePlans(raw);
    return plan;
  }

  /** 장의 마지막 절 */
  function chapterEnd(chapter) {
    return global.RevData.getVerseCount(chapter) || 0;
  }

  /** 계획을 시작한다. 이미 있으면 기존 계획을 돌려준다. */
  function start(chapter, startVerse, endVerse, step) {
    var existing = get(chapter, startVerse);
    if (existing) return normalize(existing);
    var plan = normalize({
      id: planId(chapter, startVerse),
      chapter: chapter,
      startVerse: startVerse,
      endVerse: endVerse,
      step: step || CONFIG.DEFAULT_STEP,
      stage: 1,
      best: 0
    });
    return save(plan);
  }

  function remove(chapter, startVerse) {
    var raw = global.Store.getPlans();
    var id = planId(chapter, startVerse);
    if (raw[id]) { delete raw[id]; global.Store.savePlans(raw); }
  }

  /**
   * 채점 결과를 계획에 반영한다.
   * 현재 단계의 범위와 정확히 일치할 때만 반영한다.
   * @returns {{plan:object, canAdvance:boolean, nextEnd:number, cleared:boolean}|null}
   */
  function record(info, score) {
    if (!info || info.partial) return null;
    var raw = global.Store.getPlans();
    var plan = normalize(raw[planId(info.chapter, info.startVerse)]);
    if (!plan) return null;
    if (plan.endVerse !== Number(info.endVerse)) return null;

    plan.lastScore = Math.round(Number(score) || 0);
    if (plan.lastScore > plan.best) plan.best = plan.lastScore;
    save(plan);

    return status(plan);
  }

  /** 현재 계획의 진행 상태를 계산한다. */
  function status(plan) {
    var end = chapterEnd(plan.chapter);
    var atEnd = plan.endVerse >= end;
    var nextEnd = Math.min(end, plan.endVerse + plan.step);
    var totalVerses = end - plan.startVerse + 1;
    var doneVerses = plan.endVerse - plan.startVerse + 1;
    return {
      plan: plan,
      chapterEnd: end,
      atEnd: atEnd,
      nextEnd: nextEnd,
      canAdvance: !atEnd && plan.lastScore >= CONFIG.PASS_SCORE,
      cleared: atEnd && plan.lastScore >= CONFIG.PASS_SCORE,
      progress: totalVerses > 0 ? Math.round((doneVerses / totalVerses) * 100) : 0,
      doneVerses: doneVerses,
      totalVerses: totalVerses
    };
  }

  /** 다음 단계로 범위를 넓힌다. */
  function advance(chapter, startVerse) {
    var plan = normalize(get(chapter, startVerse));
    if (!plan) return null;
    var st = status(plan);
    if (st.atEnd) {
      plan.cleared = true;
      save(plan);
      return status(plan);
    }
    plan.endVerse = st.nextEnd;
    plan.stage = plan.stage + 1;
    plan.lastScore = 0;
    save(plan);
    return status(plan);
  }

  /** 홈 화면에 보여줄 진행 중인 계획 목록 */
  function active(limit) {
    return all().filter(function (p) { return !p.cleared; })
      .map(status)
      .slice(0, limit || 3);
  }

  global.RevPlan = {
    CONFIG: CONFIG,
    planId: planId,
    all: all,
    get: function (c, s) { return normalize(get(c, s)); },
    start: start,
    remove: remove,
    record: record,
    status: status,
    advance: advance,
    active: active
  };
})(window);
