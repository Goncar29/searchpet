#!/usr/bin/env bash
# bump-version.sh — incrementa la versión de la app Expo y hace commit [skip ci]
#
# Uso:
#   ./bump-version.sh           # incrementa patch (default)
#   ./bump-version.sh patch     # incrementa patch
#   ./bump-version.sh minor     # incrementa minor, resetea patch
#   ./bump-version.sh major     # incrementa major, resetea minor y patch
#
# Qué hace:
#   1. Valida que app.json sea JSON válido
#   2. Lee version (semver) y versionCode (Android int)
#   3. Calcula las nuevas versiones
#   4. Escribe el archivo actualizado
#   5. Hace git commit con [skip ci]

set -euo pipefail

APP_JSON="frontend/packages/mobile/app.json"
BUMP="${1:-patch}"

# ── 1. Validar que el archivo existe y es JSON válido ──────────────────────
if [[ ! -f "$APP_JSON" ]]; then
  echo "ERROR: No se encontró $APP_JSON" >&2
  exit 1
fi

if ! python3 -c "import json, sys; json.load(open('$APP_JSON'))" 2>/dev/null; then
  echo "ERROR: $APP_JSON no es JSON válido" >&2
  exit 1
fi

# ── 2. Leer valores actuales ───────────────────────────────────────────────
CURRENT_VERSION=$(python3 -c "import json; d=json.load(open('$APP_JSON')); print(d['expo']['version'])")

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# ── 3. Calcular nueva versión semver ──────────────────────────────────────
case "$BUMP" in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
  *)
    echo "ERROR: Argumento inválido '$BUMP'. Usá: major | minor | patch" >&2
    exit 1
    ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

# Nota: versionCode (Android) es gestionado por EAS autoIncrement: true en eas.json.
# Este script solo bumpa la versión semver visible al usuario.
echo "Bumping: $CURRENT_VERSION → $NEW_VERSION"

# ── 4. Escribir app.json actualizado ──────────────────────────────────────
python3 - <<EOF
import json

with open('$APP_JSON', 'r', encoding='utf-8') as f:
    data = json.load(f)

data['expo']['version'] = '$NEW_VERSION'

with open('$APP_JSON', 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write('\n')

print("app.json actualizado OK")
EOF

# ── 5. Git commit con [skip ci] ───────────────────────────────────────────
git add "$APP_JSON"
git commit -m "chore(release): bump version to $NEW_VERSION [skip ci]"

echo "✓ Commit listo: v$NEW_VERSION"
