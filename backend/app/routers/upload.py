"""Secure file uploads (driver documents, profile photos, moving item photos).

Files are validated by extension + content sniffing and stored under
`uploads/`, served back at `/uploads/<filename>`.
"""
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile

from ..config import ROOT_DIR
from ..core.deps import current_user
from ..models.user import User

router = APIRouter(prefix="/api", tags=["upload"])

UPLOAD_DIR = ROOT_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
ALLOWED_CONTENT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}
MAX_BYTES = 5 * 1024 * 1024  # 5 MB


def _sniff_magic(data: bytes) -> Optional[str]:
    """Return the extension implied by a file's magic bytes, or None."""
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    if data.startswith(b"%PDF-"):
        return ".pdf"
    return None


@router.post("/upload")
async def upload_file(
    file: UploadFile,
    user: User = Depends(current_user),
):
    content_type = (file.content_type or "").lower()
    ext = ALLOWED_CONTENT.get(content_type)
    if ext is None:
        # Fall back to extension check for clients that don't set content type.
        ext = Path(file.filename or "").suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Unsupported file type (jpg, png, webp, pdf only)")
    if file.size is not None and file.size > MAX_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 5 MB)")

    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 5 MB)")

    # Content sniffing: trust the file's magic bytes over its claimed type.
    sniffed = _sniff_magic(data)
    if sniffed is None:
        raise HTTPException(status_code=400, detail="File content does not match a supported type")
    ext = sniffed
    if ALLOWED_CONTENT.get(content_type) not in (ext, None):
        raise HTTPException(status_code=400, detail="Declared content type does not match file content")

    name = f"{user.user_id[:8]}_{uuid.uuid4().hex[:12]}{ext}"
    path = UPLOAD_DIR / name
    path.write_bytes(data)
    return {"url": f"/uploads/{name}"}
