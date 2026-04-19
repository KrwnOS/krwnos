import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { HomeClient } from "./home-client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Если ещё ни одного State нет — сразу ведём на визард коронации,
  // чтобы пользователь не упирался в кнопки-заглушки на лендинге.
  const count = await prisma.state.count();
  if (count === 0) {
    redirect("/setup");
  }

  return <HomeClient />;
}
