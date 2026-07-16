import unittest
from decimal import Decimal

from acreline_worker.costs import estimate_cost


class CostTests(unittest.TestCase):
    def test_luna_includes_web_search_fees(self) -> None:
        self.assertEqual(estimate_cost("gpt-5.6-luna", 1_000_000, 100_000, 2), Decimal("1.62"))

    def test_gpt4o_mini_applies_fixed_search_input_block_and_fee(self) -> None:
        self.assertEqual(estimate_cost("gpt-4o-mini", 500, 100, 1), Decimal("0.01126"))


if __name__ == "__main__":
    unittest.main()
