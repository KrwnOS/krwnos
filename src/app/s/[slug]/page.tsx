/**
 * `/s/[slug]` — вход в конкретное Государство.
 *
 * Сейчас инстанс single-tenant: одно State на приложение, главный
 * аутентифицированный экран — `/dashboard`. Поэтому задача роута
 * простая: подтвердить что slug действительно принадлежит этому
 * инстансу, и перебросить на дашборд. Чужой slug → честный 404.
 *
 * Когда/если будет multi-tenant, этот файл превратится в полноценный
 * per-state layout wrapper. Пока — тонкий гейт.
 */

import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface Params {
  params: { slug: string };
}

export default async function StateEntryPage({ params }: Params) {
  const slug = params.slug?.trim().toLowerCase();
  if (!slug) notFound();

  const state = await prisma.state.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!state) notFound();

  redirect("/dashboard");
}
