import unittest

from brew_ratio import coffee_grams


class TestCoffeeGrams(unittest.TestCase):
    def test_standard_ratio(self):
        self.assertAlmostEqual(coffee_grams(500, 16), 31.25)

    def test_different_ratio(self):
        self.assertAlmostEqual(coffee_grams(300, 15), 20.0)


if __name__ == "__main__":
    unittest.main()
