from decimal import Decimal


MODEL_PRICES_PER_MILLION: dict[str, tuple[Decimal, Decimal]] = {
    "gpt-4o-mini": (Decimal("0.15"), Decimal("0.60")),
    "gpt-4.1-mini": (Decimal("0.40"), Decimal("1.60")),
    "gpt-5.6-luna": (Decimal("1.00"), Decimal("6.00")),
    "gpt-5.6-terra": (Decimal("2.50"), Decimal("15.00")),
    "gpt-5.6-sol": (Decimal("5.00"), Decimal("30.00")),
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int, web_search_calls: int) -> Decimal:
    input_price, output_price = MODEL_PRICES_PER_MILLION.get(model, MODEL_PRICES_PER_MILLION["gpt-5.6-luna"])
    billed_input_tokens = input_tokens
    if model in {"gpt-4o-mini", "gpt-4.1-mini"}:
        billed_input_tokens = max(input_tokens, web_search_calls * 8_000)
    token_cost = (
        Decimal(billed_input_tokens) * input_price + Decimal(output_tokens) * output_price
    ) / Decimal(1_000_000)
    return token_cost + Decimal(web_search_calls) * Decimal("0.01")
