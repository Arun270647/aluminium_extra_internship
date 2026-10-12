import { useEffect, type RefObject } from "react";

const SELECTOR = "[data-reveal]:not([data-reveal=\"in\"])";

export function useReveal(root: RefObject<HTMLElement | null>, dependency: unknown) {
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const targets = () => Array.from(container.querySelectorAll<HTMLElement>(SELECTOR));
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      targets().forEach(element => element.setAttribute("data-reveal", "in"));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.setAttribute("data-reveal", "in");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -60px 0px" });
    targets().forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [root, dependency]);
}
