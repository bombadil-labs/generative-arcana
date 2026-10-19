import { useEffect, useState } from "react";

/**
 * Minimal hash router. Hash routing is deliberate: it makes the SPA work on GitHub Pages with
 * zero server config, and (relevant to the coming reading system) the #fragment is never sent to
 * any server — so a reading encoded in the URL stays entirely client-side.
 */
export function currentRoute(): string {
  if (typeof window === "undefined") return "/";
  return window.location.hash.replace(/^#/, "") || (/^\/parlor\/?$/.test(window.location.pathname) ? "/parlor" : "/");
}

export function navigate(to: string) {
  if (to === "/parlor" || /^\/parlor\/?$/.test(window.location.pathname)) {
    window.history.pushState(null, "", to === "/parlor" ? "/parlor" : `/#${to.startsWith("/") ? to : `/${to}`}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    return;
  }
  window.location.hash = to.startsWith("/") ? to : `/${to}`;
}

export function useHashRoute(): string {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    return () => { window.removeEventListener("hashchange", onChange); window.removeEventListener("popstate", onChange); };
  }, []);
  return route;
}
