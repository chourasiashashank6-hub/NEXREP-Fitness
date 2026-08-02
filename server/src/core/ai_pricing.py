from decimal import Decimal

from src.core.config import settings

# Prices in USD per 1,000,000 tokens
AI_PRICING = {
    "llama-3.3-70b-versatile": {
        "input_per_million": Decimal("0.59"),
        "output_per_million": Decimal("0.79"),
    },
    "meta-llama/llama-4-scout-17b-16e-instruct": {
        "input_per_million": Decimal("0.11"),
        "output_per_million": Decimal("0.34"),
    },
    "gemini-2.0-flash": {
        "input_per_million": Decimal("0.10"),
        "output_per_million": Decimal("0.40"),
    },
    "gemini-1.5-flash": {
        "input_per_million": Decimal("0.075"),
        "output_per_million": Decimal("0.30"),
    },
    "gemini-1.5-flash-latest": {
        "input_per_million": Decimal("0.075"),
        "output_per_million": Decimal("0.30"),
    },
}

DEFAULT_PRICING = {
    "input_per_million": Decimal("0.50"),
    "output_per_million": Decimal("0.80"),
}


def usd_to_inr_rate() -> Decimal:
    return Decimal(str(settings.USD_TO_INR_RATE))


def calculate_cost(
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
) -> tuple[Decimal, Decimal]:
    """Returns (cost_usd, cost_inr) as Decimal."""
    pricing = AI_PRICING.get(model, DEFAULT_PRICING)
    cost_usd = Decimal(prompt_tokens) / Decimal(1_000_000) * pricing["input_per_million"] + Decimal(
        completion_tokens
    ) / Decimal(1_000_000) * pricing["output_per_million"]
    cost_inr = cost_usd * usd_to_inr_rate()
    return cost_usd, cost_inr
