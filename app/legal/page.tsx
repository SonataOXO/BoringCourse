import Link from "next/link";

import { Card, CardDescription, CardTitle } from "@/components/ui/card";

export default function LegalHubPage() {
  return (
    <main className="grainy-bg min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-3xl space-y-5">
        <Card>
          <CardTitle>Legal Hub</CardTitle>
          <CardDescription>
            This page is the central index for legal and policy content. You can expand each page later with full legal text.
          </CardDescription>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link className="underline" href="/legal/terms-of-service">Terms of Service</Link></li>
            <li><Link className="underline" href="/legal/legal-terms">Legal Terms</Link></li>
            <li><Link className="underline" href="/legal/privacy-policy">Privacy Policy</Link></li>
          </ul>
        </Card>
      </div>
    </main>
  );
}
