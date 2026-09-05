import { useEffect, useState } from "react";

export type Stack = {
  rpc: "chainstack" | "forno";
  upstream: "cencori" | "static";
};

export function useStack(): Stack | null {
  const [stack, setStack] = useState<Stack | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stack")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: Stack | null) => {
        if (cancelled || !body) return;
        if (body.rpc !== "chainstack" && body.rpc !== "forno") return;
        if (body.upstream !== "cencori" && body.upstream !== "static") return;
        setStack({ rpc: body.rpc, upstream: body.upstream });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return stack;
}

export function rpcName(rpc: Stack["rpc"]): string {
  return rpc === "chainstack" ? "Chainstack" : "Forno";
}

export function quoteName(upstream: Stack["upstream"]): string {
  return upstream === "cencori" ? "Cencori" : "published mid";
}
