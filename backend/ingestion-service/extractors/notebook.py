"""
Jupyter Notebook extractor using nbformat.
Extracts markdown cells as-is and code cells inside fenced code blocks.
"""

import json


def extract(file_bytes: bytes, filename: str) -> dict:
    try:
        # Try nbformat first (preserves cell metadata)
        import nbformat
        nb = nbformat.reads(file_bytes.decode("utf-8", errors="replace"), as_version=4)
        cells = nb.cells
    except Exception:
        # Fallback: raw JSON parse
        try:
            raw = json.loads(file_bytes.decode("utf-8", errors="replace"))
            cells = raw.get("cells", [])
        except Exception as e:
            return {"text": f"[Notebook Error] Could not parse {filename}: {e}", "page_count": 0}

    parts: list[str] = [f"# Jupyter Notebook: {filename}\n"]

    for idx, cell in enumerate(cells):
        cell_type = cell.get("cell_type", "")
        source = cell.get("source", "")
        if isinstance(source, list):
            source = "".join(source)
        source = source.strip()
        if not source:
            continue

        if cell_type == "markdown":
            parts.append(source)
        elif cell_type == "code":
            parts.append(f"\n```python\n{source}\n```\n")
        elif cell_type == "raw":
            parts.append(source)

    return {"text": "\n\n".join(parts), "page_count": 0}
