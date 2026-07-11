# BloomCart

## Gemini eco verdict setup

1. Copy `backend/.env.example` to `backend/.env`.
2. Set `GEMINI_API_KEY` to your Google Gemini API key.
3. Optionally change `GEMINI_MODEL` if you want a different Gemini model.
4. Start the backend normally. The backend loads `.env` automatically for Gemini settings, while `DATABASE_URL` continues to come from `docker-compose.yml`.

When you open a product modal, BloomCart calls the backend `POST /products/{product_id}/eco-summary` endpoint. The backend sends product data from the database to Gemini, stores the generated eco-friendly message in the existing `verdict` column, and reuses that cached verdict on later opens.
