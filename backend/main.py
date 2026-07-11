import hashlib
import html
import json
import os
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx
import psycopg
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb
from google import genai


load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/mydb")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
GEMINI_TIMEOUT_SECONDS = 20
MAX_PRODUCTS = 10
PRICE_FETCH_TIMEOUT_SECONDS = 20
DEFAULT_VERDICTS = {"Recently captured", ""}
client = genai.Client(api_key=GEMINI_API_KEY)


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CapturedProduct(BaseModel):
    name: str | None = None
    price: str | int | float | Decimal | None = None
    quantity: str | int | None = None
    image: str | None = None
    imageUrl: str | None = None
    link: str | None = None
    sourceProductId: str | None = None


class CartCapture(BaseModel):
    supportedSite: str = Field(..., min_length=1)
    sourceUrl: str = Field(..., min_length=1)
    extractedAt: datetime | None = None
    productCount: int | None = None
    products: list[CapturedProduct] = Field(default_factory=list)


class PriceCheckResult(BaseModel):
    price: str | int | float | Decimal | None = None
    currency: str | None = None
    method: str = "extension-tab"
    rawText: str | None = None
    error: str | None = None


def get_connection():
    return psycopg.connect(DATABASE_URL)


def parse_price(value: str | int | float | Decimal | None) -> tuple[Decimal | None, str | None]:
    if value is None:
        return None, None

    text = str(value).strip()
    currency = None

    if "$" in text or "USD" in text.upper():
        currency = "USD"
    elif "€" in text or "EUR" in text.upper():
        currency = "EUR"
    elif "£" in text or "GBP" in text.upper():
        currency = "GBP"
    elif "₹" in text or "INR" in text.upper():
        currency = "INR"

    numeric = re.sub(r"[^0-9.]", "", text)
    if not numeric:
        return None, currency

    try:
        return Decimal(numeric), currency
    except InvalidOperation:
        return None, currency


def parse_quantity(value: str | int | None) -> int:
    if value is None:
        return 1

    match = re.search(r"\d+", str(value))
    if not match:
        return 1

    return max(1, int(match.group(0)))


def clean_image_url(value: str | None) -> str | None:
    if not value:
        return None

    normalized = value.strip()
    lowered = normalized.lower()
    blocked_patterns = [
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
        ".gif",
    ]

    if any(pattern in lowered for pattern in blocked_patterns):
        return None

    return normalized


def find_price_in_json(value: Any) -> str | int | float | Decimal | None:
    if isinstance(value, dict):
        if "price" in value:
            return value["price"]

        for key in ("offers", "priceSpecification", "mainEntity", "item"):
            price = find_price_in_json(value.get(key))
            if price is not None:
                return price

        for child in value.values():
            price = find_price_in_json(child)
            if price is not None:
                return price

    if isinstance(value, list):
        for child in value:
            price = find_price_in_json(child)
            if price is not None:
                return price

    return None


def extract_price_from_html(page_html: str) -> tuple[Decimal | None, str | None, str | None]:
    for script_match in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        page_html,
        re.IGNORECASE | re.DOTALL,
    ):
        script_text = html.unescape(script_match.group(1).strip())

        try:
            price, currency = parse_price(find_price_in_json(json.loads(script_text)))
        except json.JSONDecodeError:
            continue
        
        print(price)

        if price is not None:
            return price, currency, "json-ld"

    meta_patterns = [
        r'<meta[^>]+(?:property|name|itemprop)=["\'](?:product:price:amount|og:price:amount|price)["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name|itemprop)=["\'](?:product:price:amount|og:price:amount|price)["\']',
    ]

    for pattern in meta_patterns:
        match = re.search(pattern, page_html, re.IGNORECASE)
        if match:
            price, currency = parse_price(html.unescape(match.group(1)))
            if price is not None:
                return price, currency, "meta"

    selector_patterns = [
        r'id=["\']priceblock_ourprice["\'][^>]*>([^<]+)',
        r'id=["\']priceblock_dealprice["\'][^>]*>([^<]+)',
        r'class=["\'][^"\']*a-offscreen[^"\']*["\'][^>]*>([^<]+)',
    ]

    for pattern in selector_patterns:
        match = re.search(pattern, page_html, re.IGNORECASE)
        if match:
            price, currency = parse_price(html.unescape(match.group(1)))
            if price is not None:
                return price, currency, "selector"

    match = re.search(r'(?:[$€£₹]\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|EUR|GBP|INR))', page_html, re.IGNORECASE)
    if match:
        price, currency = parse_price(match.group(0))
        if price is not None:
            return price, currency, "regex"

    return None, None, None


def stable_product_id(site: str, product: CapturedProduct) -> str:
    if product.sourceProductId:
        return product.sourceProductId

    fingerprint = "|".join(
        [
            site.lower(),
            product.link or "",
            product.name or "",
        ]
    )
    return hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:24]


def normalize_prices(prices: list[Decimal] | None) -> list[Decimal]:
    return [price for price in prices or [] if price is not None]


def latest_price(prices: list[Decimal] | None) -> Decimal | None:
    normalized = normalize_prices(prices)
    return normalized[-1] if normalized else None


def lowest_price(prices: list[Decimal] | None) -> Decimal | None:
    normalized = normalize_prices(prices)
    return min(normalized) if normalized else None


def has_cached_verdict(verdict: str | None) -> bool:
    return bool(verdict and verdict.strip() and verdict.strip() not in DEFAULT_VERDICTS)


def build_eco_prompt(row: dict[str, Any]) -> str:
    prices = [str(price) for price in normalize_prices(row.get("prices"))[-6:]]
    raw_product = row.get("raw_product") or {}
    raw_product_json = json.dumps(raw_product, ensure_ascii=True)[:2000]

    return (
        "You are writing a short eco-friendly shopping note for a product detail modal in an app. "
        "Use only the provided product data. Do not invent certifications, materials, sourcing, carbon claims, "
        "or manufacturing details. If the data is insufficient, explicitly say that the sustainability details are "
        "unclear and give one practical lower-impact shopping tip relevant to the product type. "
        "Return exactly one plain-text paragraph under 45 words. No markdown, no bullets, no quotes.\n\n"
        f"Product name: {row.get('name') or 'Unknown'}\n"
        f"Source site: {row.get('source_site') or 'Unknown'}\n"
        f"Source URL: {row.get('source_url') or 'Unknown'}\n"
        f"Currency: {row.get('currency') or 'Unknown'}\n"
        f"Quantity: {row.get('quantity') or 'Unknown'}\n"
        f"Recent prices: {', '.join(prices) if prices else 'None'}\n"
        f"Badge: {row.get('badge') or 'None'}\n"
        f"Rating: {row.get('rating') or 'None'}\n"
        f"Raw product JSON: {raw_product_json}"
    )


def generate_eco_verdict(row: dict[str, Any]) -> str:
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY is not configured")

    response = client.models.generate_content(
        model="gemini-3.5-flash",
        contents=build_eco_prompt(row),
    )

    verdict = (response.text or "").strip()

    if not verdict:
        raise HTTPException(status_code=502, detail="Gemini returned an empty eco verdict")

    return verdict


def serialize_product(row: dict[str, Any]) -> dict[str, Any]:
    prices = normalize_prices(row.get("prices"))
    price = latest_price(prices)
    lowest = lowest_price(prices)
    previous_price = row.get("previous_price")

    return {
        **row,
        "prices": [float(item) for item in prices],
        "price": float(price) if price is not None else None,
        "lowest_price": float(lowest) if lowest is not None else None,
        "previous_price": float(previous_price) if previous_price is not None else None,
        "captured_at": row["captured_at"].isoformat() if row["captured_at"] else None,
        "last_seen_at": row["last_seen_at"].isoformat() if row["last_seen_at"] else None,
        "last_checked_at": row.get("last_checked_at").isoformat() if row.get("last_checked_at") else None,
        "price_changed_at": row.get("price_changed_at").isoformat() if row.get("price_changed_at") else None,
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
    }


@app.on_event("startup")
def startup():
    with get_connection() as conn:
        conn.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS products (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              source_site TEXT NOT NULL,
              source_product_id TEXT,
              source_url TEXT,
              cart_url TEXT,
              prices NUMERIC(12, 2)[],
              name TEXT NOT NULL,
              currency TEXT,
              quantity INTEGER DEFAULT 1,
              image_url TEXT,
              captured_at TIMESTAMPTZ NOT NULL,
              last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              rating TEXT,
              verdict TEXT,
              badge TEXT,
              shelf TEXT DEFAULT 'Recently Added',
              raw_product JSONB,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS products_source_identity_idx
            ON products (source_site, source_product_id)
            WHERE source_product_id IS NOT NULL
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS products_last_seen_idx ON products (last_seen_at DESC)")
        conn.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS prices NUMERIC(12, 2)[]")
        conn.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS previous_price NUMERIC(12, 2)")
        conn.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ")
        conn.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS price_changed_at TIMESTAMPTZ")
        conn.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS check_error TEXT")
        conn.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS price_check_method TEXT")


@app.get("/")
def root():
    return {"message": "BloomCart API"}


@app.post("/products/capture")
def capture_products(capture: CartCapture):
    captured_at = capture.extractedAt or datetime.now(timezone.utc)
    saved_count = 0

    with get_connection() as conn:
        for index, product in enumerate(capture.products):
            if not product.name:
                continue

            price, currency = parse_price(product.price)
            quantity = parse_quantity(product.quantity)
            source_product_id = stable_product_id(capture.supportedSite, product)
            image_url = clean_image_url(product.imageUrl or product.image)
            raw_product = product.model_dump(mode="json")

            conn.execute(
                """
                INSERT INTO products (
                    source_site,
                    source_product_id,
                    source_url,
                    cart_url,
                    prices,
                    name,
                    currency,
                    quantity,
                    image_url,
                    captured_at,
                    last_seen_at,
                    rating,
                    verdict,
                    badge,
                    shelf,
                    raw_product
                )
                VALUES (
                    %(source_site)s,
                    %(source_product_id)s,
                    %(source_url)s,
                    %(cart_url)s,
                    %(prices)s,
                    %(name)s,
                    %(currency)s,
                    %(quantity)s,
                    %(image_url)s,
                    %(captured_at)s,
                    now(),
                    %(rating)s,
                    %(verdict)s,
                    %(badge)s,
                    %(shelf)s,
                    %(raw_product)s
                )
                ON CONFLICT (source_site, source_product_id)
                WHERE source_product_id IS NOT NULL
                DO UPDATE SET
                    source_url = EXCLUDED.source_url,
                    cart_url = EXCLUDED.cart_url,
                    name = EXCLUDED.name,
                    prices = CASE
                        WHEN array_length(EXCLUDED.prices, 1) IS NULL THEN COALESCE(products.prices, ARRAY[]::NUMERIC(12, 2)[])
                        WHEN COALESCE(array_length(products.prices, 1), 0) = 0 THEN EXCLUDED.prices
                        WHEN products.prices[array_length(products.prices, 1)] IS DISTINCT FROM EXCLUDED.prices[1] THEN array_append(products.prices, EXCLUDED.prices[1])
                        ELSE products.prices
                    END,
                    currency = EXCLUDED.currency,
                    quantity = EXCLUDED.quantity,
                    image_url = COALESCE(EXCLUDED.image_url, products.image_url),
                    captured_at = EXCLUDED.captured_at,
                    last_seen_at = now(),
                    previous_price = CASE
                        WHEN array_length(EXCLUDED.prices, 1) IS NULL THEN products.previous_price
                        WHEN COALESCE(array_length(products.prices, 1), 0) = 0 THEN products.previous_price
                        WHEN products.prices[array_length(products.prices, 1)] IS DISTINCT FROM EXCLUDED.prices[1] THEN products.prices[array_length(products.prices, 1)]
                        ELSE products.previous_price
                    END,
                    price_changed_at = CASE
                        WHEN array_length(EXCLUDED.prices, 1) IS NULL THEN products.price_changed_at
                        WHEN COALESCE(array_length(products.prices, 1), 0) = 0 THEN products.price_changed_at
                        WHEN products.prices[array_length(products.prices, 1)] IS DISTINCT FROM EXCLUDED.prices[1] THEN now()
                        ELSE products.price_changed_at
                    END,
                    badge = EXCLUDED.badge,
                    raw_product = EXCLUDED.raw_product,
                    updated_at = now()
                """,
                {
                    "source_site": capture.supportedSite,
                    "source_product_id": source_product_id,
                    "source_url": product.link,
                    "cart_url": capture.sourceUrl,
                    "prices": [price] if price is not None else [],
                    "name": product.name,
                    "currency": currency,
                    "quantity": quantity,
                    "image_url": image_url,
                    "captured_at": captured_at,
                    "rating": "Analyzing",
                    "verdict": "Recently captured",
                    "badge": f"Qty {quantity}" if quantity > 1 else "New",
                    "shelf": "Recently Added",
                    "raw_product": Jsonb({**raw_product, "positionIndex": index}),
                },
            )
            saved_count += 1

    return {"ok": True, "savedCount": saved_count}


@app.get("/products")
def list_products(limit: int = MAX_PRODUCTS):
    safe_limit = max(1, min(limit, MAX_PRODUCTS))

    with get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT
              id::text,
              source_site,
              source_product_id,
              source_url,
              cart_url,
              prices,
              name,
              currency,
              quantity,
              image_url,
              captured_at,
              last_seen_at,
              previous_price,
              last_checked_at,
              price_changed_at,
              check_error,
              price_check_method,
              rating,
              verdict,
              badge,
              shelf,
              raw_product,
              created_at,
              updated_at
            FROM products
            ORDER BY last_seen_at DESC, created_at DESC
            LIMIT %s
            """,
            (safe_limit,),
        )
        rows = cursor.fetchall()
        columns = [column.name for column in cursor.description] if cursor.description else []

    return {"products": [serialize_product(dict(zip(columns, row, strict=True))) for row in rows]}


@app.get("/products/{product_id}")
def get_product(product_id: str):
    with get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT
              id::text,
              source_site,
              source_product_id,
              source_url,
              cart_url,
              prices,
              name,
              currency,
              quantity,
              image_url,
              captured_at,
              last_seen_at,
              previous_price,
              last_checked_at,
              price_changed_at,
              check_error,
              price_check_method,
              rating,
              verdict,
              badge,
              shelf,
              raw_product,
              created_at,
              updated_at
            FROM products
            WHERE id = %s
            """,
            (product_id,),
        )
        row = cursor.fetchone()
        columns = [column.name for column in cursor.description] if cursor.description else []

    if not row:
        raise HTTPException(status_code=404, detail="Product not found")

    return serialize_product(dict(zip(columns, row, strict=True)))


@app.post("/products/{product_id}/eco-summary")
def generate_product_eco_summary(product_id: str):
    with get_connection() as conn:
        cursor = conn.execute(
            """
            SELECT
              id::text,
              source_site,
              source_product_id,
              source_url,
              cart_url,
              prices,
              name,
              currency,
              quantity,
              image_url,
              captured_at,
              last_seen_at,
              previous_price,
              last_checked_at,
              price_changed_at,
              check_error,
              price_check_method,
              rating,
              verdict,
              badge,
              shelf,
              raw_product,
              created_at,
              updated_at
            FROM products
            WHERE id = %s
            """,
            (product_id,),
        )
        row = cursor.fetchone()
        columns = [column.name for column in cursor.description] if cursor.description else []

        if not row:
            raise HTTPException(status_code=404, detail="Product not found")

        product = dict(zip(columns, row, strict=True))

        if has_cached_verdict(product.get("verdict")):
            return {
                "ok": True,
                "cached": True,
                "product": serialize_product(product),
            }

        try:
            verdict = generate_eco_verdict(product)
        except httpx.HTTPError as error:
            raise HTTPException(status_code=502, detail=f"Could not generate eco verdict: {error}") from error

        updated_cursor = conn.execute(
            """
            UPDATE products
            SET verdict = %s,
                updated_at = now()
            WHERE id = %s
            RETURNING
              id::text,
              source_site,
              source_product_id,
              source_url,
              cart_url,
              prices,
              name,
              currency,
              quantity,
              image_url,
              captured_at,
              last_seen_at,
              previous_price,
              last_checked_at,
              price_changed_at,
              check_error,
              price_check_method,
              rating,
              verdict,
              badge,
              shelf,
              raw_product,
              created_at,
              updated_at
            """,
            (verdict, product_id),
        )
        updated_row = updated_cursor.fetchone()
        updated_columns = [column.name for column in updated_cursor.description] if updated_cursor.description else []

    return {
        "ok": True,
        "cached": False,
        "product": serialize_product(dict(zip(updated_columns, updated_row, strict=True))),
    }


@app.post("/products/{product_id}/price-check-result")
def save_price_check_result(product_id: str, result: PriceCheckResult):
    checked_price, checked_currency = parse_price(result.price)
    checked_currency = result.currency or checked_currency

    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT id::text, name, prices, currency
            FROM products
            WHERE id = %s
            """,
            (product_id,),
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Product not found")

        existing_prices = normalize_prices(row[2])
        old_price = latest_price(existing_prices)
        old_currency = row[3]
        price_changed = checked_price is not None and old_price is not None and checked_price != old_price
        price_dropped = price_changed and checked_price < old_price

        conn.execute(
            """
            UPDATE products
            SET
              previous_price = CASE
                WHEN %(checked_price)s IS NOT NULL AND COALESCE(array_length(prices, 1), 0) > 0 AND prices[array_length(prices, 1)] IS DISTINCT FROM %(checked_price)s THEN prices[array_length(prices, 1)]
                ELSE previous_price
              END,
              prices = CASE
                WHEN %(checked_price)s IS NULL THEN COALESCE(prices, ARRAY[]::NUMERIC(12, 2)[])
                WHEN COALESCE(array_length(prices, 1), 0) = 0 THEN ARRAY[%(checked_price)s]::NUMERIC(12, 2)[]
                WHEN prices[array_length(prices, 1)] IS DISTINCT FROM %(checked_price)s THEN array_append(prices, %(checked_price)s)
                ELSE prices
              END,
              currency = COALESCE(%(checked_currency)s, currency),
              last_checked_at = now(),
              price_changed_at = CASE
                WHEN %(checked_price)s IS NOT NULL AND COALESCE(array_length(prices, 1), 0) > 0 AND prices[array_length(prices, 1)] IS DISTINCT FROM %(checked_price)s THEN now()
                WHEN %(checked_price)s IS NOT NULL AND COALESCE(array_length(prices, 1), 0) = 0 THEN now()
                ELSE price_changed_at
              END,
              check_error = %(check_error)s,
              price_check_method = %(price_check_method)s,
              updated_at = now()
            WHERE id = %(product_id)s
            """,
            {
                "checked_price": checked_price,
                "checked_currency": checked_currency,
                "check_error": result.error,
                "price_check_method": result.method,
                "product_id": product_id,
            },
        )

    return {
        "ok": True,
        "productId": product_id,
        "name": row[1],
        "oldPrice": float(old_price) if old_price is not None else None,
        "oldCurrency": old_currency,
        "newPrice": float(checked_price) if checked_price is not None else None,
        "newCurrency": checked_currency,
        "rawText": result.rawText,
        "method": result.method,
        "error": result.error,
        "priceChanged": bool(price_changed),
        "priceDropped": bool(price_dropped),
    }


@app.post("/products/{product_id}/check-price")
def check_product_price(product_id: str):
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT id::text, name, source_site, source_url, prices, currency
            FROM products
            WHERE id = %s
            """,
            (product_id,),
        ).fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Product not found")

    stored_price = latest_price(row[4])

    product = {
        "id": row[0],
        "name": row[1],
        "source_site": row[2],
        "source_url": row[3],
        "stored_price": float(stored_price) if stored_price is not None else None,
        "stored_currency": row[5],
    }

    print(product)

    if not product["source_url"]:
        raise HTTPException(status_code=400, detail="Product does not have a source URL")

    try:
        response = httpx.get(
            product["source_url"],
            follow_redirects=True,
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            },
            timeout=PRICE_FETCH_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail=f"Could not fetch product page: {error}") from error

    price, currency, method = extract_price_from_html(response.text)

    return {
        **product,
        "checked_price": float(price) if price is not None else None,
        "checked_currency": currency,
        "method": method,
        "fetched_url": str(response.url),
        "status_code": response.status_code,
        "found": price is not None,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
