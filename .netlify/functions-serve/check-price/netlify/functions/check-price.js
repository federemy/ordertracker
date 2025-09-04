var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// netlify/functions/check-price.ts
var check_price_exports = {};
__export(check_price_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(check_price_exports);
var import_web_push = __toESM(require("web-push"), 1);
var SUBS_KEY = "subs.json";
var ORDERS_KEY = "orders.json";
var PREV_SIGNS_KEY = "prev-signs.json";
var FEE = 15e-4;
var BINANCE = (sym) => `https://api.binance.com/api/v3/ticker/price?symbol=${sym}USDT`;
function diffBruto(o, current) {
  const side = o.side ?? "SELL";
  return side === "SELL" ? (o.price - current) * o.qty : (current - o.price) * o.qty;
}
function feeCierreUSD(o, current) {
  return o.qty * current * FEE;
}
var handler = async (_evt, ctx) => {
  const blob = ctx?.blob || globalThis.netlify?.blobs;
  const subsR = await blob.get(SUBS_KEY);
  const subs = subsR ? JSON.parse(await subsR.text()) : [];
  if (!subs.length) return { statusCode: 200, body: "no subs" };
  const ordersR = await blob.get(ORDERS_KEY);
  const orders = ordersR ? JSON.parse(await ordersR.text()) : [];
  if (!orders.length) return { statusCode: 200, body: "no orders" };
  const prevR = await blob.get(PREV_SIGNS_KEY);
  let prev = prevR ? JSON.parse(await prevR.text()) : {};
  const syms = [...new Set(orders.map((o) => o.asset.toUpperCase()))];
  const prices = {};
  for (const s of syms) {
    try {
      const r = await fetch(BINANCE(s));
      const j = await r.json();
      prices[s] = Number(j.price);
    } catch {
    }
  }
  import_web_push.default.setVapidDetails(
    "mailto:you@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  let pushes = 0;
  for (const o of orders) {
    const current = prices[o.asset.toUpperCase()] || 0;
    if (!current) continue;
    const bruto = diffBruto(o, current);
    const neto = bruto - feeCierreUSD(o, current);
    const newSign = neto > 0 ? 1 : neto < 0 ? -1 : 0;
    const oldSign = prev[o.id] ?? 0;
    if (oldSign <= 0 && newSign > 0) {
      const title = `Ganancia en ${o.asset}`;
      const body = `Neto: ${neto >= 0 ? "+" : ""}${neto.toFixed(
        2
      )} USD (precio ${current.toFixed(2)})`;
      for (const s of subs) {
        try {
          await import_web_push.default.sendNotification(s, JSON.stringify({ title, body }));
          pushes++;
        } catch {
        }
      }
    }
    prev[o.id] = newSign;
  }
  await blob.set(PREV_SIGNS_KEY, JSON.stringify(prev), {
    contentType: "application/json"
  });
  return { statusCode: 200, body: `ok pushes=${pushes}` };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=check-price.js.map
