import {
  DEFAULT_SESSION_ID,
  SessionIdSchema,
  type ApiResult,
} from "@seigyo/contracts";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const SESSION_STORAGE_KEY = "myshop.environment-session-v2";
const CART_STORAGE_KEY = "myshop.cart-session-v2";

const validSession = (value: string | null | undefined): string | undefined => {
  const parsed = SessionIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};

const resolveSessionId = (): string => {
  const fromUrl = validSession(new URLSearchParams(location.search).get("session"));
  let stored: string | undefined;
  try {
    stored = validSession(sessionStorage.getItem(SESSION_STORAGE_KEY));
  } catch {
    stored = undefined;
  }
  // Direct MyShop and Seigyo visits must observe the same production health.
  // A session query opts into an isolated environment and survives reloads.
  const resolved = fromUrl ?? stored ?? DEFAULT_SESSION_ID;
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, resolved);
  } catch {
    // A blocked session store does not prevent the current tab from working.
  }
  return resolved;
};

export const SESSION_ID = resolveSessionId();

const resolveCartId = (): string => {
  const linkedSession = validSession(
    new URLSearchParams(location.search).get("session"),
  );
  if (linkedSession) {
    const linkedCartId = `myshop-${linkedSession}`;
    try {
      sessionStorage.setItem(CART_STORAGE_KEY, linkedCartId);
    } catch {
      // The in-memory value remains valid for the lifetime of this page.
    }
    return linkedCartId;
  }
  try {
    const stored = sessionStorage.getItem(CART_STORAGE_KEY);
    if (stored && /^[a-zA-Z0-9_-]{1,80}$/.test(stored)) return stored;
  } catch {
    // A blocked session store does not prevent the current tab from working.
  }
  const cartId = `myshop-cart-${crypto.randomUUID().replaceAll("-", "")}`;
  try {
    sessionStorage.setItem(CART_STORAGE_KEY, cartId);
  } catch {
    // The in-memory value remains valid for the lifetime of this page.
  }
  return cartId;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", "X-Session-Id": SESSION_ID, ...init?.headers } });
  const result = await response.json() as ApiResult<T>;
  if (!result.ok) { const error = new Error(result.error.message); Object.assign(error, { code: result.error.code }); throw error; }
  return result.data;
}

export const shopApi = {
  products: <T>(query = "", category = "") => request<T>(`/api/store/products?q=${encodeURIComponent(query)}&category=${encodeURIComponent(category)}`),
  product: <T>(slug: string) => request<T>(`/api/store/products/${encodeURIComponent(slug)}`),
  cart: <T>(cartId: string) => request<T>(`/api/store/carts/${encodeURIComponent(cartId)}`),
  updateCart: <T>(cartId: string, productId: string, quantity: number) => request<T>(`/api/store/carts/${encodeURIComponent(cartId)}/items`, { method: "PUT", body: JSON.stringify({ productId, quantity }) }),
  checkout: <T>(input: { cartId: string; email: string; name: string; address: string; requestId: string; idempotencyKey: string }) => request<T>("/api/store/checkout", { method: "POST", body: JSON.stringify(input) }),
  order: <T>(id: string) => request<T>(`/api/store/orders/${encodeURIComponent(id)}`),
  health: <T>() => request<T>("/api/store/health")
};

export const CART_ID = resolveCartId();

export const shopWebsocketUrl = (): string => {
  if (API_BASE)
    return `${API_BASE.replace(/^http/, "ws")}/ws?session=${encodeURIComponent(SESSION_ID)}`;
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws?session=${encodeURIComponent(SESSION_ID)}`;
};
