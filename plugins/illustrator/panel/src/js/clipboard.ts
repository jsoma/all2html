function copyWithTextarea(text: string): boolean {
  if (
    !globalThis.document ||
    !document.body ||
    typeof document.createElement !== "function" ||
    typeof document.execCommand !== "function"
  ) {
    return false;
  }

  const activeElement = document.activeElement as { focus?: () => void } | null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
    activeElement?.focus?.();
  }
}

export async function copyText(text: string): Promise<boolean> {
  if (copyWithTextarea(text)) {
    return true;
  }

  try {
    const writeText = globalThis.navigator?.clipboard?.writeText;
    if (typeof writeText !== "function") {
      return false;
    }
    await writeText.call(globalThis.navigator.clipboard, text);
    return true;
  } catch {
    return false;
  }
}
