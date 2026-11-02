#!/usr/bin/env bash
# Build the Spot the Slop classroom kit printables (poster + worksheet)
# from their HTML sources. Requires: python3 + WeasyPrint (any install),
# and pdftoppm (poppler-utils) for the PNG renders.
#   ./build.sh            rebuild everything
set -euo pipefail
cd "$(dirname "$0")"
PY="${WEASYPRINT_PYTHON:-python3}"
"$PY" - <<'PYEOF'
from weasyprint import HTML
HTML(filename="poster/poster.html").write_pdf("poster/poster.pdf")
print("poster/poster.pdf")
doc = HTML(filename="worksheet/worksheet.html").render()
doc.write_pdf("worksheet/worksheet.pdf")
print("worksheet/worksheet.pdf", len(doc.pages), "pages")
PYEOF
pdftoppm -png -r 150 -singlefile poster/poster.pdf poster/poster
pdftoppm -png -r 150 worksheet/worksheet.pdf worksheet/worksheet-page
echo "PNG renders done"
