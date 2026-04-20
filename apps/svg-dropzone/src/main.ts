/// <reference lib="dom" />

import { mountSvgDropzoneApp } from "./app.js";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("SVG dropzone root element was not found.");
}

mountSvgDropzoneApp(root);
