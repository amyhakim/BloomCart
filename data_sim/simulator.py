import os
import random
import time
from decimal import Decimal

import psycopg2

DATABASE_URL = os.environ["DATABASE_URL"]
BUY_SHELF = "Buy"
WAITING_SHELF = "Waiting for a Sale"


def connect():
    return psycopg2.connect(DATABASE_URL)


while True:
    time.sleep(random.randint(30, 45))

    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT id, prices
                    FROM products
                    ORDER BY random()
                    LIMIT 1
                """)

                row = cur.fetchone()

                if not row:
                    print("No products found.")
                    continue

                product_id, prices = row
                prices = prices or []

                if prices:
                    current = Decimal(str(prices[-1]))
                else:
                    current = Decimal(random.randint(100, 10000)) / Decimal("100")

                change = Decimal(random.randint(-10, 10)) / Decimal("100")
                new_price = (current * (Decimal("1") + change)).quantize(Decimal("0.01"))

                if new_price < Decimal("1.00"):
                    new_price = Decimal("1.00")

                cur.execute(
                    """
                    UPDATE products
                    SET prices = array_append(COALESCE(prices, ARRAY[]::NUMERIC(12, 2)[]), %s),
                        previous_price = %s,
                        shelf = CASE
                            WHEN %s < %s THEN %s
                            WHEN %s > %s THEN %s
                            ELSE shelf
                        END,
                        updated_at = now(),
                        last_checked_at = now(),
                        price_changed_at = now()
                    WHERE id = %s
                    """,
                    (
                        new_price,
                        current,
                        new_price,
                        current,
                        BUY_SHELF,
                        new_price,
                        current,
                        WAITING_SHELF,
                        product_id,
                    ),
                )

                print(f"{product_id}: {current} -> {new_price}")

    except Exception as e:
        print(e)
