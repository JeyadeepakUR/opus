"""
Image OCR extractor using pytesseract + Pillow.
Gracefully degrades to metadata-only if Tesseract is not installed.
"""

import io

# Try to import OCR dependencies — fail gracefully if not installed
try:
    import pytesseract
    from PIL import Image
    # Quick smoke test so OCR_AVAILABLE is accurate
    pytesseract.get_tesseract_version()
    OCR_AVAILABLE = True
except Exception:
    OCR_AVAILABLE = False


def extract(file_bytes: bytes, filename: str) -> dict:
    if not OCR_AVAILABLE:
        return {
            "text": (
                f"[Image] {filename}\n"
                "OCR not available on this server (Tesseract not installed).\n"
                "Install tesseract-ocr to enable full text extraction from images."
            ),
            "page_count": 0,
        }

    try:
        from PIL import Image as PILImage

        img = PILImage.open(io.BytesIO(file_bytes))

        # Convert to RGB if needed (e.g. RGBA, palette)
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")

        text = pytesseract.image_to_string(img, config="--psm 3")
        text = text.strip()

        if not text:
            return {
                "text": f"[Image] {filename}\nNo text detected by OCR.",
                "page_count": 0,
            }

        return {
            "text": f"[Image: {filename}]\n\n{text}",
            "page_count": 0,
            "metadata": {"width": img.width, "height": img.height},
        }
    except Exception as e:
        return {
            "text": f"[Image] {filename} — OCR failed: {e}",
            "page_count": 0,
        }
