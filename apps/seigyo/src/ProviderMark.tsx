import { siCloudflare, siRender, siStripe, siSupabase } from "simple-icons/icons";
import type { HostingMetadata } from "@seigyo/contracts";

const providerIcons = {
  cloudflare: siCloudflare,
  render: siRender,
  stripe: siStripe,
  supabase: siSupabase
} satisfies Record<HostingMetadata["providerId"], typeof siCloudflare>;

export function ProviderMark({ hosting, compact = false }: { hosting: HostingMetadata; compact?: boolean }) {
  const icon = providerIcons[hosting.providerId];
  return <span className={`provider-mark provider-${hosting.providerId}${compact ? " provider-compact" : ""}`}>
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={icon.path}/></svg>
    <span className="provider-copy"><strong>{hosting.providerName}</strong>{!compact && <small>{hosting.product}</small>}</span>
  </span>;
}
