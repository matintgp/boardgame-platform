"""Elo rating with K=32. Standard chess Elo."""

K = 32


def expected_score(rating_a: int, rating_b: int) -> float:
    return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / 400.0))


def elo_update(
    rating_a: int, rating_b: int, score_a: float
) -> tuple[int, int, int]:
    """Returns (new_a, new_b, delta_a). score_a: 1 win / 0.5 draw / 0 loss."""
    delta = round(K * (score_a - expected_score(rating_a, rating_b)))
    return rating_a + delta, rating_b - delta, delta
