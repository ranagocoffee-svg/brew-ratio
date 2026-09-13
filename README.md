# Brew Ratio

A tiny command-line tool that calculates how much coffee and water you need
based on your prefered brew ratio.

## Usage

```bash
python brew_ratio.py --water 500 --ratio 16
```

This prints the amount of coffee (in grams) needed for 500g of water at a
1:16 coffee-to-water ratio.

## Options

- `--water`: amount of water in grams (required)
- `--ratio`: coffee-to-water ratio, e.g. `16` for 1:16 (default: `16`)

## Running tests

```bash
python -m unittest test_brew_ratio.py
```
