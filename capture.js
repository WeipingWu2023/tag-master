(() => {
  if (globalThis.__tagMasterCaptureVersion === '1.1.0') return;
  globalThis.__tagMasterCaptureVersion = '1.1.0';
  let busy = false;
  async function capture() {
    if (busy) return;
    busy = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'capture-current' });
      if (!result?.ok) throw new Error(result?.error || 'Could not save. Try again.');
      toast(result.duplicate ? 'Updated in Tag Master' : 'Saved to Tag Master');
    } catch (error) { toast(`Not saved: ${error.message}. Reload this page if you just updated the extension.`); }
    finally { busy = false; }
  }
  function toast(message) {
    document.getElementById('tag-master-notice')?.remove();
    const host = document.createElement('div'); host.id = 'tag-master-notice';
    host.style.cssText = 'all:initial;position:fixed;right:24px;bottom:24px;z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'closed' });
    const notice = document.createElement('div'); notice.setAttribute('role', 'status');
    notice.style.cssText = 'font:14px/1.5 system-ui;background:#fff3be;color:#533d28;padding:16px 22px;border:1px solid #d6b766;border-radius:16px;max-width:350px;box-shadow:0 6px 24px #72521f22';
    notice.textContent = message; shadow.append(notice); document.documentElement.append(host);
    setTimeout(() => host.remove(), 4500);
  }
  document.addEventListener('keydown', event => {
    if (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey && event.code === 'KeyP' && !event.repeat) { event.preventDefault(); capture(); }
  }, true);
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'capture-feedback' && message.ok) toast(message.duplicate ? 'Updated in Tag Master' : 'Saved to Tag Master');
  });
})();
