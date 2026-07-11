(function readBloomCartPage() {
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

  const cartItemSelectors = [
    "[data-testid*='cart' i]",
    "[data-test*='cart' i]",
    "[class*='cart-item' i]",
    "[class*='cartitem' i]",
    "[class*='basket-item' i]",
    "[class*='checkout-item' i]",
    "[class*='line-item' i]",
    "[class*='product-item' i]",
    "article",
    "li"
  ];

  const pricePattern = /(?:[$€£₹]\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|EUR|GBP|INR))/i;
  const quantityPattern = /(?:qty|quantity)\s*[:x-]?\s*(\d+)/i;

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
    const image = element.querySelector("img[src], img[data-src]");
    return absoluteUrl(image?.getAttribute("src") || image?.getAttribute("data-src"));
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

  function collectCandidates() {
    const candidates = new Set();

    for (const selector of cartItemSelectors) {
      document.querySelectorAll(selector).forEach((element) => candidates.add(element));
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

  const products = dedupeProducts(collectCandidates().map(extractProduct).filter(Boolean));
  const cartJson = {
    sourceUrl: window.location.href,
    extractedAt: new Date().toISOString(),
    productCount: products.length,
    products
  };

  console.log("BloomCart extracted cart JSON:", cartJson);
})();
