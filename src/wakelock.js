// Wake lock: keeps the screen on during a session. The browser drops the lock whenever the page is
// hidden, so it is requested again when the page becomes visible while a session still wants it.
// onChange(state, error) gets 'active' | 'released' | 'off' | 'unsupported' | 'error'.

export function createWakeLock({ nav = globalThis.navigator, doc = globalThis.document, onChange = () => {} } = {}) {
  const supported = Boolean(nav?.wakeLock);
  let sentinel = null;
  let wanted = false;

  async function request() {
    if (!supported) {
      onChange('unsupported');
      return false;
    }
    try {
      const s = await nav.wakeLock.request('screen');
      sentinel = s;
      s.addEventListener('release', () => {
        if (sentinel === s) sentinel = null;
        if (wanted && doc?.visibilityState === 'visible') onChange('released');
      });
      onChange('active');
      return true;
    } catch (err) {
      onChange('error', err);
      return false;
    }
  }

  doc?.addEventListener('visibilitychange', () => {
    if (wanted && !sentinel && doc.visibilityState === 'visible') request();
  });

  return {
    supported,

    async acquire() {
      wanted = true;
      return sentinel ? true : request();
    },

    async release() {
      wanted = false;
      const s = sentinel;
      sentinel = null;
      if (s) await s.release().catch(() => {});
      if (supported) onChange('off');
    },
  };
}
