import argparse


def coffee_grams(water_grams: float, ratio: float) -> float:
    """Return the grams of coffee needed for a given water amount and ratio."""
    if water_grams <= 0:
        raise ValueError("water_grams must be positive")
    if ratio <= 0:
        raise ValueError("ratio must be positive")
    return water_grams / ratio


def main() -> None:
    parser = argparse.ArgumentParser(description="Calculate coffee grams for a brew ratio.")
    parser.add_argument("--water", type=float, required=True, help="Water amount in grams")
    parser.add_argument("--ratio", type=float, default=16, help="Coffee-to-water ratio (default: 16)")
    args = parser.parse_args()

    grams = coffee_grams(args.water, args.ratio)
    print(f"Use {grams:.1f}g of coffee for {args.water:.0f}g of water (1:{args.ratio:g}).")


if __name__ == "__main__":
    main()
