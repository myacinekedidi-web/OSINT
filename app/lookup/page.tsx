import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LookupWorkbench } from "@/components/lookup/lookup-workbench";
import { ModeToggle } from "@/components/toggleTheme";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Lookup",
  description:
    "Look up an IP address, domain, URL or email in public data sources and get one combined report. Nothing you enter is stored.",
};

export default function LookupPage() {
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-4">
      <header className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Lookup</h1>
          <p className="text-sm text-muted-foreground">
            Check an IP address, domain, URL or email against public data sources.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ArrowLeft aria-hidden="true" />
            Tool catalog
          </Link>
          <ModeToggle />
        </div>
      </header>
      <LookupWorkbench />
    </main>
  );
}
