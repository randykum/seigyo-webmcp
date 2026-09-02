import { z } from "zod";
import { parseToolInput } from "@seigyo/contracts";
import { CART_ID, shopApi } from "./api";

type Tool = { name: string; description: string; inputSchema?: Record<string, unknown>; annotations?: Record<string, boolean>; execute: (input: unknown) => Promise<unknown> };
type ModelContext = { registerTool(tool: Tool, options?: { signal?: AbortSignal }): void };
declare global { interface Document { modelContext?: ModelContext } }
const result = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });

export function registerMyShopTools(): () => void {
  const context = document.modelContext;
  if (!context) return () => undefined;
  const controller = new AbortController();
  const tools: Tool[] = [
    { name: "myshop.search_products", description: "Search MyShop products by text and optional category.", inputSchema: { type: "object", properties: { query: { type: "string", maxLength: 100 }, category: { type: "string" } }, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: async input => { const value = parseToolInput(input, z.object({ query: z.string().max(100).default(""), category: z.string().default("") })); return result(await shopApi.products(value.query, value.category)); } },
    { name: "myshop.get_product", description: "Read one product, including price, material, dimensions, and current availability.", inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"], additionalProperties: false }, annotations: { readOnlyHint: true }, execute: async input => { const value = parseToolInput(input, z.object({ slug: z.string() })); return result(await shopApi.product(value.slug)); } },
    { name: "myshop.get_cart", description: "Read the current customer cart.", inputSchema: { type: "object", properties: { cartId: { type: "string" } }, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: async input => { const value = parseToolInput(input, z.object({ cartId: z.string().default(CART_ID) })); return result(await shopApi.cart(value.cartId)); } },
    { name: "myshop.add_to_cart", description: "Set the desired quantity for a product in the customer cart.", inputSchema: { type: "object", properties: { productId: { type: "string" }, quantity: { type: "integer", minimum: 1, maximum: 10 }, cartId: { type: "string" } }, required: ["productId", "quantity"], additionalProperties: false }, execute: async input => { const value = parseToolInput(input, z.object({ productId: z.string(), quantity: z.number().int().min(1).max(10), cartId: z.string().default(CART_ID) })); return result(await shopApi.updateCart(value.cartId, value.productId, value.quantity)); } },
    { name: "myshop.update_cart", description: "Update an item quantity. Set quantity to zero to remove the item.", inputSchema: { type: "object", properties: { productId: { type: "string" }, quantity: { type: "integer", minimum: 0, maximum: 10 }, cartId: { type: "string" } }, required: ["productId", "quantity"], additionalProperties: false }, execute: async input => { const value = parseToolInput(input, z.object({ productId: z.string(), quantity: z.number().int().min(0).max(10), cartId: z.string().default(CART_ID) })); return result(await shopApi.updateCart(value.cartId, value.productId, value.quantity)); } },
    { name: "myshop.checkout", description: "Complete checkout using the current cart and the customer's delivery details.", inputSchema: { type: "object", properties: { email: { type: "string" }, name: { type: "string" }, address: { type: "string" }, cartId: { type: "string" }, requestId: { type: "string" }, idempotencyKey: { type: "string" } }, required: ["email", "name", "address", "requestId", "idempotencyKey"], additionalProperties: false }, execute: async input => { const value = parseToolInput(input, z.object({ email: z.string().email(), name: z.string().min(2), address: z.string().min(8), cartId: z.string().default(CART_ID), requestId: z.string().min(8), idempotencyKey: z.string().min(8) })); return result(await shopApi.checkout(value)); } },
    { name: "myshop.get_order", description: "Look up one order by order ID.", inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"], additionalProperties: false }, annotations: { readOnlyHint: true }, execute: async input => { const value = parseToolInput(input, z.object({ orderId: z.string() })); return result(await shopApi.order(value.orderId)); } },
    { name: "myshop.get_health", description: "Read customer-safe storefront health and availability information.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: async () => result(await shopApi.health()) }
  ];
  for (const tool of tools) {
    const execute = tool.execute;
    context.registerTool({ ...tool, execute: async input => { try { return await execute(input); } catch (error) { return result({ ok: false, error: { code: error && typeof error === "object" && "code" in error ? String(error.code) : "INVALID_ARGUMENT", message: error instanceof Error ? error.message : "Tool request failed." } }); } } }, { signal: controller.signal });
  }
  return () => controller.abort();
}
