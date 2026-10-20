"""Tiny finance-headline sentiment scorer (no ML, no dependencies).

Counts positive and negative finance words, flips a word's sign when it follows a negation
("fails to beat"), and returns a score in (-1, 1). It is deliberately simple and transparent:
it reads tone, not meaning, and will miss sarcasm, context and anything not in the word lists.
"""
import re

# Base forms only; _forms() adds -s/-es/-ed/-ing variants.
POSITIVE = """
beat outperform exceed top surge soar rally jump climb gain rise boom boost lift upgrade raise record strong
robust growth grow expand profit profitable bullish optimism optimistic recover rebound approve approval win
breakthrough buyback dividend accelerate improve upbeat positive thrive bargain
""".split()
NEGATIVE = """
miss underperform plunge tumble slump sink drop fall decline slide crash lose loss cut downgrade weak weaken
warn warning fear fears recession layoff lawsuit sue probe investigation recall fraud bankrupt bankruptcy
default concern risk selloff slowdown shortage tariff fine penalty delay halt suspend bearish pessimism
pessimistic stall worry struggle trouble hurt volatile volatility turmoil
""".split()
NEGATIONS = {"not", "no", "never", "without", "fails", "fail", "failed", "lacks", "lack", "n't", "unable"}


def _forms(word: str) -> set:
    forms = {word, word + "s", word + "es", word + "ed", word + "d", word + "ing"}
    if word.endswith("e"):
        forms.add(word[:-1] + "ing")
    if word.endswith("y"):
        forms |= {word[:-1] + "ies", word[:-1] + "ied"}
    return forms


_POS = {f for w in POSITIVE for f in _forms(w)}
_NEG = {f for w in NEGATIVE for f in _forms(w)}
_TOKEN = re.compile(r"[a-z']+")


def score(text: str) -> float:
    """Sentiment of one headline in (-1, 1); 0 means neutral or no known words."""
    tokens = _TOKEN.findall(text.lower())
    pos = neg = 0.0
    negate = 0  # a negation flips the next sentiment word within 2 tokens, once
    for tok in tokens:
        if tok in NEGATIONS:
            negate = 2
            continue
        sign = 1 if tok in _POS else -1 if tok in _NEG else 0
        if sign and negate:
            sign, negate = -sign, 0
        negate = max(0, negate - 1)
        if sign > 0:
            pos += 1
        elif sign < 0:
            neg += 1
    return (pos - neg) / (pos + neg + 1)
