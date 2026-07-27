import { mount } from "svelte";
import AeApp from "../ae-main/AeApp.svelte";
import { getHostApplicationId, initBolt } from "../lib/utils/bolt";
import App from "./App.svelte";

function loadScript(src: string): Promise<void> {
  if (typeof (globalThis as { CSInterface?: unknown }).CSInterface === "function") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), {
      once: true,
    });
    document.head.appendChild(script);
  });
}

async function bootstrap(): Promise<void> {
  await loadScript("../CSInterface.js");
  initBolt();
  const hostId = getHostApplicationId();
  const Root = hostId === "AEFT" ? AeApp : App;
  mount(Root, { target: document.getElementById("app")! });
}

void bootstrap();
