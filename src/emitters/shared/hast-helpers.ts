import type { Element, Root, RootContent } from "hast";
import { h } from "hastscript";

export type { Element as HastElement, Root, RootContent };
export { h };

export function raw(value: string): RootContent {
  return { type: "raw", value } as unknown as RootContent;
}

export function commentNode(value: string): RootContent {
  return { type: "comment", value: ` ${value} ` } as RootContent;
}

export function textNode(value: string): RootContent {
  return { type: "text", value } as RootContent;
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
