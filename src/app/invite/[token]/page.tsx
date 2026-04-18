import { notFound } from "next/navigation";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";

interface PageProps {
  params: { token: string };
}

export default async function InvitePage({ params }: PageProps) {
  const hash = createHash("sha256").update(params.token).digest("hex");

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hash },
    include: {
      state: { select: { name: true, slug: true } },
    },
  });

  if (!invitation) notFound();

  const expired =
    invitation.expiresAt != null && invitation.expiresAt.getTime() < Date.now();
  const exhausted = invitation.usesCount >= invitation.maxUses;
  const invalid =
    invitation.status !== "active" || expired || exhausted;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-crown text-xl font-bold text-black">
        K
      </div>

      <Card className="w-full">
        <CardTitle>Приглашение в «{invitation.state.name}»</CardTitle>
        <CardDescription>
          Код: <span className="font-mono text-crown">{invitation.code}</span>
          {invitation.label ? (
            <>
              {" · "}
              <span className="text-foreground/80">{invitation.label}</span>
            </>
          ) : null}
        </CardDescription>

        <div className="mt-6 space-y-3 text-sm text-foreground/70">
          <div className="flex justify-between">
            <span>Uses</span>
            <span className="font-mono">
              {invitation.usesCount} / {invitation.maxUses}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Expires</span>
            <span className="font-mono">
              {invitation.expiresAt
                ? invitation.expiresAt.toISOString()
                : "never"}
            </span>
          </div>
        </div>

        <div className="mt-8">
          {invalid ? (
            <Button disabled variant="outline" className="w-full">
              {expired
                ? "Приглашение истекло"
                : exhausted
                  ? "Приглашение исчерпано"
                  : "Приглашение недоступно"}
            </Button>
          ) : (
            <form action={`/api/invite/${params.token}/accept`} method="POST">
              <Button type="submit" variant="crown" className="w-full" size="lg">
                Принять приглашение
              </Button>
              <p className="mt-3 text-center text-xs text-foreground/50">
                Подтверждение потребует Passkey или кошелёк.
              </p>
            </form>
          )}
        </div>
      </Card>
    </main>
  );
}
