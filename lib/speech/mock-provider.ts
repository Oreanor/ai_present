import type { Lang, Utterance } from '../types';
import { uid, type Capabilities, type SpeechProvider, type StartOptions } from './types';

// Проигрывает записанный сценарий реплик. На нём отлаживается весь UI лога
// и субтитров — без сети, без микрофона и без расхода лимитов.
// Без него каждая правка вёрстки лога требовала бы живого выступления.

type Line = { lang: Lang; text: string; en: string; pt: string; ru?: string };

const SCRIPT: Line[] = [
  {
    lang: 'en',
    text: 'Good morning everyone, thanks for joining. Today I want to walk through our deployment pipeline.',
    en: 'Good morning everyone, thanks for joining. Today I want to walk through our deployment pipeline.',
    pt: 'Bom dia a todos, obrigado por participarem. Hoje quero apresentar o nosso pipeline de implantação.',
  },
  {
    lang: 'en',
    text: 'We run Kubernetes across three regions, with automated failover between them.',
    en: 'We run Kubernetes across three regions, with automated failover between them.',
    pt: 'Executamos o Kubernetes em três regiões, com failover automático entre elas.',
  },
  {
    lang: 'ru',
    text: 'Здесь я хочу отдельно остановиться на том, как устроено переключение между регионами.',
    en: 'Here I want to dwell separately on how the switching between regions works.',
    pt: 'Aqui quero deter-me separadamente em como funciona a comutação entre regiões.',
  },
  {
    lang: 'pt',
    text: 'Desculpem, uma pergunta rápida sobre os custos de infraestrutura.',
    en: 'Sorry, a quick question about the infrastructure costs.',
    pt: 'Desculpem, uma pergunta rápida sobre os custos de infraestrutura.',
  },
  {
    lang: 'en',
    text: 'Could you clarify how the rollback works if a deployment fails halfway?',
    en: 'Could you clarify how the rollback works if a deployment fails halfway?',
    pt: 'Pode esclarecer como funciona o rollback se uma implantação falhar a meio?',
  },
];

export class MockProvider implements SpeechProvider {
  readonly id = 'mock';
  readonly label = 'Mock (recorded script, no network)';
  readonly capabilities: Capabilities = {
    inlineTranslation: false,
    partials: true,
    languageDetection: true,
    concurrentSessions: 8,
    usesQuota: false,
  };

  private timers: ReturnType<typeof setTimeout>[] = [];
  private t0 = 0;
  private i = 0;

  async start(opts: StartOptions): Promise<void> {
    this.t0 = performance.now();
    this.i = 0;
    opts.onStatus('listening');
    this.schedule(opts);
  }

  private schedule(opts: StartOptions): void {
    const line = SCRIPT[this.i % SCRIPT.length];
    this.i += 1;
    const id = uid('m');

    // Имитируем набор partial-ами: именно на этом ловятся дефекты
    // «полоса прыгает» и «слова выпадают».
    const words = line.text.split(' ');
    let shown = 0;
    const step = () => {
      shown += 1;
      const partial: Utterance = {
        id,
        origLang: line.lang,
        origText: words.slice(0, shown).join(' '),
        texts: { [line.lang]: words.slice(0, shown).join(' ') },
        offsetMs: Math.round(performance.now() - this.t0),
      };
      if (shown < words.length) {
        opts.onPartial(partial);
        this.timers.push(setTimeout(step, 130));
      } else {
        const final: Utterance = {
          id,
          origLang: line.lang,
          origText: line.text,
          texts: { [line.lang]: line.text },
          offsetMs: Math.round(performance.now() - this.t0),
          durationMs: words.length * 130,
          confidence: 0.92,
        };
        opts.onFinal(final);
        // Переводы догоняют с задержкой — как у настоящего FreeProvider.
        for (const to of opts.targetLangs) {
          if (to === line.lang) continue;
          const value = to === 'en' ? line.en : to === 'pt' ? line.pt : line.ru;
          if (value) this.timers.push(setTimeout(() => opts.onTranslation(id, to, value), 260));
        }
        this.timers.push(setTimeout(() => this.schedule(opts), 2600));
      }
    };
    this.timers.push(setTimeout(step, 400));
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}
