import type { HostingMetadata } from "@seigyo/contracts";

type HostingProductKind = "edge" | "service" | "payments" | "database" | "worker";

const productKinds: Array<[RegExp, HostingProductKind]> = [
  [/workers|edge/i, "edge"],
  [/postgres|database|sql/i, "database"],
  [/payments?|payment intent/i, "payments"],
  [/background worker|worker/i, "worker"],
];

export function getHostingProductKind(product: string): HostingProductKind {
  return productKinds.find(([pattern]) => pattern.test(product))?.[1] ?? "service";
}

function ProductGlyph({ kind }: { kind: HostingProductKind }) {
  switch (kind) {
    case "edge":
      return (
        <>
          <path d="M12 2.5a2.25 2.25 0 1 1-1.59 3.84l-3.1 3.1a2.25 2.25 0 1 1-1.5-1.5l3.1-3.1A2.25 2.25 0 0 1 12 2.5Z" />
          <path d="M12 17.66a2.25 2.25 0 1 1-1.59 3.84 2.25 2.25 0 0 1 0-3.18l-3.1-3.1a2.25 2.25 0 1 1 1.5-1.5l3.1 3.1c.03.03.06.06.09.09Z" />
          <path d="M15.5 9.44a2.25 2.25 0 1 1 3.18 3.18 2.25 2.25 0 0 1-3.18 0l-3.1-3.1a2.25 2.25 0 1 1 1.5-1.5l1.6 1.6Z" />
        </>
      );
    case "database":
      return (
        <>
          <path d="M4 5.25C4 3.73 7.58 2.5 12 2.5s8 1.23 8 2.75v3c0 1.52-3.58 2.75-8 2.75s-8-1.23-8-2.75v-3Z" />
          <path d="M4 9.25c0 1.52 3.58 2.75 8 2.75s8-1.23 8-2.75v4c0 1.52-3.58 2.75-8 2.75s-8-1.23-8-2.75v-4Z" />
          <path d="M4 14.25c0 1.52 3.58 2.75 8 2.75s8-1.23 8-2.75v3c0 1.52-3.58 2.75-8 2.75s-8-1.23-8-2.75v-3Z" />
        </>
      );
    case "payments":
      return (
        <>
          <path d="M3.5 4.5h17v15h-17v-15Zm2 3v2h13v-2h-13Zm0 6.5v2h5v-2h-5Z" />
          <path d="M6.5 5.75h3v1.5h-3v-1.5Z" />
        </>
      );
    case "worker":
      return (
        <>
          <path d="M8.4 3.25h7.2v3.1H8.4v-3.1Zm-4.9 5.2h17v3.1h-17v-3.1Zm2.45 5.2h12.1v3.1H5.95v-3.1Zm3.2 5.2h5.7v2h-5.7v-2Z" />
          <path d="M11.25 1.5h1.5v20h-1.5v-20Z" />
        </>
      );
    case "service":
      return (
        <>
          <path d="M4 3.5h16v5H4v-5Zm0 6h16v5H4v-5Zm0 6h16v5H4v-5Z" />
          <path d="M6.5 5h1.5v2H6.5V5Zm0 6h1.5v2H6.5v-2Zm0 6h1.5v2H6.5v-2Z" />
        </>
      );
  }
}

export function ProviderMark({ hosting, compact = false }: { hosting: HostingMetadata; compact?: boolean }) {
  const kind = getHostingProductKind(hosting.product);
  return (
    <span className={`provider-mark${compact ? " provider-compact" : ""}`}>
      <svg
        className={`provider-glyph provider-glyph-${kind}`}
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <ProductGlyph kind={kind} />
      </svg>
      <span className="provider-copy">
        <strong>{hosting.providerName}</strong>
        {!compact && <small>{hosting.product}</small>}
      </span>
    </span>
  );
}
