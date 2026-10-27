"""Text normalisation, script detection and conservative transliteration variants.

The database owns the canonical normalisation (public.normalize_text); this
module only tokenises, classifies scripts and proposes *candidate* spellings
that the search treats as lower-weight "possible transliteration" evidence.
Nothing here is presented to the user as a confirmed reading.
"""
from __future__ import annotations

import re
import unicodedata

ARABIC_RANGE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]")
LATIN_RANGE = re.compile(r"[A-Za-z\u00C0-\u024F]")
DIGIT_RANGE = re.compile(r"[0-9\u0660-\u0669\u06F0-\u06F9]")
_DIACRITICS = re.compile(r"[\u064B-\u0652\u0670\u0640\u0610-\u061A\u06D6-\u06ED]")
_PUNCT = re.compile(r"[^\w\u0600-\u06FF]+", re.UNICODE)

_FOLD = str.maketrans({
    "ي": "ی", "ك": "ک", "ة": "ه", "ۀ": "ه", "أ": "ا", "إ": "ا", "آ": "ا", "ؤ": "و", "ئ": "ی",
    "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
    "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
})


def normalize(text: str) -> str:
    """Lower-cased, unaccented, diacritic-free, punctuation → space (close to the SQL function)."""
    t = unicodedata.normalize("NFKC", text or "")
    t = _DIACRITICS.sub("", t).translate(_FOLD)
    t = "".join(c for c in unicodedata.normalize("NFKD", t) if not unicodedata.combining(c))
    t = _PUNCT.sub(" ", t.lower())
    return re.sub(r"\s+", " ", t).strip()


def script_of(token: str) -> str:
    if ARABIC_RANGE.search(token):
        return "arabic"
    if LATIN_RANGE.search(token):
        return "latin"
    if DIGIT_RANGE.search(token):
        return "digit"
    return "other"


def tokens(text: str) -> list[str]:
    return [t for t in normalize(text).split(" ") if t]


def plausible_token(token: str, script: str) -> bool:
    """Filter OCR noise: single letters, symbol salad, improbable consonant runs."""
    if script == "digit":
        return len(token) >= 2
    if len(token) < 2:
        return False
    if script == "latin":
        letters = sum(ch.isalpha() for ch in token)
        if letters < max(2, int(len(token) * 0.6)):
            return False
        if len(token) >= 4 and not re.search(r"[aeiouy]", token):
            # e.g. "xqtrn" — allow well-known all-consonant brands only if short
            return len(token) <= 5
        if re.search(r"(.)\1\1\1", token):
            return False
        return True
    if script == "arabic":
        return len(token) >= 2 and all(ARABIC_RANGE.match(ch) or ch.isdigit() for ch in token)
    return False


# ------------------------------------------------------------------ Arabic script → Latin candidates

# primary mapping + alternatives per letter (Dari/Pashto pronunciation, conservative)
_AR2LAT: dict[str, tuple[str, ...]] = {
    "ا": ("a", ""), "ب": ("b",), "پ": ("p",), "ت": ("t",), "ټ": ("t",), "ث": ("s",), "ج": ("j",), "چ": ("ch",),
    "ح": ("h",), "خ": ("kh",), "د": ("d",), "ډ": ("d",), "ذ": ("z",), "ر": ("r",), "ړ": ("r",), "ز": ("z",),
    "ژ": ("zh",), "ږ": ("g", "zh"), "س": ("s",), "ش": ("sh",), "ښ": ("sh", "kh"), "ص": ("s",), "ض": ("z",),
    "ط": ("t",), "ظ": ("z",), "ع": ("", "a"), "غ": ("gh",), "ف": ("f",), "ق": ("q", "k"), "ک": ("k",),
    "ګ": ("g",), "گ": ("g",), "ل": ("l",), "م": ("m",), "ن": ("n",), "ڼ": ("n",), "ه": ("h", "a"),
    "و": ("o", "u", "oo", "w", "ou"), "ی": ("i", "y", "ee"), "ې": ("e",), "ۍ": ("ai", "i"), "ئ": ("i",),
    "ء": ("",), "آ": ("a",),
}


def arabic_to_latin_variants(token: str, limit: int = 6) -> list[str]:
    """Candidate Latin spellings for an Arabic-script token.

    Builds the primary transliteration, then widens the most ambiguous letters
    (و / ی / initial ا) one at a time. Returns distinct candidates, primary first.
    """
    token = normalize(token)
    if not token or script_of(token) != "arabic":
        return []
    letters = list(token)
    primary: list[str] = []
    for i, ch in enumerate(letters):
        opts = _AR2LAT.get(ch)
        if opts is None:
            continue
        if ch == "ا" and i == 0:
            primary.append("a")
        elif ch == "و" and i == 0:
            primary.append("w")
        elif ch == "ه" and i == len(letters) - 1:
            primary.append("a" if len(letters) > 2 else "h")
        else:
            primary.append(opts[0])
    base = "".join(primary)
    out: list[str] = []
    if len(base) >= 2:
        out.append(base)
    # alternates: vary one ambiguous letter at a time
    for i, ch in enumerate(letters):
        alts = _AR2LAT.get(ch, ())
        if ch in ("و", "ی", "ق", "ع", "ښ", "ږ") and len(alts) > 1:
            for alt in alts[1:]:
                cand = primary.copy()
                if i < len(cand):
                    cand[i] = alt
                s = "".join(cand)
                if len(s) >= 2 and s not in out:
                    out.append(s)
                if len(out) >= limit:
                    return out
    # common doubled-vowel spellings (nur → noor, amiri → ameeri) – keep it short
    for s in list(out):
        for a, b in (("u", "oo"), ("o", "oo"), ("i", "ee")):
            v = s.replace(a, b, 1)
            if v != s and v not in out and len(out) < limit:
                out.append(v)
    return out[:limit]


# ------------------------------------------------------------------ Latin → Arabic script skeleton

_LAT2AR_MULTI = [("kh", "خ"), ("gh", "غ"), ("sh", "ش"), ("ch", "چ"), ("zh", "ژ"), ("th", "ت"), ("ph", "ف"),
                 ("oo", "و"), ("ou", "و"), ("ee", "ی"), ("ck", "ک"), ("qu", "ک")]
_LAT2AR = {"a": "ا", "b": "ب", "c": "ک", "d": "د", "e": "", "f": "ف", "g": "گ", "h": "ه", "i": "ی", "j": "ج",
           "k": "ک", "l": "ل", "m": "م", "n": "ن", "o": "و", "p": "پ", "q": "ق", "r": "ر", "s": "س", "t": "ت",
           "u": "و", "v": "و", "w": "و", "x": "کس", "y": "ی", "z": "ز"}


def latin_to_arabic_variants(token: str, limit: int = 3) -> list[str]:
    """Consonant-skeleton candidates in Arabic script (short vowels dropped as in
    Persian orthography; initial vowel kept as ا, final 'a'/'e' as ه)."""
    t = normalize(token)
    if not t or script_of(t) != "latin" or not t.isascii():
        return []
    s = t
    for a, b in _LAT2AR_MULTI:
        s = s.replace(a, f"<{b}>")
    out = []
    i = 0
    n = len(s)
    while i < n:
        ch = s[i]
        if ch == "<":
            j = s.index(">", i)
            out.append(s[i + 1:j]); i = j + 1; continue
        if ch in "aeiou":
            if i == 0:
                out.append("ا" if ch != "o" and ch != "u" else "او")
            elif i == n - 1 and ch in "ae":
                out.append("ه")
            elif ch in "ou":
                out.append("و")
            elif ch == "i":
                out.append("ی")
            # short a / e inside the word are dropped
        else:
            out.append(_LAT2AR.get(ch, ""))
        i += 1
    base = "".join(out)
    cands = [base] if len(base) >= 2 else []
    # second candidate keeps every long vowel 'a' (common in brand transliterations: پامیر, سمندر)
    with_a = base
    alt = []
    i = 0
    for ch in t:
        alt.append("ا" if ch == "a" else "")
    if any(alt):
        # rebuild writing inner 'a' as ا
        out2 = []
        s2 = t
        for a, b in _LAT2AR_MULTI:
            s2 = s2.replace(a, f"<{b}>")
        i = 0
        n2 = len(s2)
        while i < n2:
            ch = s2[i]
            if ch == "<":
                j = s2.index(">", i); out2.append(s2[i + 1:j]); i = j + 1; continue
            if ch == "a":
                out2.append("ا")
            elif ch in "eiou":
                out2.append("" if ch == "e" else ("ی" if ch == "i" else "و"))
            else:
                out2.append(_LAT2AR.get(ch, ""))
            i += 1
        with_a = "".join(out2)
        if with_a != base and len(with_a) >= 2:
            cands.append(with_a)
    return cands[:limit]


def variants_for(words: list[str]) -> list[dict]:
    """Labelled candidate spellings for every recognised word (both directions)."""
    out: list[dict] = []
    seen: set[str] = set()
    for w in words:
        s = script_of(w)
        cands = arabic_to_latin_variants(w) if s == "arabic" else latin_to_arabic_variants(w) if s == "latin" else []
        for c in cands:
            if c not in seen and c != normalize(w):
                seen.add(c)
                out.append({"text": c, "from": w, "kind": "transliteration", "script": script_of(c)})
    return out
