const LATEST_CART_KEY = "latestCart";
const BACKEND_CAPTURE_URL = "http://localhost:8080/products/capture";

async function saveCaptureToBackend(capture) {
  const response = await fetch(BACKEND_CAPTURE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(capture)
  });

  if (!response.ok) {
    throw new Error(`Backend capture failed with status ${response.status}`);
  }

  return response.json();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "BLOOMCART_CART_CAPTURED") {
    return;
  }

  const capture = {
    ...message.payload,
    tabId: sender.tab?.id ?? null,
    capturedByExtensionAt: new Date().toISOString()
  };

  Promise.all([
    chrome.storage.local.set({ [LATEST_CART_KEY]: capture }),
    saveCaptureToBackend(capture)
  ])
    .then(([, backendResponse]) => {
      sendResponse({ ok: true, backend: backendResponse });
    })
    .catch((error) => {
      console.error("BloomCart could not save products to the backend:", error);
      sendResponse({ ok: false, error: error.message });
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
