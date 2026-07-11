const LATEST_CART_KEY = "latestCart";
const BACKEND_CAPTURE_URL = "http://localhost:8080/products/capture";
const BACKEND_PRODUCTS_URL = "http://localhost:8080/products";
const TAB_LOAD_TIMEOUT_MS = 30000;

async function saveCaptureToBackend(capture) {
  const response = await fetch(BACKEND_CAPTURE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(capture),
  });

  if (!response.ok) {
    throw new Error(`Backend capture failed with status ${response.status}`);
  }

  return response.json();
}

async function fetchBackendJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(`Backend request failed with status ${response.status}`);
  }

  return response.json();
}

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for product page to load"));
    }, TAB_LOAD_TIMEOUT_MS);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }

      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function extractPriceFromProductPage(sourceSite) {
  const selectorMap = {
    Amazon: [
      ".a-price .a-offscreen",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
      "#priceblock_saleprice",
      "[data-a-color='price'] .a-offscreen",
    ],
    Walmart: [
      "[itemprop='price']",
      "[data-testid='price-wrap']",
      "[data-automation-id='product-price']",
    ],
    Target: [
      "[data-test='product-price']",
      "[data-test='current-price']",
      "[itemprop='price']",
    ],
  };
  const currencyPattern =
    /(?:[$€£₹]\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|EUR|GBP|INR))/i;

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function parsePrice(value) {
    const text = normalizeText(value);
    const match = text.match(currencyPattern);

    if (!match) {
      return { price: null, currency: null, rawText: text };
    }

    const rawText = match[0];
    const lowerText = rawText.toLowerCase();
    const amount = Number.parseFloat(rawText.replace(/[^0-9.]/g, ""));
    let currency = null;

    if (rawText.includes("$") || lowerText.includes("usd")) currency = "USD";
    if (rawText.includes("€") || lowerText.includes("eur")) currency = "EUR";
    if (rawText.includes("£") || lowerText.includes("gbp")) currency = "GBP";
    if (rawText.includes("₹") || lowerText.includes("inr")) currency = "INR";

    return {
      price: Number.isFinite(amount) ? amount : null,
      currency,
      rawText,
    };
  }

  const selectors = selectorMap[sourceSite] || [];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const parsed = parsePrice(
      element?.textContent || element?.getAttribute("content"),
    );

    if (parsed.price !== null) {
      return { ...parsed, method: `extension-selector:${selector}` };
    }
  }

  for (const metaSelector of [
    "meta[property='product:price:amount']",
    "meta[property='og:price:amount']",
    "meta[itemprop='price']",
    "[itemprop='price']",
  ]) {
    const element = document.querySelector(metaSelector);
    const parsed = parsePrice(
      element?.getAttribute("content") || element?.textContent,
    );

    if (parsed.price !== null) {
      return { ...parsed, method: `extension-meta:${metaSelector}` };
    }
  }

  const parsed = parsePrice(document.body?.innerText);
  return {
    ...parsed,
    method: parsed.price === null ? "extension-not-found" : "extension-regex",
  };
}

async function savePriceCheckResult(productId, result) {
  return fetchBackendJson(
    `${BACKEND_PRODUCTS_URL}/${productId}/price-check-result`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    },
  );
}

async function checkProductPriceWithTab(productId) {
  const product = await fetchBackendJson(
    `${BACKEND_PRODUCTS_URL}/${productId}`,
  );

  if (!product.source_url) {
    throw new Error("Product does not have a source URL");
  }

  const tab = await chrome.tabs.create({
    url: product.source_url,
    active: false,
  });

  if (!tab.id) {
    throw new Error("Could not create product check tab");
  }

  try {
    await waitForTabLoad(tab.id);

    const [injectionResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPriceFromProductPage,
      args: [product.source_site],
    });
    const extracted = injectionResult?.result || {
      price: null,
      currency: null,
      rawText: null,
      method: "extension-no-result",
      error: "No extraction result returned",
    };
    const backendResult = await savePriceCheckResult(productId, extracted);

    if (backendResult.priceDropped) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon.svg",
        title: "BloomCart price dropped",
        message: `${backendResult.name} dropped from ${backendResult.oldPrice} to ${backendResult.newPrice}`,
      });
    }

    return { product, extracted, backend: backendResult };
  } catch (error) {
    const backendResult = await savePriceCheckResult(productId, {
      price: null,
      currency: null,
      method: "extension-tab",
      rawText: null,
      error: error.message,
    });

    return {
      product,
      extracted: null,
      backend: backendResult,
      error: error.message,
    };
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "BLOOMCART_CART_CAPTURED") {
    return;
  }

  const capture = {
    ...message.payload,
    tabId: sender.tab?.id ?? null,
    capturedByExtensionAt: new Date().toISOString(),
  };

  Promise.all([
    chrome.storage.local.set({ [LATEST_CART_KEY]: capture }),
    saveCaptureToBackend(capture),
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

chrome.runtime.onMessageExternal.addListener(
  (message, _sender, sendResponse) => {
    if (message?.type === "BLOOMCART_GET_LATEST_CART") {
      chrome.storage.local.get(LATEST_CART_KEY).then(({ latestCart }) => {
        sendResponse({ ok: true, cart: latestCart ?? null });
      });

      return true;
    }

    if (message?.type === "BLOOMCART_CHECK_PRODUCT_PRICE") {
      checkProductPriceWithTab(message.productId)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));

      return true;
    }

    sendResponse({ ok: false, error: "Unknown BloomCart message type" });
    return false;
  },
);
