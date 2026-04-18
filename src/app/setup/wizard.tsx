"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SetupSuccess {
  stateId: string;
  stateSlug: string;
  sovereignNodeId: string;
  userId: string;
  cliToken: string;
  cliTokenId: string;
}

export function SetupWizard() {
  const [state, setState] = useState<"form" | "submitting" | "done">("form");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SetupSuccess | null>(null);
  const [rotated, setRotated] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setState("submitting");

    const formData = new FormData(e.currentTarget);
    const payload = {
      stateName: str(formData, "stateName"),
      stateSlug: str(formData, "stateSlug") || undefined,
      stateDescription: str(formData, "stateDescription") || undefined,
      ownerHandle: str(formData, "ownerHandle"),
      ownerDisplayName: str(formData, "ownerDisplayName") || undefined,
      ownerEmail: str(formData, "ownerEmail") || undefined,
    };

    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message ?? data?.error ?? "Setup failed");
      }
      setResult(data);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState("form");
    }
  }

  async function rotateBootstrap() {
    if (!result) return;
    setRotating(true);
    try {
      const res = await fetch("/api/cli/tokens/rotate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${result.cliToken}`,
        },
        body: JSON.stringify({
          label: "sovereign rotated (first-login)",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message ?? data?.error ?? "Rotation failed");
      }
      setRotated(data.token as string);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRotating(false);
    }
  }

  if (state === "done" && result) {
    const activeToken = rotated ?? result.cliToken;
    return (
      <Card className="w-full">
        <CardTitle>State создан</CardTitle>
        <CardDescription>
          <span className="font-mono text-foreground/80">
            /s/{result.stateSlug}
          </span>{" "}
          — ваше цифровое государство живо.
        </CardDescription>

        <div className="mt-6 space-y-3 text-sm">
          <Row label="stateId" value={result.stateId} />
          <Row label="sovereignNodeId" value={result.sovereignNodeId} />
          <Row label="userId" value={result.userId} />
        </div>

        <div className="mt-8 rounded-md border border-crown/40 bg-crown/5 p-4">
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-crown">
            <span>
              {rotated ? "Rotated CLI token" : "Bootstrap CLI token"}
            </span>
            <span className="text-foreground/40">shown once</span>
          </div>
          <code className="block break-all font-mono text-sm text-foreground">
            {activeToken}
          </code>
          <div className="mt-3 text-xs text-foreground/60">
            <code className="rounded bg-foreground/5 px-1 py-0.5">
              krwn login --host {typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"} --token {activeToken.slice(0, 12)}…
            </code>
          </div>
        </div>

        {!rotated ? (
          <div className="mt-6 flex flex-col gap-2">
            <p className="text-xs text-foreground/60">
              Рекомендуется сразу заменить bootstrap-токен — старый
              будет немедленно отозван.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={rotateBootstrap}
              disabled={rotating}
            >
              {rotating ? "Ротация…" : "Заменить bootstrap-токен"}
            </Button>
          </div>
        ) : (
          <p className="mt-6 text-xs text-green-500">
            ✓ Прежний bootstrap-токен отозван. Сохраните новый — повторно
            он не появится.
          </p>
        )}

        <div className="mt-8 flex flex-col gap-2">
          <a href={`/s/${result.stateSlug}`}>
            <Button variant="crown" size="lg" className="w-full">
              Войти в государство
            </Button>
          </a>
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-400">{error}</p>
        )}
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <Field
          label="Название государства"
          name="stateName"
          placeholder="Crown Republic"
          required
          minLength={2}
          maxLength={80}
        />
        <Field
          label="URL-slug"
          name="stateSlug"
          placeholder="crown-republic"
          hint="Оставьте пустым — сгенерируем из названия."
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
        />
        <Field
          label="Краткое описание"
          name="stateDescription"
          placeholder="Государство сообщества разработчиков…"
          maxLength={500}
        />

        <div className="my-1 h-px bg-border/60" />

        <Field
          label="Ваш @handle"
          name="ownerHandle"
          placeholder="sovereign"
          required
          minLength={3}
          maxLength={32}
          pattern="[a-z0-9_]{3,32}"
        />
        <Field
          label="Отображаемое имя"
          name="ownerDisplayName"
          placeholder="Red Master"
          maxLength={80}
        />
        <Field
          label="Email"
          name="ownerEmail"
          type="email"
          placeholder="red@example.com"
          hint="Опционально. Passkey/кошелёк можно подключить позже."
        />

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}

        <Button
          type="submit"
          variant="crown"
          size="lg"
          disabled={state === "submitting"}
        >
          {state === "submitting" ? "Коронуем…" : "Короновать Суверена"}
        </Button>
      </form>
    </Card>
  );
}

function Field(props: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs uppercase tracking-widest text-foreground/60">
        {props.label}
        {props.required ? <span className="text-crown"> *</span> : null}
      </span>
      <input
        name={props.name}
        type={props.type ?? "text"}
        placeholder={props.placeholder}
        required={props.required}
        minLength={props.minLength}
        maxLength={props.maxLength}
        pattern={props.pattern}
        className={cn(
          "h-11 rounded-md border border-border bg-background/50 px-3 text-sm",
          "focus:border-crown focus:outline-none focus:ring-2 focus:ring-crown/30",
        )}
      />
      {props.hint ? (
        <span className="text-xs text-foreground/50">{props.hint}</span>
      ) : null}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md bg-foreground/5 px-3 py-2">
      <span className="text-xs uppercase tracking-widest text-foreground/50">
        {label}
      </span>
      <code className="break-all font-mono text-xs text-foreground/80">
        {value}
      </code>
    </div>
  );
}

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
