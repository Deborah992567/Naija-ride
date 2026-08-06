"""Pre-download the in-house biometric ONNX models (YuNet + SFace).

They normally download automatically on the first liveness request, but you can
run this ahead of time (e.g. during deploy) so the first driver isn't stuck
behind a download:

    /Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12 scripts/download_biometric_models.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.biometric import MODEL_FILES, _download_model, _model_path  # noqa: E402

ok = True
for name in MODEL_FILES:
    path = _model_path(name)
    if path.exists():
        print(f"[ok] {name} already present ({path.name})")
        continue
    print(f"[..] downloading {name} ...")
    ok = _download_model(name, path) and ok
    if path.exists():
        print(f"[ok] {name} -> {path}")
print("Biometric models ready." if ok else "One or more models failed to download.")
sys.exit(0 if ok else 1)
