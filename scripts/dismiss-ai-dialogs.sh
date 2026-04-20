#!/bin/bash
# Background script that auto-dismisses Adobe Illustrator dialogs.
# Run alongside the test harness: bash scripts/dismiss-ai-dialogs.sh &
# Kill when done: kill %1

echo "Watching for Illustrator dialogs (Ctrl+C to stop)..."
while true; do
  osascript -e '
    tell application "System Events"
      tell process "Adobe Illustrator"
        -- Dismiss "Missing Fonts" dialog
        if exists (window "Missing Fonts") then
          click button "Close" of window "Missing Fonts"
        end if
        -- Dismiss generic error dialogs (click OK)
        repeat with w in windows
          try
            if exists (button "OK" of w) then
              set winName to name of w
              if winName is "Adobe Illustrator" then
                click button "OK" of w
              end if
            end if
          end try
        end repeat
      end tell
    end tell
  ' 2>/dev/null
  sleep 2
done
