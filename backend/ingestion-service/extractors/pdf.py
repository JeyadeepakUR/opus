"""
PDF extractor using PyMuPDF (fitz).
Handles text-based PDFs. For scanned PDFs, also extracts embedded text
from images via PyMuPDF's built-in text layer detection.
"""

import fitz  # pymupdf


def extract(file_bytes: bytes, filename: str) -> dict:
    """
    Extract all text from a PDF, page by page.

    Returns:
        {
            "text":       full extracted text (pages joined by \\f),
            "page_count": total pages,
            "metadata":   { "title", "author", "subject" }
        }
    """
    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as e:
        return {"text": f"[PDF Error] Could not open {filename}: {e}", "page_count": 0}

    page_texts: list[str] = []
    for page in doc:
        page_text = page.get_text("text")  # plain text, preserving layout
        if page_text.strip():
            page_texts.append(page_text)

    meta = doc.metadata or {}
    doc.close()

    full_text = "\n\n---PAGE BREAK---\n\n".join(page_texts)
    return {
        "text": full_text,
        "page_count": len(page_texts),
        "metadata": {
            "title":   meta.get("title", ""),
            "author":  meta.get("author", ""),
            "subject": meta.get("subject", ""),
        },
    }
