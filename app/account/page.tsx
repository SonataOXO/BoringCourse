import { getSessionFromCookie } from "@/lib/server/auth";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

export default async function AccountPage() {
  const session = await getSessionFromCookie();

  return (
    <main className="grainy-bg min-h-screen px-6 py-10 md:px-10">
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardTitle>Account</CardTitle>
          <CardDescription>Your profile and account preferences will live here.</CardDescription>
          <div className="mt-4 rounded-2xl bg-muted p-4 text-sm">
            <p className="text-muted-foreground">Signed in email</p>
            <p className="font-semibold">{session?.email ?? "Unknown"}</p>
          </div>
        </Card>
      </div>
    </main>
  );
}
