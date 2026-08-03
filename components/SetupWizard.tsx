'use client';

import { useEffect, useState } from 'react';
import { ALL_LANGS, LANG_NAMES, type Lang, type MeetingProfile } from '@/lib/types';
import { PRESETS, needsApiKey, requiredPairs, validateProfile } from '@/lib/profile';
import { loadApiKey, loadProfile, saveApiKey } from '@/lib/storage';
import { pairAvailability, getTranslator, translatorSupported } from '@/lib/speech/translator';
import { webSpeechSupported } from '@/lib/speech/free-provider';

/**
 * Мастер первого запуска и предполётная проверка (§12).
 *
 * Приложением пользуется человек, который его не писал, поэтому это
 * ОСНОВНОЙ способ настройки, а не удобство. Проверки строятся ИЗ ПРОФИЛЯ:
 * неприменимые пункты не показываются вовсе — пользователь не должен
 * гадать, почему у него красный крест на том, чем он не пользуется.
 */
export function SetupWizard({ onDone }: { onDone: (p: MeetingProfile) => void }) {
  const [profile, setProfile] = useState<MeetingProfile>(() => loadProfile() ?? PRESETS[0].profile);
  const [apiKey, setApiKey] = useState('');
  const [packs, setPacks] = useState<Record<string, string>>({});

  useEffect(() => setApiKey(loadApiKey()), []);

  const problems = validateProfile(profile);
  const fatal = problems.filter((p) => p.fatal);
  const advice = problems.filter((p) => !p.fatal);
  const pairs = requiredPairs(profile);
  const keyNeeded = needsApiKey(profile);
  const usesPin = profile.presenterMode.kind === 'pin' || profile.audienceMode.kind === 'pin';

  const toggle = (list: Lang[], l: Lang): Lang[] =>
    list.includes(l) ? list.filter((x) => x !== l) : [...list, l];

  /** Пакеты качаем ПО ОДНОМУ и по клику: загрузка требует свежего жеста,
   *  иначе всё, кроме первой пары, падает с NotAllowedError (§15). */
  const downloadPack = async (from: Lang, to: Lang) => {
    const key = `${from}>${to}`;
    setPacks((p) => ({ ...p, [key]: 'downloading' }));
    try {
      await getTranslator(from, to);
      setPacks((p) => ({ ...p, [key]: 'available' }));
    } catch (e) {
      setPacks((p) => ({ ...p, [key]: e instanceof Error ? e.name : 'error' }));
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const { from, to } of pairs) next[`${from}>${to}`] = await pairAvailability(from, to);
      if (!cancelled) setPacks((prev) => ({ ...next, ...prev }));
    })();
    return () => {
      cancelled = true;
    };
  }, [JSON.stringify(pairs)]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="mx-auto max-w-3xl overflow-y-auto p-6">
      <h1 className="text-lg font-semibold">Set up this meeting</h1>
      <p className="mt-1 text-sm text-dim">
        Everything below is stored on this machine only. Nothing is sent anywhere until you start a session.
      </p>

      <Section title="Start from a preset">
        <div className="grid gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setProfile(p.profile)}
              className="rounded-lg border border-line px-3 py-2 text-left hover:border-accent"
            >
              <div className="text-sm font-medium">{p.label}</div>
              <div className="text-xs text-dim">{p.hint}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Languages">
        <Field label="I speak">
          <LangPicker
            selected={profile.presenterLangs}
            onToggle={(l) => setProfile({ ...profile, presenterLangs: toggle(profile.presenterLangs, l) })}
          />
        </Field>
        <Field label="The audience speaks">
          <LangPicker
            selected={profile.audienceLangs}
            onToggle={(l) => setProfile({ ...profile, audienceLangs: toggle(profile.audienceLangs, l) })}
          />
        </Field>
        <Field label="Captions shown in">
          <LangPicker
            selected={[profile.captionLang]}
            single
            onToggle={(l) => setProfile({ ...profile, captionLang: l })}
          />
        </Field>
        <Field label="Two transcripts in">
          <div className="flex gap-2">
            {[0, 1].map((i) => (
              <select
                key={i}
                value={profile.transcriptLangs[i]}
                onChange={(e) => {
                  const next = [...profile.transcriptLangs] as [Lang, Lang];
                  next[i] = e.target.value as Lang;
                  setProfile({ ...profile, transcriptLangs: next });
                }}
                className="rounded border border-line bg-ink px-2 py-1 text-sm"
              >
                {ALL_LANGS.map((l) => (
                  <option key={l} value={l}>
                    {LANG_NAMES[l]}
                  </option>
                ))}
              </select>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="How the language is decided">
        <p className="mb-3 text-xs text-dim">
          This choice decides the engine, and the difference is bigger than it looks.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-xs">
            <thead>
              <tr className="text-left text-dim">
                <th className="py-1 pr-3" />
                <th className="py-1 pr-3">Pin — you say which language</th>
                <th className="py-1">Auto — the engine decides</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Caption delay', '~0.15 s', '~3 s'],
                ['Live partial text', 'yes', 'no'],
                ['Daily limits', 'none at all', 'shared Gemini quota'],
                ['API key', 'not needed', 'required'],
                ['Works offline', 'partly', 'no'],
                ['You must remember', 'press L before switching', 'nothing'],
              ].map(([k, a, b]) => (
                <tr key={k} className="border-t border-line">
                  <td className="py-1 pr-3 text-dim">{k}</td>
                  <td className="py-1 pr-3">{a}</td>
                  <td className="py-1">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <ModePicker
            title="Microphone"
            langs={profile.presenterLangs}
            mode={profile.presenterMode}
            onChange={(m) => setProfile({ ...profile, presenterMode: m })}
          />
          <ModePicker
            title="Room audio"
            langs={profile.audienceLangs}
            mode={profile.audienceMode}
            onChange={(m) => setProfile({ ...profile, audienceMode: m })}
          />
        </div>
      </Section>

      {keyNeeded ? (
        <Section title="Gemini API key">
          <p className="mb-2 text-xs text-dim">
            Needed because at least one channel is on auto-detect. Stored in this browser only, never sent anywhere
            but Google. Pin both channels and this section disappears.
          </p>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              saveApiKey(e.target.value.trim());
            }}
            placeholder="AIza…"
            className="w-full rounded border border-line bg-ink px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
        </Section>
      ) : null}

      <Section title="Preflight">
        <Check
          ok={fatal.length === 0}
          label="Profile is consistent"
          detail={fatal.map((f) => f.message).join(' ')}
        />
        {usesPin ? (
          <>
            <Check ok={webSpeechSupported()} label="Web Speech available" detail="Needed for pinned channels." />
            <Check ok={translatorSupported()} label="Translator API available" detail="On-device translation." />
            <div className="mt-2 space-y-1">
              {pairs.map(({ from, to }) => {
                const key = `${from}>${to}`;
                const st = packs[key] ?? '…';
                const ready = st === 'available';
                return (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    <span className={ready ? 'text-ok' : 'text-warn'}>{ready ? '✓' : '•'}</span>
                    <span className="font-mono">
                      {from} → {to}
                    </span>
                    <span className="text-dim">{st}</span>
                    {!ready ? (
                      <button
                        onClick={() => void downloadPack(from, to)}
                        className="rounded border border-line px-1.5 py-0.5"
                      >
                        Download
                      </button>
                    ) : null}
                  </div>
                );
              })}
              <p className="pt-1 text-[11px] text-dim">
                Download one pack at a time — each needs its own click, that is a browser rule.
              </p>
            </div>
          </>
        ) : null}
        {keyNeeded ? <Check ok={apiKey.length > 10} label="Gemini key entered" /> : null}
        <Check
          ok
          label="Share the WINDOW, not the screen"
          detail="Sharing the whole screen shows the audience your log, and you would not notice."
        />
      </Section>

      {advice.length ? (
        <Section title="Worth knowing">
          {advice.map((a, i) => (
            <p key={i} className="mb-2 border-l-2 border-warn pl-2 text-xs text-dim">
              {a.message}
            </p>
          ))}
        </Section>
      ) : null}

      <div className="sticky bottom-0 mt-6 flex gap-2 bg-ink py-3">
        <button
          onClick={() => onDone(profile)}
          disabled={fatal.length > 0}
          className="rounded bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          Start
        </button>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-xl border border-line bg-panel p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
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
  single,
}: {
  selected: Lang[];
  onToggle: (l: Lang) => void;
  single?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_LANGS.map((l) => (
        <button
          key={l}
          onClick={() => onToggle(l)}
          className={`rounded-full border px-3 py-1 text-xs ${
            selected.includes(l)
              ? 'border-accent bg-accent/15 text-fg'
              : 'border-line text-dim'
          }`}
        >
          {LANG_NAMES[l]}
          {single && selected.includes(l) ? ' ✓' : ''}
        </button>
      ))}
    </div>
  );
}

function ModePicker({
  title,
  langs,
  mode,
  onChange,
}: {
  title: string;
  langs: Lang[];
  mode: MeetingProfile['presenterMode'];
  onChange: (m: MeetingProfile['presenterMode']) => void;
}) {
  return (
    <div className="rounded-lg border border-line p-2">
      <div className="mb-1.5 text-xs font-medium">{title}</div>
      <div className="flex gap-1.5">
        <button
          onClick={() => onChange({ kind: 'pin', current: langs[0] ?? 'en' })}
          className={`flex-1 rounded px-2 py-1 text-xs ${mode.kind === 'pin' ? 'bg-accent font-semibold text-black' : 'border border-line'}`}
        >
          Pin
        </button>
        <button
          onClick={() => onChange({ kind: 'auto' })}
          className={`flex-1 rounded px-2 py-1 text-xs ${mode.kind === 'auto' ? 'bg-accent font-semibold text-black' : 'border border-line'}`}
        >
          Auto
        </button>
      </div>
      {mode.kind === 'pin' ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {langs.map((l) => (
            <button
              key={l}
              onClick={() => onChange({ kind: 'pin', current: l })}
              className={`rounded px-1.5 py-0.5 text-[11px] ${mode.current === l ? 'bg-line' : 'text-dim'}`}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="mb-1.5 flex items-start gap-2 text-xs">
      <span className={ok ? 'text-ok' : 'text-err'}>{ok ? '✓' : '✕'}</span>
      <span>
        {label}
        {detail ? <span className="block text-dim">{detail}</span> : null}
      </span>
    </div>
  );
}
