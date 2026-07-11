const LATEST_CART_KEY = "latestCart";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "BLOOMCART_CART_CAPTURED") {
    return;
  }

  const capture = {
    ...message.payload,
    tabId: sender.tab?.id ?? null,
    capturedByExtensionAt: new Date().toISOString()
  };

  chrome.storage.local.set({ [LATEST_CART_KEY]: capture }).then(() => {
    sendResponse({ ok: true });
  });

  return true;
});

chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "BLOOMCART_GET_LATEST_CART") {
    sendResponse({ ok: false, error: "Unknown BloomCart message type" });
    return;
  }

  chrome.storage.local.get(LATEST_CART_KEY).then(({ latestCart }) => {
    sendResponse({ ok: true, cart: latestCart ?? null });
  });

  return true;
});
