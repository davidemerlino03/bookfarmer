#!/usr/bin/env bash
set -e

APP_DIR="/Users/davide/Desktop/web-scrcpy-main"
REMOTE_URL="https://github.com/davidemerlino03/bookfarmer.git"

cd "$APP_DIR"

if ! command -v adb >/dev/null 2>&1; then
  echo "[bookfarmer] adb non e installato o non e presente nel PATH."
  echo "[bookfarmer] Installa Android Platform Tools, poi riavvia questo script."
  exit 1
fi

VERSION_PATTERN='^v?[0-9]+(\.[0-9]+)*$'
VERSION_FILE=".current_release"

echo "[bookfarmer] Controllo nuove release..."
if ! git remote get-url origin >/dev/null 2>&1; then
  echo "[bookfarmer] Configuro il repository remoto..."
  git remote add origin "$REMOTE_URL"
elif [ "$(git remote get-url origin)" != "$REMOTE_URL" ]; then
  echo "[bookfarmer] Correggo il repository remoto..."
  git remote set-url origin "$REMOTE_URL"
fi

git fetch origin --tags

LATEST_TAG="$(
  git tag --list |
  grep -E "$VERSION_PATTERN" |
  sort -V |
  tail -n 1
)"

if [ -z "$LATEST_TAG" ]; then
  echo "[bookfarmer] Nessuna release trovata. Avvio la versione locale."
else
  CURRENT_TAG=""
  if [ -f "$VERSION_FILE" ]; then
    CURRENT_TAG="$(cat "$VERSION_FILE")"
  else
    CURRENT_TAG="$(git describe --tags --exact-match 2>/dev/null || true)"
  fi

  if [ "$CURRENT_TAG" != "$LATEST_TAG" ]; then
    if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
      echo "[bookfarmer] Ci sono modifiche locali tracciate. Aggiornamento annullato."
      echo "[bookfarmer] Commit/stash delle modifiche prima di aggiornare alla release $LATEST_TAG."
    else
      echo "[bookfarmer] Nuova release trovata: $LATEST_TAG"
      git checkout --detach "$LATEST_TAG"
      echo "$LATEST_TAG" > "$VERSION_FILE"
      echo "[bookfarmer] Aggiornato alla release $LATEST_TAG."
    fi
  else
    echo "[bookfarmer] Versione gia aggiornata: $LATEST_TAG"
  fi

  if [ -x "venv/bin/python" ] && [ -f "requirements.txt" ]; then
    echo "[bookfarmer] Aggiorno dipendenze..."
    venv/bin/python -m pip install -r requirements.txt
  fi
fi

echo "[bookfarmer] Avvio applicazione..."
if [ -x "venv/bin/python" ]; then
  exec venv/bin/python app.py
else
  exec python3 app.py
fi
