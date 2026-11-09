"""Static exchange rates used to compare salaries across currencies.

Approximate USD value of one unit of each currency. Good enough for filtering and
ranking; salaries are always displayed in the currency they were entered in.
"""

USD_PER_UNIT: dict[str, float] = {
    "USD": 1.0,
    "EUR": 1.08,
    "GBP": 1.27,
    "INR": 0.012,
    "CAD": 0.73,
    "AUD": 0.65,
    "SGD": 0.74,
    "AED": 0.27,
    "JPY": 0.0066,
    "CHF": 1.13,
}

SUPPORTED_CURRENCIES = sorted(USD_PER_UNIT)


def to_usd(amount: int | None, currency: str) -> int | None:
    if amount is None:
        return None
    return round(amount * USD_PER_UNIT[currency])
