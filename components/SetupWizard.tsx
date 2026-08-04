"use client";

import { useEffect, useState } from "react";
import {
  ALL_LANGS,
  LANG_NAMES,
  type Lang,
  type MeetingProfile,
} from "@/lib/types";
import { GEMINI } from "@/lib/constants";
import { usd } from "@/lib/format";
import {
  DEFAULT_PROFILE,
  normalizeModes,
  requiredPairs,
  validateProfile,
} from "@/lib/profile";
import {
  loadApiKey,
  loadCap,
  loadProfile,
  loadTier,
  saveApiKey,
  saveCap,
  saveTier,
} from "@/lib/storage";
import {
  pairAvailability,
  getTranslator,
  translatorSupported,
} from "@/lib/speech/translator";
import { webSpeechSupported } from "@/lib/speech/free-provider";
import { useT, type StringKey } from "@/lib/ui-prefs";

/**
 * Мастер первого запуска и предполётная проверка (§12).
 *
 * Приложением пользуется человек, который его не писал, поэтому это
 * ОСНОВНОЙ способ настройки, а не удобство. Проверки строятся ИЗ ПРОФИЛЯ:
 * неприменимые пункты не показываются вовсе — пользователь не должен
 * гадать, почему у него красный крест на том, чем он не пользуется.
 *
 * Ни одна строка здесь не написана в разметке: всё через словарь, иначе
 * португальский интерфейс останется наполовину английским.
 */

/** Лимиты сильно отличаются по тарифам, и от них зависит, с какой частотой
 *  вообще можно слать. Спрашиваем прямо, а не угадываем. */
export const KEY_TIERS: {
  id: string;
  label: StringKey;
  hint: StringKey;
  rpm: number;
  rpd: number;
}[] = [
  { id: "free", label: "tierFree", hint: "tierFreeHint", rpm: 10, rpd: 250 },
  {
    id: "paid",
    label: "tierPaid",
    hint: "tierPaidHint",
    rpm: 150,
    rpd: 100_000,
  },
];

export function SetupWizard({
  onDone,
}: {
  onDone: (p: MeetingProfile) => void;
}) {
  const t = useT();
  const [profile, setProfileRaw] = useState<MeetingProfile>(
    () => loadProfile() ?? DEFAULT_PROFILE,
  );
  // Любая правка проходит через нормализацию: убрать язык, на который
  // приколот канал, значит оставить профиль, с которым нельзя стартовать.
  const setProfile = (p: MeetingProfile) => setProfileRaw(normalizeModes(p));
  const [apiKey, setApiKey] = useState("");
  const [tier, setTier] = useState("free");
  const [cap, setCap] = useState(GEMINI.DEFAULT_CAP as number);
  const [packs, setPacks] = useState<Record<string, string>>({});

  useEffect(() => {
    setApiKey(loadApiKey());
    setTier(loadTier());
    setCap(loadCap());
  }, []);

  const problems = validateProfile(profile);
  const fatal = problems.filter((p) => p.fatal);
  const advice = problems.filter((p) => !p.fatal);
  const pairs = requiredPairs(profile);
  const usesPin =
    profile.presenterMode.kind === "pin" || profile.audienceMode.kind === "pin";

  const toggle = (list: Lang[], l: Lang): Lang[] =>
    list.includes(l) ? list.filter((x) => x !== l) : [...list, l];

  /** Пакеты качаем ПО ОДНОМУ и по клику: загрузка требует свежего жеста,
   *  иначе всё, кроме первой пары, падает с NotAllowedError (§15). */
  const downloadPack = async (from: Lang, to: Lang) => {
    const key = `${from}>${to}`;
    setPacks((p) => ({ ...p, [key]: "downloading" }));
    try {
      await getTranslator(from, to);
      setPacks((p) => ({ ...p, [key]: "available" }));
    } catch (e) {
      setPacks((p) => ({ ...p, [key]: e instanceof Error ? e.name : "error" }));
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const { from, to } of pairs)
        next[`${from}>${to}`] = await pairAvailability(from, to);
      if (!cancelled) setPacks((prev) => ({ ...next, ...prev }));
    })();
    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(pairs)]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="mx-auto max-w-3xl overflow-y-auto p-6">
      <h1 className="text-lg font-semibold">{t("setupTitle")}</h1>
      <p className="mt-1 text-sm text-dim">{t("setupLead")}</p>

      <Section title={t("languages")}>
        <Field label={t("iSpeak")}>
          <LangPicker
            selected={profile.presenterLangs}
            onToggle={(l) =>
              setProfile({
                ...profile,
                presenterLangs: toggle(profile.presenterLangs, l),
              })
            }
          />
        </Field>
        <Field label={t("audienceSpeaks")}>
          <LangPicker
            selected={profile.audienceLangs}
            onToggle={(l) =>
              setProfile({
                ...profile,
                audienceLangs: toggle(profile.audienceLangs, l),
              })
            }
          />
        </Field>
      </Section>


      <Section title={t("apiKeyTitle")}>
        <p className="mb-2 text-xs text-dim">{t("apiKeyLead")}</p>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            saveApiKey(e.target.value.trim());
          }}
          placeholder="AIza…"
          className="field"
        />

        {/* Первым упирается минутный лимит, а не суточный. Без верного
              значения провайдер шлёт быстрее, чем ключ разрешает. */}
        <div className="mt-3">
          <div className="mb-1.5 text-xs text-dim">{t("keyKind")}</div>
          <div className="flex gap-2">
            {KEY_TIERS.map((k) => (
              <button
                key={k.id}
                onClick={() => {
                  setTier(k.id);
                  saveTier(k.id);
                }}
                className={`flex-1 rounded border px-2 py-1.5 text-left text-xs ${
                  tier === k.id ? "border-accent bg-accent/12" : "border-line"
                }`}
              >
                <div className="font-medium">{t(k.label)}</div>
                <div className="text-dim">{t(k.hint)}</div>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-dim">{t("quotaNote")}</p>

          {/* Жёсткий потолок. Уведомления Google приходят постфактум
                и ничего не останавливают. */}
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-dim">{t("capLabel")}</span>
            <input
              type="number"
              min={10}
              max={100000}
              value={cap}
              onChange={(e) => {
                const v = Math.max(10, Number(e.target.value) || 10);
                setCap(v);
                saveCap(v);
              }}
              className="field w-24"
            />
            <span className="text-xs text-dim">
              {t("capSuffix")} {usd(cap * GEMINI.ESTIMATED_USD_PER_REQUEST)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-dim">{t("capNote")}</p>
        </div>
      </Section>

      <Section title={t("preflight")}>
        <Check
          ok={fatal.length === 0}
          label={t("checkProfile")}
          detail={fatal.map((f) => t(f.key)).join(" ")}
        />
        {usesPin ? (
          <>
            <Check
              ok={webSpeechSupported()}
              label={t("checkWebSpeech")}
              detail={t("checkWebSpeechHint")}
            />
            <Check
              ok={translatorSupported()}
              label={t("checkTranslator")}
              detail={t("checkTranslatorHint")}
            />
            <div className="mt-2 space-y-1">
              {pairs.map(({ from, to }) => {
                const key = `${from}>${to}`;
                const ready = packs[key] === "available";
                return (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    <span className={ready ? "text-ok" : "text-warn"}>
                      {ready ? "✓" : "•"}
                    </span>
                    <span className="font-mono">
                      {from} → {to}
                    </span>
                    <span className="text-dim">{packs[key] ?? "…"}</span>
                    {!ready ? (
                      <button
                        onClick={() => void downloadPack(from, to)}
                        className="btn btn-sm"
                      >
                        {t("download")}
                      </button>
                    ) : null}
                  </div>
                );
              })}
              <p className="pt-1 text-[11px] text-dim">{t("packOneAtATime")}</p>
            </div>
          </>
        ) : null}
        <Check ok={apiKey.length > 10} label={t("checkKey")} />
        <Check ok label={t("checkShare")} detail={t("checkShareHint")} />
      </Section>

      {advice.length ? (
        <Section title={t("worthKnowing")}>
          {advice.map((a, i) => (
            <p key={i} className="hint mb-2">
              {t(a.key)}
            </p>
          ))}
        </Section>
      ) : null}

      <div className="sticky bottom-0 mt-6 flex gap-2 bg-ink py-3">
        <button
          onClick={() => onDone(profile)}
          disabled={fatal.length > 0}
          className="btn btn-primary px-4 py-2"
        >
          {t("start")}
        </button>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="surface mt-6 p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs text-dim">{label}</div>
      {children}
    </div>
  );
}

function LangPicker({
  selected,
  onToggle,
}: {
  selected: Lang[];
  onToggle: (l: Lang) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_LANGS.map((l) => (
        <button
          key={l}
          onClick={() => onToggle(l)}
          className={`chip ${selected.includes(l) ? "chip-on" : ""}`}
        >
          {LANG_NAMES[l]}
        </button>
      ))}
    </div>
  );
}

function Check({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail?: string;
}) {
  return (
    <div className="mb-1.5 flex items-start gap-2 text-xs">
      <span className={ok ? "text-ok" : "text-err"}>{ok ? "✓" : "✕"}</span>
      <span>
        {label}
        {detail ? <span className="block text-dim">{detail}</span> : null}
      </span>
    </div>
  );
}
