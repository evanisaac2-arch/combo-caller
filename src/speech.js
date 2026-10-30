// Speech: Web Speech API wrapper. A native TTS plugin can replace this module as long as it keeps
// the same shape: { supported, voices(), onVoicesChanged(cb), speak(text, opts), cancel() }.

export function createSpeech(synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance) {
  const supported = Boolean(synth && Utterance);
  // Chrome can garbage-collect an utterance mid-sentence unless something holds a reference.
  let current = null;

  return {
    supported,

    voices() {
      return supported ? synth.getVoices() : [];
    },

    onVoicesChanged(cb) {
      if (supported) synth.addEventListener?.('voiceschanged', cb);
    },

    // Interrupts anything still being said so a callout is never queued behind a stale one.
    speak(text, { voiceURI = '', rate = 1, volume = 1 } = {}) {
      if (!supported) return;
      synth.cancel();
      const u = new Utterance(text);
      const voice = voiceURI ? synth.getVoices().find((v) => v.voiceURI === voiceURI) : null;
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.rate = rate;
      u.volume = volume;
      u.onend = () => {
        if (current === u) current = null;
      };
      current = u;
      synth.speak(u);
    },

    cancel() {
      if (supported) synth.cancel();
      current = null;
    },
  };
}
