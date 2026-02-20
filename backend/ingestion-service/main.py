"""
Ingestion Sidecar — FastAPI microservice for document text extraction.

Handles everything the Node.js backend can't do natively:
  - PDF          → pymupdf (fitz)
  - DOCX         → python-docx
  - XLSX         → openpyxl
  - PPTX         → python-pptx
  - Jupyter (.ipynb) → nbformat
  - HTML         → beautifulsoup4
  - Images       → pytesseract (optional, graceful fallback)

Two endpoints:
  POST /extract              — upload raw file bytes (multipart)
  POST /extract-from-drive   — pass file_id + access_token; Python downloads from Drive directly
                               (preferred — Node never loads the file bytes into V8 memory)
"""

import logging
import traceback
import requests as http_requests
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from extractors import pdf, office, notebook, html_extractor, image

logging.basicConfig(level=logging.INFO, format="[Sidecar] %(levelname)s %(message)s")
log = logging.getLogger(__name__)

app = FastAPI(title="Libra Ingestion Sidecar", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExtractResponse(BaseModel):
    text: str
    page_count: int = 0
    metadata: dict = {}


# Map MIME types → extractor functions
EXTRACTORS = {
    "application/pdf": pdf.extract,
    # Uploaded Office files (.docx / .xlsx / .pptx)
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": office.extract_docx,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": office.extract_xlsx,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": office.extract_pptx,
    # Jupyter notebooks
    "application/json": notebook.extract,
    "application/x-ipynb+json": notebook.extract,
    "application/vnd.google.colaboratory": notebook.extract,
    # HTML
    "text/html": html_extractor.extract,
    # Images (OCR)
    "image/jpeg": image.extract,
    "image/png": image.extract,
    "image/webp": image.extract,
    "image/gif": image.extract,
    "image/tiff": image.extract,
    "image/bmp": image.extract,
}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "supported_types": list(EXTRACTORS.keys()),
        "ocr_available": image.OCR_AVAILABLE,
    }


@app.post("/extract", response_model=ExtractResponse)
async def extract(
    file: UploadFile = File(...),
    mime_type: str = Form(...),
    filename: Optional[str] = Form(default="unknown"),
):
    log.info(f"Extract request: {filename!r}  mime={mime_type}  size≈{file.size}")

    extractor_fn = EXTRACTORS.get(mime_type)
    if not extractor_fn:
        raise HTTPException(status_code=415, detail=f"Unsupported MIME type: {mime_type}")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        result = extractor_fn(file_bytes, filename or "unknown")
        text = result.get("text", "").strip()
        page_count = result.get("page_count", 0)
        metadata = result.get("metadata", {})

        log.info(f"Extracted {len(text)} chars, {page_count} pages  [{filename}]")
        return ExtractResponse(text=text, page_count=page_count, metadata=metadata)

    except Exception as exc:
        log.error(f"Extraction failed for {filename}: {exc}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Extraction error: {str(exc)[:300]}")


class DriveExtractRequest(BaseModel):
    file_id: str
    access_token: str
    mime_type: str
    filename: str = "unknown"


@app.post("/extract-from-drive", response_model=ExtractResponse)
def extract_from_drive(req: DriveExtractRequest):
    """
    Download a Google Drive file directly in Python using the provided access token,
    then extract its text.  Node.js never loads the file bytes — no V8 memory pressure.
    """
    log.info(f"Drive extract: {req.filename!r}  mime={req.mime_type}  id={req.file_id}")

    extractor_fn = EXTRACTORS.get(req.mime_type)
    if not extractor_fn:
        raise HTTPException(status_code=415, detail=f"Unsupported MIME type: {req.mime_type}")

    # Download the file directly from Google Drive
    drive_url = f"https://www.googleapis.com/drive/v3/files/{req.file_id}?alt=media"
    headers = {"Authorization": f"Bearer {req.access_token}"}

    try:
        resp = http_requests.get(drive_url, headers=headers, timeout=120)
        if resp.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"Drive download failed: {resp.status_code} {resp.text[:200]}"
            )
        file_bytes = resp.content
    except http_requests.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Drive download error: {e}")

    log.info(f"Downloaded {len(file_bytes)} bytes from Drive  [{req.filename}]")

    try:
        result = extractor_fn(file_bytes, req.filename)
        text = result.get("text", "").strip()
        page_count = result.get("page_count", 0)
        metadata = result.get("metadata", {})

        log.info(f"Extracted {len(text)} chars, {page_count} pages  [{req.filename}]")
        return ExtractResponse(text=text, page_count=page_count, metadata=metadata)

    except Exception as exc:
        log.error(f"Extraction failed for {req.filename}: {exc}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Extraction error: {str(exc)[:300]}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
