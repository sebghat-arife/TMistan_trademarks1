#!/usr/bin/env python3
"""
LOCAL DEV FIXTURES — generates a realistic-looking sample dataset so the UI,
search functions and image importer can be exercised before the real
Supabase project is connected.

    python3 seed_dev_fixtures.py --dsn postgres://postgres@127.0.0.1:54329/afg_registry

It produces:
  • ~600 trademark rows across 12 gazettes (mirrors "732 records / 12 files")
  • an image folder tree  local-storage/incoming/<gazette>/<gazette>-<nnn>.png
    following the convention the image importer expects, with deliberate gaps
    and one ambiguous duplicate so the dry-run report has something to show

NEVER run this against the production database. It refuses to run if the
target already contains rows whose source_file does not start with FIXTURE_.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import random
import sys
from pathlib import Path

import psycopg
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
INCOMING = ROOT / "local-storage" / "incoming"

GAZETTES = [1011, 1018, 1022, 1027, 1030, 1033, 1036, 1040, 1045, 1050, 1052, 1055]

MARKS = [
    "Caravell", "Ariana Gold", "Kabul Fresh", "Pamir Tea", "Silk Route", "Bamyan Water", "Herat Saffron", "Khyber Steel",
    "Nawroz Foods", "Zamzam Dairy", "Amu Darya Cement", "Panjshir Emerald", "Hindukush Motors", "Alokozay", "Ahmad Shah Traders",
    "Mazar Pharma", "Balkh Textiles", "Nangarhar Citrus", "Kandahar Pomegranate", "Star Afghan", "Green Valley", "Blue Mountain",
    "Sunrise Detergent", "Royal Baker", "Golden Wheat", "Crescent Oil", "Noor Electric", "Sahar Cosmetics", "Watan Rice",
    "Rahimi Brothers", "Safi Airways", "Roshan Telecom", "Etisalat", "Azizi Bank", "Kam Air", "Afghan United", "Hewad Pharma",
    "Milli Cola", "Zafar Beverages", "Delta Chemicals", "Omid Plastics", "Baba Wali Honey", "Meena Foods", "Tolo Media", "Shamshad",
    "Bakhtar Paints", "Ghazni Marble", "Laghman Olive", "Farah Solar", "Takhar Salt", "Kunduz Cotton", "Logar Copper", "Wardak Apples",
    "کابل نان", "آریانا", "پامیر چای", "زمزم", "نور برق", "وطن برنج", "میلی کولا", "هیواد", "ستاره افغان", "سحر",
    "COCA COLA", "COCA-COLA", "Coca Cola Zero", "NIKE", "NIKKE", "ADIDAS", "SAMSUNG", "PANASONIC", "UNILEVER", "NESTLE",
]
APPLICANTS = [
    "Khwaja Zada Adam & Sons Ltd", "Alokozay International Ltd", "Ariana Trading Company", "Kabul Fresh Foods LLC",
    "Pamir Tea Import & Export", "Herat Agro Industries", "Khyber Steel Mills", "The Coca-Cola Company", "Nike Innovate C.V.",
    "adidas AG", "Samsung Electronics Co., Ltd.", "Unilever N.V.", "Société des Produits Nestlé S.A.", "Roshan Telecom Development Company",
    "Azizi Bank", "Kam Air Ltd", "Hewad Pharmaceutical Co.", "Meena Food Industries", "Bakhtar Paint Factory", "Ghazni Marble Co.",
    "شرکت تجارتی آریانا", "شرکت الکوزی", "کمپنی خواجه زاده آدم و پسران", "موسسه تولیدی وطن",
]
ADDRESSES = [
    "Kabul, Afghanistan", "Shar-e-Naw, Kabul, Afghanistan", "Herat City, Herat, Afghanistan", "Mazar-i-Sharif, Balkh, Afghanistan",
    "Jalalabad, Nangarhar, Afghanistan", "Kandahar City, Kandahar, Afghanistan", "One Coca-Cola Plaza, Atlanta, Georgia 30313, USA",
    "One Bowerman Drive, Beaverton, Oregon 97005, USA", "Adi-Dassler-Strasse 1, 91074 Herzogenaurach, Germany",
    "129 Samsung-ro, Yeongtong-gu, Suwon-si, Gyeonggi-do, Republic of Korea", "Weena 455, 3013 AL Rotterdam, Netherlands",
    "Avenue Nestlé 55, 1800 Vevey, Switzerland", "Dubai, United Arab Emirates", "Karachi, Pakistan", "Tehran, Iran", "Istanbul, Turkey",
]
ATTORNEYS = [
    "Afghanistan Legal Services", "Kakar Advocates LLC", "Legal Oracles", "Masnad Law Firm", "Rahimi & Partners", None, None, None,
]
APP_TYPES = ["New Registration", "New Registration", "New Registration", "Renewal", "Change of Address", "Change of Ownership", "Assignment"]
GOODS = {
    3: "Bleaching preparations and other substances for laundry use; cleaning, polishing, scouring and abrasive preparations; soaps; perfumery, essential oils, cosmetics, hair lotions; dentifrices.",
    5: "Pharmaceutical and veterinary preparations; sanitary preparations for medical purposes; dietetic substances adapted for medical use, food for babies; plasters, materials for dressings.",
    9: "Scientific, nautical, surveying, photographic, cinematographic, optical, weighing, measuring, signalling apparatus; apparatus for recording, transmission or reproduction of sound or images; computers; software.",
    12: "Vehicles; apparatus for locomotion by land, air or water; motorcycles; bicycles; tyres; spare parts for vehicles.",
    16: "Paper, cardboard and goods made from these materials; printed matter; bookbinding material; photographs; stationery; adhesives for stationery or household purposes.",
    19: "Building materials (non-metallic); non-metallic rigid pipes for building; asphalt, pitch and bitumen; cement; marble; tiles.",
    25: "Clothing, footwear, headgear; sportswear; shirts; trousers; jackets; shoes; sandals; caps.",
    29: "Meat, fish, poultry and game; meat extracts; preserved, dried and cooked fruits and vegetables; jellies, jams; eggs, milk and milk products; edible oils and fats.",
    30: "Coffee, tea, cocoa, sugar, rice, tapioca, sago, artificial coffee; flour and preparations made from cereals, bread, pastry and confectionery, ices; honey; salt; spices; saffron.",
    32: "Beers; mineral and aerated waters and other non-alcoholic drinks; fruit drinks and fruit juices; syrups and other preparations for making beverages.",
    35: "Advertising; business management; business administration; office functions; retail services; import-export agency services.",
    36: "Insurance; financial affairs; monetary affairs; real estate affairs; banking services; money transfer services.",
    38: "Telecommunications; mobile telephone services; internet service provider services; broadcasting services.",
    39: "Transport; packaging and storage of goods; travel arrangement; air transport; freight forwarding.",
    43: "Services for providing food and drink; temporary accommodation; restaurants; hotels; catering.",
}
CLASS_KEYS = list(GOODS.keys())

# Dari/Pashto phrases for review notes
NOTES = [None] * 12 + ["Applicant name partially illegible in scan; transcribed as printed.", "Class number smudged — read as 25, could be 26.",
                       "Publication date inferred from gazette cover.", "نام متقاضی در اسکن ناخوانا است"]


def rnd_date(base: dt.date, spread: int) -> dt.date:
    return base + dt.timedelta(days=random.randint(0, spread))


def make_logo(path: Path, text: str, seed: int) -> None:
    random.seed(seed)
    w, h = random.choice([(600, 400), (500, 500), (800, 300), (640, 480)])
    bg = random.choice(["#ffffff", "#fafafa", "#f3f4f6", "#fff8e1"])
    fg = random.choice(["#0d3320", "#1f2937", "#7c2d12", "#1e3a8a", "#831843", "#0f766e", "#b91c1c"])
    img = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(img)
    shape = random.choice(["circle", "rect", "diamond", "none", "ring"])
    cx, cy = w // 2, h // 2
    r = min(w, h) // 3
    if shape == "circle":
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=fg)
    elif shape == "ring":
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=fg, width=max(6, r // 8))
    elif shape == "rect":
        d.rounded_rectangle([cx - r * 1.3, cy - r * 0.7, cx + r * 1.3, cy + r * 0.7], radius=r // 5, fill=fg)
    elif shape == "diamond":
        d.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=fg)
    font = None
    for cand in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        if os.path.exists(cand):
            font = ImageFont.truetype(cand, size=max(24, min(w // max(6, len(text)), 90)))
            break
    if font is None:
        font = ImageFont.load_default()
    label = text if all(ord(c) < 0x600 for c in text) else "".join(ch for ch in text if ord(ch) < 0x600) or "MARK"
    bbox = d.textbbox((0, 0), label, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    color = bg if shape in ("circle", "rect", "diamond") else fg
    d.text(((w - tw) / 2 - bbox[0], (h - th) / 2 - bbox[1]), label, font=font, fill=color)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG", optimize=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dsn", default=os.environ.get("DATABASE_URL", "postgres://postgres@127.0.0.1:54329/afg_registry"))
    ap.add_argument("--seed", type=int, default=20260905)
    ap.add_argument("--no-images", action="store_true")
    args = ap.parse_args()
    random.seed(args.seed)

    with psycopg.connect(args.dsn) as conn, conn.cursor() as cur:
        cur.execute("select count(*) from public.trademarks where coalesce(source_file,'') not like 'FIXTURE_%'")
        (real_rows,) = cur.fetchone()
        if real_rows:
            print(f"REFUSING: database already contains {real_rows} non-fixture trademark rows.", file=sys.stderr)
            return 2
        cur.execute("delete from public.trademark_images; delete from public.trademarks; delete from public.gazettes; delete from public.audit_logs; delete from public.import_jobs;")

        base = dt.date(2023, 3, 21)
        total = 0
        serial_index: dict[int, list[tuple[str, str]]] = {}
        for gi, g in enumerate(GAZETTES):
            pub = base + dt.timedelta(days=gi * 46 + random.randint(0, 5))
            n = random.randint(35, 75)
            cur.execute(
                "insert into public.gazettes (gazette_number, publication_date, title, source_file) values (%s,%s,%s,%s) on conflict (gazette_number) do update set publication_date=excluded.publication_date, title=excluded.title, source_file=excluded.source_file",
                (str(g), pub, f"Official Gazette No. {g}", f"FIXTURE_trademark_records_{g}.xlsx"),
            )
            serial_index[g] = []
            for i in range(1, n + 1):
                serial = f"{g}-{i:03d}"
                mark = random.choice(MARKS)
                cls = random.choice(CLASS_KEYS)
                extra_cls = random.random() < 0.18
                cls_text = f"{cls}, {random.choice(CLASS_KEYS)}" if extra_cls else str(cls)
                app_type = random.choice(APP_TYPES)
                applicant = random.choice(APPLICANTS)
                if mark in ("COCA COLA", "COCA-COLA", "Coca Cola Zero"):
                    applicant = "The Coca-Cola Company"
                elif mark in ("NIKE", "NIKKE"):
                    applicant = "Nike Innovate C.V." if mark == "NIKE" else "Nikke Traders Ltd"
                row = dict(
                    record_number=str(total + 1),
                    serial_number=serial,
                    mark_name=mark,
                    mark_print=mark.upper() if random.random() < 0.3 else mark,
                    applicant_name=applicant,
                    applicant_address=random.choice(ADDRESSES),
                    trademark_class=cls_text,
                    goods_and_services=GOODS[cls] + (" " + GOODS[int(cls_text.split(", ")[1])] if extra_cls else ""),
                    application_type=app_type,
                    attorney_or_representative=random.choice(ATTORNEYS),
                    publication_date=pub,
                    objection_deadline=pub + dt.timedelta(days=30),
                    official_gazette_number=str(g),
                    new_address=random.choice(ADDRESSES) if app_type == "Change of Address" else None,
                    old_address=random.choice(ADDRESSES) if app_type == "Change of Address" else None,
                    new_owner=random.choice(APPLICANTS) if app_type in ("Change of Ownership", "Assignment") else None,
                    old_owner=random.choice(APPLICANTS) if app_type in ("Change of Ownership", "Assignment") else None,
                    source_page=str(2 + i // 4),
                    review_note=random.choice(NOTES),
                    source_file=f"FIXTURE_trademark_records_{g}.xlsx",
                    source_sheet="Index",
                    source_row=i + 3,
                    review_status=random.choice(["unreviewed"] * 6 + ["reviewed", "verified", "needs_correction"]),
                )
                cols = ", ".join(row)
                ph = ", ".join(["%s"] * len(row))
                cur.execute(f"insert into public.trademarks ({cols}) values ({ph})", list(row.values()))
                serial_index[g].append((serial, mark))
                total += 1
        conn.commit()
        print(f"Inserted {total} fixture trademarks across {len(GAZETTES)} gazettes.")

    if args.no_images:
        return 0

    # Image folders: most serials get an image; some are missing; a couple of
    # extra files exist that match nothing (to exercise the unmatched queue);
    # one serial gets two candidate files (ambiguous).
    if INCOMING.exists():
        for p in sorted(INCOMING.rglob("*"), reverse=True):
            p.unlink() if p.is_file() else p.rmdir()
    made = 0
    for g, items in serial_index.items():
        folder = INCOMING / str(g)
        for idx, (serial, mark) in enumerate(items):
            if random.random() < 0.12:  # missing image
                continue
            make_logo(folder / f"{serial}.png", mark, seed=hash((serial, mark)) & 0xFFFF)
            made += 1
            if idx == 5:  # ambiguous: a second candidate for the same serial
                make_logo(folder / f"{serial} (2).png", mark, seed=99)
        # stray files that match nothing
        make_logo(folder / f"{g}-999.png", "ORPHAN", seed=1)
        (folder / "Thumbs.db").write_bytes(b"\x00")
    print(f"Wrote {made} fixture images under {INCOMING}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
