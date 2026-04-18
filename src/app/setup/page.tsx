import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getServerT } from "@/lib/i18n/server";
import { SetupWizard } from "./wizard";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const count = await prisma.state.count();
  if (count > 0) {
    redirect("/");
  }

  const { t } = await getServerT();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 py-16">
      <div className="mb-8 flex h-16 w-16 items-center justify-center rounded-full bg-crown text-2xl font-bold text-black shadow-[0_0_40px_-10px_rgba(212,175,55,0.8)]">
        K
      </div>
      <h1 className="mb-2 text-center text-3xl font-semibold">
        {t("setup.title")}
      </h1>
      <p className="mb-10 text-center text-sm text-foreground/60">
        {t("setup.subtitle")}
      </p>
      <SetupWizard />
    </main>
  );
}
