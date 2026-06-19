// The public "Plan your race" CTA, auth-aware: signed-in runners go to their
// plans; signed-out runners go to sign-in. Shared by the landing and About pages
// so the destination/label stay in one place.
export function planCta(isLoggedIn: boolean): { href: string; label: string } {
  return isLoggedIn
    ? { href: "/dashboard", label: "Go to your plans" }
    : { href: "/auth/signin", label: "Plan your race" };
}
