export type RegistrationDomainRisk = "reserved" | "disposable" | null;

/** Check whole DNS labels; an unfamiliar business domain is not itself risky. */
export function registrationDomainRisk(email: string, disposableDomains: ReadonlySet<string>): RegistrationDomainRisk {
  const domain = email.trim().toLowerCase().split("@").at(-1) ?? "";
  const labels = domain.split(".");
  if (["invalid", "test", "example", "localhost", "local", "onion"].includes(labels.at(-1) ?? "")) return "reserved";
  for (let index = 0; index < labels.length - 1; index++) {
    const parent = labels.slice(index).join(".");
    if (["example.com", "example.net", "example.org"].includes(parent)) return "reserved";
    if (disposableDomains.has(parent)) return "disposable";
  }
  return null;
}
