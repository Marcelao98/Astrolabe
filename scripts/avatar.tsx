/** Renderiza a Astra (SVG) em PNG para conferir a arte sem navegador. */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AstraAvatar, type AstraMood } from "../apps/web/src/components/AstraAvatar";

mkdirSync(".shots", { recursive: true });
const moods: AstraMood[] = ["neutral", "happy", "search", "alert", "think"];
const size = 360;
const sheet = createCanvas(size * moods.length, size);
const ctx = sheet.getContext("2d");
ctx.fillStyle = "#0a0f2c";
ctx.fillRect(0, 0, sheet.width, sheet.height);
for (let k = 0; k < moods.length; k++) {
  const svg = renderToStaticMarkup(createElement(AstraAvatar, { mood: moods[k]!, size })).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
  const img = await loadImage(Buffer.from(svg));
  ctx.drawImage(img, k * size, 0, size, size);
}
writeFileSync(".shots/astra.png", sheet.toBuffer("image/png"));
console.log("ok");
