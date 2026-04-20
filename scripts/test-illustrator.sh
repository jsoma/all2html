#!/bin/bash
# Test all2html.js against all .ai files in data/
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
ALL2HTML="$ROOT/dist/all2html.js"

if [ ! -f "$ALL2HTML" ]; then
  echo "ERROR: dist/all2html.js not found. Run: pnpm build:illustrator"
  exit 1
fi

PASS=0
FAIL=0

while IFS= read -r AI_FILE; do
  BASENAME=$(basename "$AI_FILE" .ai)
  echo "=== Testing: $BASENAME ==="

  # Clean previous output
  rm -rf "$ROOT/data/ai2html-output"

  # Open file in Illustrator
  osascript -e "tell application \"Adobe Illustrator\" to open (POSIX file \"$AI_FILE\") as alias" 2>/dev/null

  # Wait and dismiss missing fonts dialog if present
  sleep 2
  osascript -e '
    tell application "System Events"
      tell process "Adobe Illustrator"
        if exists (window "Missing Fonts") then
          click button "Close" of window "Missing Fonts"
        end if
      end tell
    end tell
  ' 2>/dev/null || true

  sleep 1

  # Run all2html in automated mode (returns JSON, no dialogs)
  # Use 120 second timeout for large/complex files
  RESULT=$(osascript -e "
    with timeout of 120 seconds
      tell application \"Adobe Illustrator\"
        do javascript \"$.global.ALL2HTML_AUTOMATED = true;\" & return & (read (POSIX file \"$ALL2HTML\"))
      end tell
    end timeout
  " 2>&1) || true
  echo "  Result: $(echo $RESULT | head -c 200)"

  # Validate output
  if [ -f "$ROOT/data/ai2html-output/ir.json" ]; then
    VALIDATE=$(cd "$ROOT" && pnpm exec tsx src/cli/index.ts validate data/ai2html-output/ir.json 2>&1) || true
    if echo "$VALIDATE" | grep -q "Valid"; then
      echo "  ✓ IR valid"
    else
      echo "  ✗ IR invalid: $VALIDATE"
      FAIL=$((FAIL + 1))
      continue
    fi
  else
    echo "  ✗ No ir.json produced"
    FAIL=$((FAIL + 1))
    continue
  fi

  # Check HTML exists
  HTML_COUNT=$(ls "$ROOT/data/ai2html-output/"*.html 2>/dev/null | wc -l | tr -d ' ')
  if [ "$HTML_COUNT" -gt 0 ]; then
    echo "  ✓ HTML file(s) generated ($HTML_COUNT)"
  else
    echo "  ✗ No HTML files"
    FAIL=$((FAIL + 1))
    continue
  fi

  # Check images exist
  IMG_COUNT=$(ls "$ROOT/data/ai2html-output/"*.png "$ROOT/data/ai2html-output/"*.jpg 2>/dev/null | wc -l | tr -d ' ')
  echo "  ✓ Images: $IMG_COUNT"

  # Save output for this file
  mkdir -p "$ROOT/data/all2html-output/$BASENAME"
  cp -r "$ROOT/data/ai2html-output/"* "$ROOT/data/all2html-output/$BASENAME/" 2>/dev/null || true

  PASS=$((PASS + 1))

  # Close document
  osascript -e 'tell application "Adobe Illustrator" to close current document saving no' 2>/dev/null || true
  sleep 1
done < <(find "$ROOT"/data -type f -name '*.ai' | sort)

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
