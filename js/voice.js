/* ============================================================
   voice.js — 음성 암송 (Web Speech API 래퍼)
   ------------------------------------------------------------
   · 마이크로 암송한 내용을 텍스트로 바꿔 입력창에 넣어준다.
   · 채점은 기존 scorer.js 를 그대로 쓴다. (입력 방식과 무관하게 설계됨)
   · 브라우저 지원이 없거나 보안 컨텍스트가 아니면 조용히 비활성화한다.
   ============================================================ */
(function (global) {
  'use strict';

  var Impl = global.SpeechRecognition || global.webkitSpeechRecognition || null;

  var session = {
    recognition: null,
    listening: false,
    baseText: '',      // 인식 시작 시점에 입력창에 있던 내용
    segments: {},      // 결과 인덱스 → {text, final}
    finalText: '',
    handlers: {},
    wantListening: false,
    emptyRuns: 0
  };

  /* 한 번의 인식에서 조용해도 다시 듣기를 이어가는 최대 횟수.
     안드로이드 크롬은 잠깐만 조용해도 인식을 끝내버리기 때문에 필요하다. */
  var MAX_EMPTY_RESTARTS = 3;

  function isSupported() { return !!Impl; }

  /**
   * 음성 인식은 보안 컨텍스트(https 또는 localhost)에서만 동작한다.
   * file:// 로 연 경우 마이크 권한을 얻을 수 없다.
   */
  function isSecure() {
    if (typeof global.isSecureContext === 'boolean') return global.isSecureContext;
    var p = global.location && global.location.protocol;
    return p === 'https:' || (global.location && global.location.hostname === 'localhost');
  }

  function unavailableReason() {
    if (!isSupported()) return '이 브라우저는 음성 인식을 지원하지 않습니다. (Chrome·Edge·Safari 권장)';
    if (!isSecure()) return '음성 암송은 https 또는 localhost 에서만 동작합니다. 로컬 서버로 열어주세요.';
    return null;
  }

  function isAvailable() { return unavailableReason() === null; }
  function isListening() { return session.listening; }

  /**
   * 인식을 시작한다.
   * @param {object} handlers {onInterim, onFinal, onEnd, onError}
   * @param {string} baseText 이미 입력창에 있던 내용 (뒤에 이어 붙인다)
   */
  function start(handlers, baseText) {
    var reason = unavailableReason();
    if (reason) {
      if (handlers && handlers.onError) handlers.onError(reason);
      return false;
    }
    if (session.listening) return false;

    session.handlers = handlers || {};
    session.baseText = baseText ? String(baseText) : '';
    session.finalText = session.baseText;
    session.segments = {};
    session.wantListening = true;
    session.emptyRuns = 0;

    return launch();
  }

  /** 실제 인식기를 만들어 띄운다. (처음 시작과 자동 재개가 공유한다) */
  function launch() {
    var closed = false;   // 한 인식기의 종료 처리는 한 번만 (중복 onend 방어)
    var rec = new Impl();
    rec.lang = 'ko-KR';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = function (event) {
      absorbResults(session.segments, event && event.results);
      var out = composeText(session.baseText, session.segments);

      // 뭔가 들렸으므로 "조용해서 끝난 횟수"를 초기화한다.
      if (out.combined !== session.baseText) session.emptyRuns = 0;

      var changedFinal = (out.final !== session.finalText);
      session.finalText = out.final;

      if (changedFinal && session.handlers.onFinal) session.handlers.onFinal(out.final);
      if (out.interim && session.handlers.onInterim) {
        session.handlers.onInterim(out.combined, out.interim);
      }
    };

    rec.onerror = function (event) {
      var code = event && event.error;
      var msg = '음성 인식 중 문제가 발생했습니다.';
      var fatal = true;

      if (code === 'not-allowed' || code === 'service-not-allowed') {
        msg = '마이크 사용이 허용되지 않았습니다.';
      } else if (code === 'no-speech') {
        msg = '음성이 감지되지 않았습니다.';
        fatal = false;              // 잠시 조용했을 뿐이므로 계속 듣는다
      } else if (code === 'audio-capture') {
        msg = '마이크를 찾을 수 없습니다.';
      } else if (code === 'network') {
        msg = '네트워크 문제로 음성 인식이 중단되었습니다.';
      } else if (code === 'aborted') {
        return;                     // 사용자가 끈 경우 — 알릴 것 없음
      }

      if (fatal) session.wantListening = false;
      if (fatal && session.handlers.onError) session.handlers.onError(msg, code);
    };

    rec.onend = function () {
      if (closed) return;
      closed = true;
      session.recognition = null;

      // 안드로이드 크롬은 조금만 조용해도 스스로 인식을 끝낸다.
      // 사용자가 끄지 않았다면 이어서 다시 듣는다.
      if (session.wantListening) {
        session.emptyRuns++;
        if (session.emptyRuns <= MAX_EMPTY_RESTARTS) {
          // 다음 회차는 지금까지 확정된 내용 뒤에 이어 붙인다.
          session.baseText = session.finalText;
          session.segments = {};
          if (launch()) return;
        }
      }

      session.listening = false;
      session.wantListening = false;
      if (session.handlers.onEnd) session.handlers.onEnd(session.finalText);
    };

    try {
      rec.start();
    } catch (e) {
      session.listening = false;
      session.wantListening = false;
      if (session.handlers.onError) session.handlers.onError('음성 인식을 시작하지 못했습니다.');
      return false;
    }

    session.recognition = rec;
    session.listening = true;
    return true;
  }

  function stop() {
    session.wantListening = false;   // 자동 재개를 막는다
    if (session.recognition) {
      try { session.recognition.stop(); }
      catch (e) { /* 이미 종료됨 */ }
    }
    session.listening = false;
  }

  function toggle(handlers, baseText) {
    if (session.listening) { stop(); return false; }
    return start(handlers, baseText);
  }

  /**
   * 인식 결과 목록을 "결과 인덱스" 기준으로 저장한다.
   *
   * 안드로이드 크롬은 onresult 가 불릴 때마다 event.resultIndex 를 0 으로 주면서
   * 지금까지 확정된 결과를 통째로 다시 전달한다. 전달받은 것을 그때그때 뒤에
   * 이어 붙이면 같은 문장이 계속 쌓인다. (실제 신고된 증상)
   * 그래서 이어 붙이지 않고 인덱스마다 "덮어쓰기" 한 뒤 매번 처음부터 다시 조립한다.
   * 같은 내용이 몇 번을 다시 들어와도 결과가 달라지지 않는다.
   *
   * @param {object} store 인덱스 → {text, final}
   * @param {object} results SpeechRecognitionResultList (배열 유사 객체)
   */
  function absorbResults(store, results) {
    if (!results) return store;
    for (var i = 0; i < results.length; i++) {
      var res = results[i];
      if (!res) continue;
      var alt = res[0];
      var text = (alt && alt.transcript) ? String(alt.transcript).trim() : '';
      if (!text) continue;
      store[i] = { text: text, final: !!res.isFinal };
    }
    return store;
  }

  /** 저장된 조각들을 인덱스 순서대로 이어 하나의 문장으로 만든다. */
  function composeText(baseText, store) {
    var keys = [];
    for (var k in store) {
      if (Object.prototype.hasOwnProperty.call(store, k)) keys.push(Number(k));
    }
    keys.sort(function (a, b) { return a - b; });

    var confirmed = '', pending = '';
    for (var i = 0; i < keys.length; i++) {
      var seg = store[keys[i]];
      if (!seg || !seg.text) continue;
      if (seg.final) confirmed = joinText(confirmed, seg.text);
      else pending = joinText(pending, seg.text);
    }

    var settled = joinText(baseText, confirmed);
    return {
      final: settled,
      interim: pending,
      combined: joinText(settled, pending)
    };
  }

  /** 앞 문장과 새 문장을 공백 하나로 잇는다. */
  function joinText(a, b) {
    var left = String(a || '').replace(/\s+$/, '');
    var right = String(b || '').replace(/^\s+/, '');
    if (!left) return right;
    if (!right) return left;
    return left + ' ' + right;
  }

  global.RevVoice = {
    isSupported: isSupported,
    isSecure: isSecure,
    isAvailable: isAvailable,
    isListening: isListening,
    unavailableReason: unavailableReason,
    joinText: joinText,
    absorbResults: absorbResults,
    composeText: composeText,
    start: start,
    stop: stop,
    toggle: toggle
  };
})(window);
