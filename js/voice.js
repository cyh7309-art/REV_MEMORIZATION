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
    finalText: '',
    handlers: {}
  };

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
    session.finalText = baseText ? String(baseText) : '';

    var rec = new Impl();
    rec.lang = 'ko-KR';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = function (event) {
      var interim = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var res = event.results[i];
        var text = res[0] && res[0].transcript ? res[0].transcript : '';
        if (res.isFinal) {
          session.finalText = joinText(session.finalText, text);
          if (session.handlers.onFinal) session.handlers.onFinal(session.finalText);
        } else {
          interim += text;
        }
      }
      if (interim && session.handlers.onInterim) {
        session.handlers.onInterim(joinText(session.finalText, interim), interim);
      }
    };

    rec.onerror = function (event) {
      var code = event && event.error;
      var msg = '음성 인식 중 문제가 발생했습니다.';
      if (code === 'not-allowed' || code === 'service-not-allowed') msg = '마이크 사용이 허용되지 않았습니다.';
      else if (code === 'no-speech') msg = '음성이 감지되지 않았습니다.';
      else if (code === 'audio-capture') msg = '마이크를 찾을 수 없습니다.';
      else if (code === 'network') msg = '네트워크 문제로 음성 인식이 중단되었습니다.';
      if (session.handlers.onError) session.handlers.onError(msg, code);
    };

    rec.onend = function () {
      session.listening = false;
      session.recognition = null;
      if (session.handlers.onEnd) session.handlers.onEnd(session.finalText);
    };

    try {
      rec.start();
    } catch (e) {
      session.listening = false;
      if (session.handlers.onError) session.handlers.onError('음성 인식을 시작하지 못했습니다.');
      return false;
    }

    session.recognition = rec;
    session.listening = true;
    return true;
  }

  function stop() {
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
    start: start,
    stop: stop,
    toggle: toggle
  };
})(window);
