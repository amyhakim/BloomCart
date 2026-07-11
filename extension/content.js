(function readBloomCartPage() {
  const CAPTURE_MESSAGE_TYPE = "BLOOMCART_CART_CAPTURED";
  const INITIAL_CAPTURE_DELAY_MS = 5000;
  const CAPTURE_DEBOUNCE_MS = 1000;

  const supportedSites = [
    {
      name: "Amazon",
      hostPattern: /(^|\.)amazon\./i,
      cartContainerSelectors: ["#sc-active-cart", "[data-name='Active Items']", "form#activeCartViewForm"],
      itemSelectors: [".sc-list-item", "[data-asin][data-itemid]", "[data-asin].sc-list-item"]
    },
    {
      name: "Walmart",
      hostPattern: /(^|\.)walmart\./i,
      cartContainerSelectors: ["[data-testid='cart-page']", "[data-automation-id='cart-page']", "main"],
      itemSelectors: ["[data-testid='cart-item']", "[data-automation-id='cart-item']", "[class*='cart-item' i]"]
    },
    {
      name: "Target",
      hostPattern: /(^|\.)target\./i,
      cartContainerSelectors: ["[data-test='cart']", "[data-test='cart-page']", "main"],
      itemSelectors: ["[data-test='cartItem']", "[data-test='cart-item']", "[class*='CartItem' i]"]
    }
  ];

  const textSelectors = [
    "h1",
    "h2",
    "h3",
    "h4",
    "[class*='title' i]",
    "[class*='name' i]",
    "[class*='product' i] a",
    "a"
  ];

  const pricePattern = /(?:[$€£₹]\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|EUR|GBP|INR))/i;
  const quantityPattern = /(?:qty|quantity)\s*[:x-]?\s*(\d+)/i;
  const blockedImagePatterns = [
    "loading",
    "spinner",
    "placeholder",
    "transparent",
    "blank",
    "grey-pixel",
    "gray-pixel",
    "pixel.gif",
    "1x1",
    "data:image",
    ".gif"
  ];

  function getSupportedSite() {
    return supportedSites.find((site) => site.hostPattern.test(window.location.hostname));
  }

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function absoluteUrl(value) {
    if (!value) {
      return null;
    }

    try {
      return new URL(value, window.location.href).href;
    } catch {
      return value;
    }
  }

  function isUsableImageUrl(value) {
    if (!value) {
      return false;
    }

    const lowerValue = value.toLowerCase();

    return !blockedImagePatterns.some((pattern) => lowerValue.includes(pattern));
  }

  function parseSrcset(value) {
    if (!value) {
      return [];
    }

    return value
      .split(",")
      .map((entry) => {
        const [url, descriptor = ""] = entry.trim().split(/\s+/, 2);
        const width = Number.parseInt(descriptor.replace(/\D/g, ""), 10) || 0;
        return { url, width };
      })
      .filter((candidate) => candidate.url)
      .sort((a, b) => b.width - a.width)
      .map((candidate) => candidate.url);
  }

  function parseAmazonDynamicImage(value) {
    if (!value) {
      return [];
    }

    try {
      return Object.keys(JSON.parse(value));
    } catch {
      return [];
    }
  }

  function getImageCandidates(image) {
    const candidates = [
      image.getAttribute("data-old-hires"),
      image.getAttribute("data-a-hires"),
      image.getAttribute("data-src"),
      image.getAttribute("data-lazy-src"),
      image.currentSrc,
      ...parseSrcset(image.getAttribute("srcset")),
      ...parseSrcset(image.getAttribute("data-srcset")),
      ...parseAmazonDynamicImage(image.getAttribute("data-a-dynamic-image")),
      image.getAttribute("src")
    ];

    return candidates.map(absoluteUrl).filter(isUsableImageUrl);
  }

  function findName(element) {
    for (const selector of textSelectors) {
      const match = element.querySelector(selector);
      const text = normalizeText(match?.textContent);

      if (text && !pricePattern.test(text) && text.length <= 160) {
        return text;
      }
    }

    const imageAlt = normalizeText(element.querySelector("img[alt]")?.getAttribute("alt"));
    if (imageAlt) {
      return imageAlt;
    }

    return null;
  }

  function findPrice(element) {
    const text = normalizeText(element.textContent);
    return text.match(pricePattern)?.[0] || null;
  }

  function findQuantity(element) {
    const input = element.querySelector("input[type='number'], input[name*='qty' i], input[name*='quantity' i]");
    const select = element.querySelector("select[name*='qty' i], select[name*='quantity' i]");
    const inputValue = normalizeText(input?.value || input?.getAttribute("value"));
    const selectValue = normalizeText(select?.value);

    if (inputValue) {
      return inputValue;
    }

    if (selectValue) {
      return selectValue;
    }

    const text = normalizeText(element.textContent);
    return text.match(quantityPattern)?.[1] || null;
  }

  function findImage(element) {
    const images = [...element.querySelectorAll("img")];
    const loadedImages = images.filter((image) => image.complete && image.naturalWidth > 20 && image.naturalHeight > 20);

    for (const image of [...loadedImages, ...images]) {
      const [candidate] = getImageCandidates(image);

      if (candidate) {
        return candidate;
      }
    }

    return null;
  }

  function findLink(element) {
    const link = element.querySelector("a[href]");
    return absoluteUrl(link?.getAttribute("href"));
  }

  function extractProduct(element) {
    const product = {
      name: findName(element),
      price: findPrice(element),
      quantity: findQuantity(element),
      image: findImage(element),
      link: findLink(element)
    };

    if (!product.name || !product.price) {
      return null;
    }

    return product;
  }

  function collectCandidates(site) {
    const candidates = new Set();
    const containers = site.cartContainerSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]);

    for (const container of containers) {
      for (const selector of site.itemSelectors) {
        container.querySelectorAll(selector).forEach((element) => candidates.add(element));
      }
    }

    return [...candidates];
  }

  function dedupeProducts(products) {
    const seen = new Set();

    return products.filter((product) => {
      const key = [product.name, product.price, product.link].join("|").toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  function buildCartJson(site) {
    const products = dedupeProducts(collectCandidates(site).map(extractProduct).filter(Boolean));

    return {
      supportedSite: site.name,
      sourceUrl: window.location.href,
      extractedAt: new Date().toISOString(),
      productCount: products.length,
      products
    };
  }

  function sendCapture(cartJson) {
    chrome.runtime.sendMessage({
      type: CAPTURE_MESSAGE_TYPE,
      payload: cartJson
    });
  }

  const site = getSupportedSite();

  if (!site) {
    console.info("BloomCart does not support this shopping site yet:", window.location.hostname);
    return;
  }

  let lastCaptureSignature = "";
  let captureTimeout = null;
  let captureEnabled = false;

  function captureCart() {
    const cartJson = buildCartJson(site);
    const signature = JSON.stringify({
      sourceUrl: cartJson.sourceUrl,
      products: cartJson.products
    });

    if (signature === lastCaptureSignature) {
      return;
    }

    lastCaptureSignature = signature;
    sendCapture(cartJson);
    console.log("BloomCart extracted cart JSON:", cartJson);
  }

  function scheduleCapture() {
    if (!captureEnabled) {
      return;
    }

    window.clearTimeout(captureTimeout);
    captureTimeout = window.setTimeout(captureCart, CAPTURE_DEBOUNCE_MS);
  }

  const observer = new MutationObserver(scheduleCapture);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "value", "data-quantity", "aria-label"]
  });

  window.setTimeout(() => {
    captureEnabled = true;
    captureCart();
  }, INITIAL_CAPTURE_DELAY_MS);
})();
