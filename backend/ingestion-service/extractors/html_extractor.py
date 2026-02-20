"""
HTML extractor using BeautifulSoup4.
Strips scripts/styles/nav/footer and returns clean readable text.
"""


def extract(file_bytes: bytes, filename: str) -> dict:
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        # Fallback: naive tag strip
        import re
        text = re.sub(r"<[^>]+>", " ", file_bytes.decode("utf-8", errors="replace"))
        text = " ".join(text.split())
        return {"text": text, "page_count": 0}

    html_text = file_bytes.decode("utf-8", errors="replace")
    soup = BeautifulSoup(html_text, "lxml")

    # Remove non-content elements
    for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript"]):
        tag.decompose()

    # Prefer <article> or <main> if present for cleaner extraction
    main = soup.find("article") or soup.find("main") or soup.find("body") or soup

    lines: list[str] = []
    for element in main.descendants:
        if hasattr(element, "name"):
            if element.name in ("h1", "h2", "h3", "h4", "h5", "h6"):
                text = element.get_text(" ", strip=True)
                if text:
                    lines.append(f"\n## {text}\n")
            elif element.name == "p":
                text = element.get_text(" ", strip=True)
                if text:
                    lines.append(text)
            elif element.name in ("li",):
                text = element.get_text(" ", strip=True)
                if text:
                    lines.append(f"• {text}")
            elif element.name == "td" or element.name == "th":
                text = element.get_text(" ", strip=True)
                if text:
                    lines.append(text)

    # Deduplicate consecutive blank lines
    result: list[str] = []
    prev_blank = False
    for line in lines:
        is_blank = not line.strip()
        if is_blank and prev_blank:
            continue
        result.append(line)
        prev_blank = is_blank

    return {"text": "\n".join(result), "page_count": 0}
