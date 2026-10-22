/**
 * Noto 3D Emoji Renderer for BusTop
 * Replaces text emoji with Google's high-resolution Noto 3D clay-render emoji assets.
 */
(function() {
  const NOTO_3D_CDN = 'https://fonts.gstatic.com/s/e/noto3demoji/latest/';

  const EMOJI_MAP = {
    '🚨': '1f6a8',
    '🔔': '1f514',
    '🔕': '1f515',
    '⭐': '2b50',
    '📌': '1f4cc',
    '🗺': '1f5fa',
    '🧭': '1f9ed',
    '🚍': '1f68d',
    '🚌': '1f68c',
    '🚏': '1f68f',
    '🔄': '1f504',
    '🕒': '1f552',
    '🏁': '1f3c1',
    '🚶': '1f6b6',
    '⚙': '2699',
    '⏰': '23f0',
    '⏱': '23f1',
    '🗑': '1f5d1',
    '🔋': '1f50b',
    '⚡': '26a1',
    '💾': '1f4be',
    '💊': '1f48a',
    '⚠': '26a0',
    '✅': '2705',
    '⌚': '231a',
    '📍': '1f4cd'
  };

  // Build regex matching supported emojis (and optional variation selectors \uFE0F)
  const regexKeys = Object.keys(EMOJI_MAP).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const EMOJI_REGEX = new RegExp(`(${regexKeys})\\uFE0F?`, 'g');

  function getEmojiImgHtml(emoji, alt) {
    const clean = emoji.replace(/\uFE0F/g, '');
    const code = EMOJI_MAP[clean];
    if (!code) return emoji;
    return `<img class="noto-3d-emoji" src="${NOTO_3D_CDN}${code}/128.png" alt="${alt || clean}" draggable="false" loading="lazy">`;
  }

  function replaceEmojisInNode(node) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const val = node.nodeValue;
      if (val && EMOJI_REGEX.test(val)) {
        EMOJI_REGEX.lastIndex = 0;
        const parent = node.parentNode;
        if (!parent) return;
        const tag = parent.nodeName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'textarea' || tag === 'input' || parent.classList?.contains('noto-3d-emoji')) {
          return;
        }

        const span = document.createElement('span');
        span.className = 'noto-3d-container';
        span.innerHTML = val.replace(EMOJI_REGEX, (match, p1) => getEmojiImgHtml(p1, match));
        parent.replaceChild(span, node);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.nodeName.toLowerCase();
      if (tag === 'script' || tag === 'style' || tag === 'textarea' || tag === 'input' || node.classList?.contains('noto-3d-emoji')) {
        return;
      }
      const children = Array.from(node.childNodes);
      for (let i = 0; i < children.length; i++) {
        replaceEmojisInNode(children[i]);
      }
    }
  }

  // MutationObserver to continuously apply Noto 3D style to dynamic elements
  let isThrottled = false;
  const pendingNodes = new Set();

  function processPendingNodes() {
    isThrottled = false;
    const nodes = Array.from(pendingNodes);
    pendingNodes.clear();
    for (const n of nodes) {
      if (document.body.contains(n)) {
        replaceEmojisInNode(n);
      }
    }
  }

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type === 'characterData') {
        pendingNodes.add(m.target);
      } else if (m.type === 'childList') {
        m.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE && !node.classList?.contains('noto-3d-container') && !node.classList?.contains('noto-3d-emoji')) {
            pendingNodes.add(node);
          }
        });
      }
    }
    if (!isThrottled && pendingNodes.size > 0) {
      isThrottled = true;
      requestAnimationFrame(processPendingNodes);
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    replaceEmojisInNode(document.body);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  });

  // Expose global helper if components want to format strings directly
  window.Noto3DEmoji = {
    render: (str) => {
      if (typeof str !== 'string') return str;
      return str.replace(EMOJI_REGEX, (match, p1) => getEmojiImgHtml(p1, match));
    },
    getUrl: (emoji) => {
      const clean = emoji.replace(/\uFE0F/g, '');
      const code = EMOJI_MAP[clean];
      return code ? `${NOTO_3D_CDN}${code}/128.png` : null;
    }
  };
})();
