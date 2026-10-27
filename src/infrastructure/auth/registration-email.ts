import "server-only";
import { Resolver } from "node:dns/promises";
import blocklist from "@/config/disposable-email-domains.json";
import { registrationDomainRisk } from "@/core/domain/identity/registration-email";

const disposableDomains = new Set(blocklist.domains);
export const storedEmailRisk = (email: string) => registrationDomainRisk(email, disposableDomains);
type EmailIssue = ReturnType<typeof storedEmailRisk> | "undeliverable" | "unavailable";
const missing = (error: unknown) => ["ENODATA", "ENOTFOUND", "ENONAME"].includes((error as { code?: string })?.code ?? "");

/** Only registration is gated; existing owners retain login and recovery. */
export async function registrationEmailIssue(email: string): Promise<EmailIssue> {
  const risk = storedEmailRisk(email);
  if (risk) return risk;
  const domain = email.split("@").at(-1)!;
  const resolver = new Resolver({ timeout: 1500, tries: 1 });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = async (): Promise<EmailIssue> => {
    try {
      const mx = await resolver.resolveMx(domain);
      if (mx.length > 0) return mx.some(record => record.exchange && record.exchange !== ".") ? null : "undeliverable";
    } catch (error) {
      if (!missing(error)) return "unavailable";
      if ((error as { code: string }).code !== "ENODATA") return "undeliverable";
    }
    // SMTP permits an implicit MX when a domain has only A/AAAA records.
    const addresses = await Promise.allSettled([resolver.resolve4(domain), resolver.resolve6(domain)]);
    if (addresses.some(result => result.status === "fulfilled" && result.value.length > 0)) return null;
    return addresses.some(result => result.status === "rejected" && !missing(result.reason)) ? "unavailable" : "undeliverable";
  };
  try {
    return await Promise.race([check(), new Promise<EmailIssue>(resolve => {
      timer = setTimeout(() => resolve("unavailable"), 4000);
    })]);
  } finally {
    clearTimeout(timer);
    resolver.cancel();
  }
}
